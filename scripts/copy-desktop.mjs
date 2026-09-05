import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Optional locally built portable EXE; otherwise downloads use GitHub Releases.
const source = process.env.DESKTOP_ARTIFACT;
await rm('public/downloads', { recursive: true, force: true });
if (source) {
  const data = await readFile(source);
  if (data[0] !== 0x4d || data[1] !== 0x5a) throw new Error('Desktop artifact must be a Windows executable.');
  await mkdir('public/downloads', { recursive: true });
  const chunks = [];
  for (let offset = 0; offset < data.length; offset += 8 * 1024 ** 2) {
    const name = `windows-${chunks.length}.bin`;
    await writeFile(`public/downloads/${name}`, data.subarray(offset, offset + 8 * 1024 ** 2));
    chunks.push(name);
  }
  await writeFile('public/downloads/windows.json', JSON.stringify({ filename: 'Video-Resizer-Windows-Portable.exe', size: data.length, sha256: createHash('sha256').update(data).digest('hex'), chunks }));
}
