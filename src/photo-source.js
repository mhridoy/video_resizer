// Decoding a 12-megapixel photo costs far more than anything done with its pixels, and an
// import needs those pixels four times over: OCR, QR detection, seal regions and the
// duplicate fingerprint. Decode once into one working canvas and derive every view from it.
const WORK_EDGE = 2600; // a QR printed on a scanned invoice still resolves at this size
const TEXT_EDGE = 1800; // container numbers and ticket text read fine here, and OCR is far faster

function scaled(source, edge) {
  const ratio = Math.min(1, edge / Math.max(source.width, source.height));
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
      textCanvas: () => (text ||= scaled(work.canvas, TEXT_EDGE).canvas),
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
