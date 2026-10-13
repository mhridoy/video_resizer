// Minimal ZIP reader/writer for Office (docx, pptx, xlsx) and OpenDocument files.
// Uses the platform's deflate streams, so it runs in browsers, Electron and Node 18+.
import { crc32 } from './download-zip.mjs';

async function transform(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const inflate = bytes => transform(bytes, new DecompressionStream('deflate-raw'));
const deflate = bytes => transform(bytes, new CompressionStream('deflate-raw'));

export async function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('This document is damaged or is not an Office file.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw Error('Very large (ZIP64) documents are not supported.');
  const decoder = new TextDecoder(), entries = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw Error('This document is damaged.');
    const method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) throw Error('This document is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    if (method !== 0 && method !== 8) throw Error(`Unsupported compression in ${name}.`);
    entries.push({ name, data: method === 8 ? await inflate(raw) : raw.slice() });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const ALREADY_COMPRESSED = /\.(jpe?g|png|gif|webp|mp4|m4a|mp3|wav|zip|wdp|jfif)$/i;

export async function writeZip(entries) {
  const encoder = new TextEncoder(), parts = [], central = [];
  let offset = 0, centralLength = 0;
  for (const { name, data } of entries) {
    const filename = encoder.encode(name);
    // OpenDocument requires an uncompressed "mimetype" entry; media is already compressed.
    const packed = name === 'mimetype' || ALREADY_COMPRESSED.test(name) ? null : await deflate(data);
    const method = packed && packed.length < data.length ? 8 : 0, body = method ? packed : data;
    const checksum = crc32(data);
    const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(8, method, true);
    view.setUint16(12, 33, true); view.setUint32(14, checksum, true); view.setUint32(18, body.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, filename.length, true); header.set(filename, 30);
    const entry = new Uint8Array(46 + filename.length), directory = new DataView(entry.buffer);
    directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x800, true); directory.setUint16(10, method, true); directory.setUint16(14, 33, true);
    directory.setUint32(16, checksum, true); directory.setUint32(20, body.length, true); directory.setUint32(24, data.length, true);
    directory.setUint16(28, filename.length, true); directory.setUint32(42, offset, true); entry.set(filename, 46);
    parts.push(header, body); central.push(entry); centralLength += entry.length; offset += header.length + body.length;
    if (offset > 0xffffffff) throw Error('This document is too large.');
  }
  const footer = new Uint8Array(22), view = new DataView(footer.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
  view.setUint32(12, centralLength, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, footer]);
}

// Re-encodes embedded pictures (word/media, ppt/media, xl/media, Pictures/) and repacks the document.
// Image names and formats are kept, so every reference inside the document stays valid.
export async function shrinkOfficeFile(bytes, shrinkImage) {
  const entries = await readZip(bytes);
  for (const entry of entries) {
    if (!/(^|\/)(media|Pictures)\/[^/]+\.(jpe?g|png)$/i.test(entry.name) || entry.data.length < 64 * 1024) continue;
    const smaller = await shrinkImage(entry.name, entry.data);
    if (smaller && smaller.length < entry.data.length) entry.data = smaller;
  }
  return writeZip(entries);
}
