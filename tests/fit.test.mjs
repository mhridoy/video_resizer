import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileKind, limitBytes, safeRelativePath, replaceExtension, videoPlan, videoArgs, scaledSize, IMAGE_STEPS } from '../shared/fit-size.mjs';
import { readZip, writeZip, shrinkOfficeFile } from '../shared/office-zip.mjs';
import { createZip } from '../shared/download-zip.mjs';
const require = createRequire(import.meta.url);
const binary = require('ffmpeg-static');
const { FitVideo } = require('../electron/fit-video.cjs');

test('classifies every file in a mixed folder', () => {
  assert.equal(fileKind('trip/IMG_001.JPG'), 'image');
  assert.equal(fileKind('trip/clip.MOV'), 'video');
  assert.equal(fileKind('docs/report.pdf'), 'pdf');
  for (const name of ['a.docx', 'b.pptx', 'c.xlsx', 'd.odt']) assert.equal(fileKind(name), 'doc');
  assert.equal(fileKind('notes.txt'), 'other');
  for (const name of ['.DS_Store', 'x/Thumbs.db', '._photo.jpg', '~$draft.docx']) assert.equal(fileKind(name), 'skip');
});

test('size limit and output paths are validated', () => {
  assert.equal(limitBytes(24), 24 * 1024 * 1024);
  for (const value of [0, -1, 'abc', NaN, 5000]) assert.throws(() => limitBytes(value));
  assert.equal(safeRelativePath('../a/./b\\c.jpg'), 'a/b/c.jpg');
  assert.equal(safeRelativePath('..'), 'file');
  assert.equal(replaceExtension('a.b/photo.png', 'jpg'), 'a.b/photo.jpg');
  assert.equal(replaceExtension('folder/README', 'mp4'), 'folder/README.mp4');
});

test('video plan stays under the limit and lowers the budget on retries', () => {
  const target = 24 * 1024 ** 2;
  const first = videoPlan(60, target), second = videoPlan(60, target, 1);
  assert.ok((first.videoKbps + first.audioKbps) * 1000 / 8 * 60 < target);
  assert.ok(second.videoKbps < first.videoKbps);
  assert.equal(videoPlan(30, target).maxEdge, 1920);
  assert.ok(videoPlan(1200, target).maxEdge <= 640);
  assert.equal(videoPlan(600, target, 0, { mute: true }).audioKbps, 0);
  assert.throws(() => videoPlan(0, target));
  assert.throws(() => videoPlan(10 * 3600, target));
  const args = videoArgs(first);
  assert.ok(args.includes(`${first.videoKbps}k`));
  assert.ok(videoArgs({ ...first, audioKbps: 0 }).includes('-an'));
});

test('image steps get progressively smaller', () => {
  for (let i = 1; i < IMAGE_STEPS.length; i++) assert.ok(IMAGE_STEPS[i].maxEdge * IMAGE_STEPS[i].quality <= IMAGE_STEPS[i - 1].maxEdge * IMAGE_STEPS[i - 1].quality);
  assert.deepEqual(scaledSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(scaledSize(800, 600, 2000), { width: 800, height: 600 });
});

test('Office documents round-trip and only pictures are replaced', async () => {
  const xml = new TextEncoder().encode('<w:document>' + 'hello '.repeat(5000) + '</w:document>');
  const picture = new Uint8Array(200 * 1024).fill(7);
  const original = new Uint8Array(await (await writeZip([
    { name: 'mimetype', data: new TextEncoder().encode('application/vnd.oasis.opendocument.text') },
    { name: 'word/document.xml', data: xml },
    { name: 'word/media/image1.jpeg', data: picture },
    { name: 'word/media/tiny.png', data: new Uint8Array(10) },
  ])).arrayBuffer());
  assert.ok(original.length < xml.length + picture.length, 'XML is deflated');
  const seen = [];
  const shrunk = new Uint8Array(await (await shrinkOfficeFile(original, async name => { seen.push(name); return new Uint8Array(1000); })).arrayBuffer());
  assert.deepEqual(seen, ['word/media/image1.jpeg']);
  const entries = await readZip(shrunk);
  assert.deepEqual(entries.map(entry => entry.name), ['mimetype', 'word/document.xml', 'word/media/image1.jpeg', 'word/media/tiny.png']);
  assert.deepEqual(entries[1].data, xml);
  assert.equal(entries[2].data.length, 1000);
  assert.ok(shrunk.length < original.length);
  // OpenDocument readers require "mimetype" to be stored uncompressed.
  assert.equal(new DataView(shrunk.buffer).getUint16(8, true), 0);
  await assert.rejects(readZip(new Uint8Array(100)));
});

test('result ZIP keeps folders when asked', async () => {
  const zip = new Uint8Array(await (await createZip([
    { name: 'trip/day 1/a.jpg', blob: new Blob(['1']) }, { name: 'trip/day 1/a.jpg', blob: new Blob(['2']) }, { name: '../evil.txt', blob: new Blob(['3']) },
  ], { keepFolders: true })).arrayBuffer());
  const names = (await readZip(zip)).map(entry => entry.name);
  assert.deepEqual(names, ['trip/day 1/a.jpg', 'trip/day 1/a (2).jpg', 'evil.txt']);
});

test('native engine fits a video under the size limit', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fit-'));
  try {
    const input = path.join(dir, 'noise.mp4');
    // Random noise is very hard to compress, so a generous CRF would overshoot the limit.
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=640x360:d=4,geq=random(1)*255:128:128', '-f', 'lavfi', '-i', 'sine=d=4',
      '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input]);
    const target = 1024 ** 2 * 1.5;
    assert.ok((await stat(input)).size > target);
    const progress = [];
    const result = await new FitVideo(binary).fit(input, target, {}, value => progress.push(value));
    assert.ok(result.data.length > 0 && result.data.length <= target, `got ${result.data.length}`);
    assert.ok(progress.length > 0);
    await assert.rejects(new FitVideo(binary).fit(path.join(dir, 'notes.txt'), target), /video/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
