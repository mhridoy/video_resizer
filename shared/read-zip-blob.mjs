// Reads files out of a ZIP without holding the whole archive in memory: the central
// directory is read from the end, then each entry is streamed straight out of the Blob.
// Used to import WhatsApp "Export chat" archives and any other ZIP of shipment files.

const asBlob = input => input instanceof Blob ? input : new Blob([input]);
const chunk = async (file, start, length) => new Uint8Array(await file.slice(start, start + length).arrayBuffer());

export async function listZipEntries(input) {
  const file = asBlob(input);
  if (file.size < 22) throw Error('This is not a ZIP file.');
  const tailLength = Math.min(file.size, 65_557);
  const tail = await chunk(file, file.size - tailLength, tailLength);
  const tailView = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tailView.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('This is not a ZIP file, or it is damaged.');
  const count = tailView.getUint16(end + 10, true);
  const directorySize = tailView.getUint32(end + 12, true);
  const directoryOffset = tailView.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw Error('Very large (ZIP64) archives are not supported. Export the chat in smaller parts.');
  const central = await chunk(file, directoryOffset, directorySize);
  const view = new DataView(central.buffer);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > central.length || view.getUint32(offset, true) !== 0x02014b50) throw Error('This ZIP file is damaged.');
    const nameLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({
      name,
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      offset: view.getUint32(offset + 42, true),
      directory: name.endsWith('/'),
    });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

export async function zipEntryBlob(input, entry) {
  const file = asBlob(input);
  const header = await chunk(file, entry.offset, 30);
  const view = new DataView(header.buffer);
  if (view.getUint32(0, true) !== 0x04034b50) throw Error(`Damaged entry: ${entry.name}`);
  const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const raw = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw Error(`Unsupported compression in ${entry.name}.`);
  return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
}
