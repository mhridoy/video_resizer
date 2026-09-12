import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateOptions, inputArgs, encodingArgs } from '../shared/options.mjs';
const require = createRequire(import.meta.url);
const binary = require('ffmpeg-static');
const { BatchEngine, scanFolder } = require('../electron/engine.cjs');

test('rejects unsupported settings', () => {
  assert.throws(() => validateOptions({ profile: '__proto__' }));
  assert.throws(() => validateOptions({ resolution: '720; rm' }));
  for (const trimStart of [-1, Infinity, NaN, '3', null]) assert.throws(() => validateOptions({ trimStart }));
  for (const trimEnd of [0, 2, Infinity, NaN, '4', null]) assert.throws(() => validateOptions({ trimStart: 2, trimEnd }));
  assert.throws(() => validateOptions({ mute: 'false' }));
  assert.equal(validateOptions({ trimStart: 0.25, trimEnd: 1.5, profile: 'fast', mute: true }).trimEnd, 1.5);
});
test('shared conversion settings seek before input and preserve audio by default', () => {
  assert.deepEqual(inputArgs({}), []);
  assert.deepEqual(inputArgs({ trimStart: 2.25 }), ['-ss', '2.25']);
  assert.ok(encodingArgs({}).includes('0:a:0?'));
  const args = encodingArgs({ profile: 'fast', trimStart: 2.25, trimEnd: 5, mute: true });
  assert.equal(args[args.indexOf('-preset') + 1], 'ultrafast');
  assert.equal(args[args.indexOf('-t') + 1], '2.75');
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('0:a:0?'));
  assert.ok(!args.includes('-c:a'));
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
test('native engine trims, mutes and uses the fast profile while preserving the source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resizer-trim-'));
  try {
    const source = path.join(root, 'source.mp4');
    execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', source]);
    const before = await readFile(source);
    const events = [];
    const engine = new BatchEngine(binary, event => events.push(event));
    const files = [{ id: 'clip', name: 'source.mp4', path: source }];
    const output = path.join(root, 'output');
    await engine.run(files, output, { trimStart: 0.5, trimEnd: 1.5, mute: true, profile: 'fast', hardware: false });
    assert.ok(events.some(event => event.status === 'done'));
    const probe = spawnSync(binary, ['-hide_banner', '-i', path.join(output, 'source.mp4.optimized.mp4'), '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stderr, /Duration: 00:00:01\.00/);
    assert.match(probe.stderr, /Video: h264/);
    assert.doesNotMatch(probe.stderr, /Audio:/);
    assert.deepEqual(await readFile(source), before);

    events.length = 0;
    await engine.run(files, path.join(root, 'past-end'), { trimStart: 4, hardware: false });
    assert.ok(events.some(event => event.status === 'error' && /Trim start/.test(event.error)));
    assert.deepEqual(await readdir(path.join(root, 'past-end')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('encoder discovery is reused and failed hardware is skipped for the rest of a batch', { skip: process.platform === 'win32' && 'Executable test fixtures require POSIX shebang support.' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resizer-encoders-'));
  try {
    const fakeBinary = path.join(root, 'ffmpeg.cjs');
    const discoveries = path.join(root, 'discoveries.txt');
    await writeFile(fakeBinary, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(discoveries)}, 'discovered\\n');\nprocess.stdout.write('h264_videotoolbox h264_nvenc libx264');\n`, { mode: 0o755 });
    const attempts = [];
    class FakeEngine extends BatchEngine {
      async convert(file, target, options, encoder) {
        attempts.push({ id: file.id, encoder });
        if (encoder !== 'libx264') throw new Error('No hardware device.');
        await writeFile(target, 'converted');
      }
    }
    const files = [{ id: 'a', name: 'a.mp4' }, { id: 'b', name: 'b.mp4' }];
    const engine = new FakeEngine(fakeBinary, () => {});
    await engine.run(files, path.join(root, 'output'), { hardware: true });
    if (['darwin', 'win32'].includes(process.platform)) {
      assert.equal(attempts.filter(attempt => attempt.encoder !== 'libx264').length, 1);
      assert.deepEqual(attempts.filter(attempt => attempt.id === 'b'), [{ id: 'b', encoder: 'libx264' }]);
    }
    await new FakeEngine(fakeBinary, () => {}).run(files, path.join(root, 'another-output'), { hardware: true });
    assert.equal(await readFile(discoveries, 'utf8'), 'discovered\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native progress measures the kept clip duration and seeks before opening input', { skip: process.platform === 'win32' && 'Executable test fixtures require POSIX shebang support.' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resizer-progress-'));
  try {
    const fakeBinary = path.join(root, 'ffmpeg.cjs');
    const commandFile = path.join(root, 'command.json');
    await writeFile(fakeBinary, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(commandFile)}, JSON.stringify(args));\nprocess.stderr.write('Duration: 00:00:10.00, start: 0.000000\\n');\nsetTimeout(() => { process.stdout.write('out_time_us=1000000\\n'); fs.writeFileSync(args.at(-1), 'converted'); }, 50);\n`, { mode: 0o755 });
    const events = [];
    await new BatchEngine(fakeBinary, event => events.push(event)).run([{ id: 'clip', name: 'clip.mp4', path: 'input.mp4' }], path.join(root, 'output'), { hardware: false, trimStart: 2, trimEnd: 4 });
    assert.ok(events.some(event => event.progress === 50), JSON.stringify(events));
    const args = JSON.parse(await readFile(commandFile, 'utf8'));
    assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
    assert.equal(args[args.indexOf('-ss') + 1], '2');
    assert.equal(args[args.indexOf('-t') + 1], '2');
  } finally { await rm(root, { recursive: true, force: true }); }
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
  core.reset();
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=8', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '/source.mp4'), 0);
  core.reset();
  const options = { profile: 'fast', resolution: 'original', trimStart: 0.5, trimEnd: 1.25, mute: true };
  assert.equal(core.exec(...inputArgs(options), '-i', '/source.mp4', ...encodingArgs(options), '/clip.mp4'), 0);
  const logs = [];
  core.setLogger(({ message }) => logs.push(message));
  core.reset();
  assert.equal(core.exec('-hide_banner', '-i', '/clip.mp4', '-f', 'null', '-'), 0);
  assert.match(logs.join('\n'), /Duration: 00:00:00\.75/);
  assert.doesNotMatch(logs.join('\n'), /Audio:/);
  core.FS.unlink('/source.mp4');
  core.FS.unlink('/clip.mp4');
});
