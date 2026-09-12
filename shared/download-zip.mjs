const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function uniqueName(value, used) {
  const name = String(value || 'download').replace(/[\\/\u0000-\u001f]/g, '_');
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : '';
  let candidate = name, number = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${number++})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

// ZIP's stored method avoids recompressing already-compressed media and works offline.
export async function createZip(files) {
  if (!files.length || files.length > 65535) throw Error('Choose between 1 and 65,535 files for the ZIP.');
  const parts = [], central = [], used = new Set(), encoder = new TextEncoder();
  let offset = 0, centralLength = 0;
  for (const file of files) {
    const filename = encoder.encode(uniqueName(file.name, used));
    if (filename.length > 65535) throw Error('A filename is too long for ZIP.');
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    if (bytes.length > 0xffffffff || offset + bytes.length + filename.length + 30 > 0xffffffff) throw Error('This ZIP is too large. Download the files individually.');
    const checksum = crc32(bytes);
    const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true); // 1980-01-01; stable archive metadata.
    view.setUint32(14, checksum, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, filename.length, true); header.set(filename, 30);
    const entry = new Uint8Array(46 + filename.length), directory = new DataView(entry.buffer);
    directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x800, true); directory.setUint16(14, 33, true);
    directory.setUint32(16, checksum, true); directory.setUint32(20, bytes.length, true); directory.setUint32(24, bytes.length, true);
    directory.setUint16(28, filename.length, true); directory.setUint32(42, offset, true); entry.set(filename, 46);
    parts.push(header, bytes); central.push(entry); centralLength += entry.length; offset += header.length + bytes.length;
  }
  if (offset + centralLength > 0xffffffff) throw Error('This ZIP is too large. Download the files individually.');
  const footer = new Uint8Array(22), view = new DataView(footer.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, centralLength, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, footer], { type: 'application/zip' });
}

export async function downloadZip(files, filename = 'Binary-Beat-files.zip') {
  const blob = await createZip(files);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob;
}
