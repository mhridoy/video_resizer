// Reads a video's length from its MP4/MOV header ('moov' → 'mvhd') without decoding it.
// Phone recordings put 'moov' at the end of the file, so boxes are walked by their sizes
// and only a few header bytes are read; works for HEVC files the browser cannot play.
// `read(start, end)` returns a Uint8Array of those bytes.
export async function mp4Duration(read, size) {
  const box = async (start, end) => {
    const boxes = [];
    for (let at = start; at + 8 <= end && boxes.length < 64;) {
      const head = await read(at, Math.min(end, at + 16));
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      let length = view.getUint32(0), header = 8;
      if (length === 1 && head.byteLength >= 16) { length = Number(view.getBigUint64(8)); header = 16; }
      else if (length === 0) length = end - at;
      if (length < header) break;
      boxes.push({ type: String.fromCharCode(...head.subarray(4, 8)), start: at + header, end: Math.min(end, at + length) });
      at += length;
    }
    return boxes;
  };
  const moov = (await box(0, size)).find(value => value.type === 'moov');
  if (!moov) return 0;
  const mvhd = (await box(moov.start, moov.end)).find(value => value.type === 'mvhd');
  if (!mvhd) return 0;
  const data = await read(mvhd.start, Math.min(mvhd.end, mvhd.start + 32));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const v1 = data[0] === 1;
  if (data.byteLength < (v1 ? 32 : 20)) return 0;
  const scale = view.getUint32(v1 ? 20 : 12);
  const length = v1 ? Number(view.getBigUint64(24)) : view.getUint32(16);
  return scale && length && length !== 0xffffffff ? length / scale : 0;
}
