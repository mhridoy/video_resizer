// Decoding a 12-megapixel photo costs far more than anything done with its pixels, and an
// import needs those pixels four times over: OCR, QR detection, seal regions and the
// duplicate fingerprint. Decode once into one working canvas and derive every view from it.
const WORK_EDGE = 2600; // a QR printed on a scanned invoice still resolves at this size
const TEXT_EDGE = 1800; // container numbers and ticket text read fine here, and OCR is far faster
// WhatsApp often sends 450×600 copies. Their letters are a few pixels tall, which the OCR
// engine misses, so small photos are enlarged for reading (never for sending).
const MIN_TEXT_EDGE = 1500, MAX_ENLARGE = 3;

function scaled(source, edge, enlarge = 1) {
  const ratio = Math.min(enlarge, edge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // Documents are photographed against white; filling first keeps transparent PNGs readable.
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function inkOnly(context, width, height, ink) {
  const image = context.getImageData(0, 0, width, height), data = image.data;
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    values[i] = ink === 'cyan' ? r - (g + b) / 2 : -(Math.max(r, g, b) - Math.min(r, g, b));
  }
  const sorted = Float32Array.from(values).sort();
  const low = sorted[Math.floor(sorted.length * 0.05)], high = sorted[Math.floor(sorted.length * 0.95)];
  const range = Math.max(1, high - low);
  for (let i = 0; i < values.length; i++) {
    const shade = 255 - Math.max(0, Math.min(1, (values[i] - low) / range)) * 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = shade; data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export async function readPhoto(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw Error('Cannot read this photo.'); }
  const aspect = bitmap.width / bitmap.height;
  try {
    const work = scaled(bitmap, WORK_EDGE);
    let text;
    return {
      aspect,
      canvas: work.canvas,
      imageData: () => work.context.getImageData(0, 0, work.canvas.width, work.canvas.height),
      // OCR gets its own smaller copy: one cheap redraw, no second decode of the original.
      textCanvas: () => (text ||= scaled(work.canvas, Math.max(TEXT_EDGE, Math.min(MIN_TEXT_EDGE, Math.max(work.canvas.width, work.canvas.height) * MAX_ENLARGE)), MAX_ENLARGE).canvas),
      // A region given as fractions of the photo, padded, enlarged to `edge` and turned a
      // quarter clockwise (1) or anticlockwise (-1): seal serials run along the seal's body.
      // `ink`: 'cyan' keeps grey engraving on cyan plastic and drops the plastic; 'grey' keeps
      // whatever is least saturated. Both give dark text on white, which OCR reads far better.
      crop({ x, y, w, h }, { pad = 0.3, edge = 900, turn = 0, ink = '' } = {}) {
        const W = work.canvas.width, H = work.canvas.height;
        const left = Math.max(0, (x - w * pad) * W), top = Math.max(0, (y - h * pad) * H);
        const right = Math.min(W, (x + w * (1 + pad)) * W), bottom = Math.min(H, (y + h * (1 + pad)) * H);
        const sw = Math.max(1, right - left), sh = Math.max(1, bottom - top);
        const ratio = Math.min(6, edge / Math.max(sw, sh));
        const dw = Math.round(sw * ratio), dh = Math.round(sh * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = turn ? dh : dw; canvas.height = turn ? dw : dh;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.translate(canvas.width / 2, canvas.height / 2); context.rotate(turn * Math.PI / 2);
        context.drawImage(work.canvas, left, top, sw, sh, -dw / 2, -dh / 2, dw, dh);
        if (ink) inkOnly(context, canvas.width, canvas.height, ink);
        return canvas;
      },
      viewAt(edge) { return scaled(work.canvas, edge); },
      // An exact grid, aspect ignored: the duplicate fingerprint compares fixed cells.
      stretchTo(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(work.canvas, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
      },
      // The ML classifier works at 224px: handing it a small copy saves decoding the
      // full-size original a second time inside the worker.
      previewBlob(edge = 448, quality = 0.82) {
        const { canvas } = scaled(work.canvas, edge);
        return new Promise(resolve => canvas.toBlob(blob => { canvas.width = canvas.height = 1; resolve(blob); }, 'image/jpeg', quality));
      },
      close() { work.canvas.width = work.canvas.height = 1; if (text) text.width = text.height = 1; },
    };
  } finally { bitmap.close(); }
}
