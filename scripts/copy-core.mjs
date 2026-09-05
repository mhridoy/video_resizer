import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
await rm('public/ffmpeg', { recursive: true, force: true });
await mkdir('public/ffmpeg', { recursive: true });
await copyFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'public/ffmpeg/ffmpeg-core.js');
const wasm = await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm');
const chunks = [];
for (let offset = 0; offset < wasm.length; offset += 8 * 1024 ** 2) {
  const name = `core-${chunks.length}.bin`;
  await writeFile(`public/ffmpeg/${name}`, wasm.subarray(offset, offset + 8 * 1024 ** 2));
  chunks.push(name);
}
await writeFile('public/ffmpeg/core.json', JSON.stringify({ chunks }));
