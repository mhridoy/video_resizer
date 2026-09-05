import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { validateOptions, encodingArgs } from '../shared/options.mjs';
const require = createRequire(import.meta.url);
const binary = require('ffmpeg-static');
const { BatchEngine, scanFolder } = require('../electron/engine.cjs');

test('rejects unsupported settings', () => {
  assert.throws(() => validateOptions({ profile: '__proto__' }));
  assert.throws(() => validateOptions({ resolution: '720; rm' }));
});
test('recursive batch preserves originals, output hierarchy, handles errors and filename collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resizer-'));
  try {
    await mkdir(path.join(root, 'nested'));
    await mkdir(path.join(root, 'Video Resizer Output old'));
    const original = path.join(root, 'nested', 'sample.MOV');
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.5', '-c:v', 'libx264', '-c:a', 'aac', original]);
    const before = await readFile(original);
    await writeFile(path.join(root, 'bad.mp4'), 'not a video');
    await writeFile(path.join(root, 'notes.txt'), 'ignored');
    await writeFile(path.join(root, 'Video Resizer Output old', 'skip.mp4'), 'ignored');
    const files = await scanFolder(root);
    assert.equal(files.length, 2);
    const events = [];
    const engine = new BatchEngine(binary, event => events.push(event));
    const output = path.join(root, 'Video Resizer Output test');
    await engine.run(files, output, { resolution: '480', hardware: false });
    assert.equal(events.filter(e => e.status === 'done').length, 1);
    assert.equal(events.filter(e => e.status === 'error').length, 1);
    assert.deepEqual(await readFile(original), before);
    const result = path.join(output, 'nested', 'sample.MOV.optimized.mp4');
    const metadata = execFileSync(binary, ['-hide_banner', '-i', result, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(typeof metadata, 'string');
    // A second batch never overwrites earlier results.
    await engine.run(files.filter(f => f.name.includes('sample')), output, { resolution: '480', hardware: false });
    assert.equal((await readdir(path.join(output, 'nested'))).length, 2);
    assert.ok(!(await readdir(output)).some(name => name.includes('.part.')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('cancellation removes partial output and skips remaining files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resizer-cancel-'));
  try {
    const source = path.join(root, 'video.mp4');
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10', '-t', '1', '-c:v', 'libx264', source]);
    const events = [];
    const engine = new BatchEngine(binary, event => { events.push(event); if (event.status === 'processing') engine.cancel(); });
    const output = path.join(root, 'output');
    await engine.run([{ id: 'a', name: 'video.mp4', path: source }, { id: 'b', name: 'other.mp4', path: source }], output, { hardware: false });
    assert.ok(events.some(e => e.status === 'cancelled'));
    assert.ok(!events.some(e => e.id === 'b'));
    assert.deepEqual(await readdir(output), []);
    assert.equal(engine.running, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('resizing preserves landscape and portrait shape without upscaling', () => {
  for (const [input, expected] of [['1280x720', '852x480'], ['720x1280', '480x852'], ['320x240', '320x240']]) {
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=size=${input}:rate=1`, '-t', '1', ...encodingArgs({ resolution: '480' }), '-f', 'null', '-']);
    // Decode one RGB frame to assert the actual output dimensions via byte count.
    const filter = encodingArgs({ resolution: '480' })[5];
    const output = execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=size=${input}`, '-vf', filter, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 10 * 1024 ** 2 });
    const [w, h] = expected.split('x').map(Number);
    assert.equal(output.length, w * h * 3);
  }
});
test('browser WASM engine converts with the same resize settings', async () => {
  globalThis.self = globalThis;
  globalThis.location = { href: 'file:///ffmpeg-core.js' };
  const createCore = require('@ffmpeg/core');
  const wasmBinary = await readFile(path.join(path.dirname(require.resolve('@ffmpeg/core')), 'ffmpeg-core.wasm'));
  const core = await createCore({ wasmBinary });
  const code = core.exec('-f', 'lavfi', '-i', 'color=size=720x1280:rate=1', '-t', '1', ...encodingArgs({ resolution: '480' }), '/output.mp4');
  assert.equal(code, 0);
  assert.ok(core.FS.readFile('/output.mp4').byteLength > 1000);
  core.FS.unlink('/output.mp4');
});
