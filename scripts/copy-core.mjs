// Vendors both FFmpeg WebAssembly builds. The wasm is split into 8 MB parts because a single
// 32 MB file is refused by some proxies and stalls on slow connections.
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';

async function vendor(source, target, extra = []) {
  await mkdir(target, { recursive: true });
  await copyFile(`${source}/ffmpeg-core.js`, `${target}/ffmpeg-core.js`);
  for (const name of extra) await copyFile(`${source}/${name}`, `${target}/${name}`);
  const wasm = await readFile(`${source}/ffmpeg-core.wasm`);
  const chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 8 * 1024 ** 2) {
    const name = `core-${chunks.length}.bin`;
    await writeFile(`${target}/${name}`, wasm.subarray(offset, offset + 8 * 1024 ** 2));
    chunks.push(name);
  }
  await writeFile(`${target}/core.json`, JSON.stringify({ chunks }));
}

await rm('public/ffmpeg', { recursive: true, force: true });
await vendor('node_modules/@ffmpeg/core/dist/esm', 'public/ffmpeg');
// The multi-threaded build also ships the worker that the core spawns per thread.
await vendor('node_modules/@ffmpeg/core-mt/dist/esm', 'public/ffmpeg/mt', ['ffmpeg-core.worker.js']);
