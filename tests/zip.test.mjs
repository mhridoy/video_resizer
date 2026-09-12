import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../shared/download-zip.mjs';

test('ZIP stores valid UTF-8 filenames, file checksums and central directory offsets', async () => {
  const zip = new Uint8Array(await (await createZip([
    { name: 'test.txt', blob: new Blob(['123456789']) },
    { name: 'test.txt', blob: new Blob(['second']) },
    { name: 'ছবি.png', blob: new Blob([new Uint8Array([1, 2, 3])]) },
  ])).arrayBuffer());
  const view = new DataView(zip.buffer), decoder = new TextDecoder();
  const footer = zip.length - 22;
  assert.equal(view.getUint32(footer, true), 0x06054b50);
  assert.equal(view.getUint16(footer + 10, true), 3);
  let central = view.getUint32(footer + 16, true);
  const names = [], contents = [];
  for (let index = 0; index < 3; index++) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const offset = view.getUint32(central + 42, true), nameLength = view.getUint16(central + 28, true);
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const filename = decoder.decode(zip.slice(central + 46, central + 46 + nameLength)); names.push(filename);
    assert.equal(decoder.decode(zip.slice(offset + 30, offset + 30 + nameLength)), filename);
    const length = view.getUint32(offset + 18, true);
    contents.push(zip.slice(offset + 30 + nameLength, offset + 30 + nameLength + length));
    if (index === 0) assert.equal(view.getUint32(offset + 14, true), 0xcbf43926);
    central += 46 + nameLength;
  }
  assert.equal(central, footer);
  assert.deepEqual(names, ['test.txt', 'test (2).txt', 'ছবি.png']);
  assert.equal(decoder.decode(contents[0]), '123456789');
  assert.equal(decoder.decode(contents[1]), 'second');
  assert.deepEqual(contents[2], new Uint8Array([1, 2, 3]));
});

test('ZIP rejects empty archives and strips path separators from download names', async () => {
  await assert.rejects(() => createZip([]), /between 1/);
  const archive = new Uint8Array(await (await createZip([{ name: '../escape.txt', blob: new Blob(['safe']) }])).arrayBuffer());
  const view = new DataView(archive.buffer);
  assert.equal(new TextDecoder().decode(archive.slice(30, 30 + view.getUint16(26, true))), '.._escape.txt');
});
