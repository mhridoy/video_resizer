// Browser side of the document scanner: decode a phone photo, find and straighten the sheet,
// clean it up, and hand back a JPEG and a one-page PDF. Runs on this device only.
import { scanDocument } from '../shared/document-scan.mjs';

const WORK_EDGE = 3000, FIND_EDGE = 400;

function pixels(bitmap, edge) {
  const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 1;
  return { data: image.data, width: image.width, height: image.height };
}

/** Scans one photo. Resolves { jpeg: Blob, width, height, found }. */
export async function scanPhoto(file, { maxEdge = 2200, quality = 0.82 } = {}) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw Error('Cannot read this photo. Use a JPG, PNG or WebP picture.'); }
  let result;
  try { result = scanDocument(pixels(bitmap, WORK_EDGE), pixels(bitmap, FIND_EDGE), { maxEdge }); }
  finally { bitmap.close(); }
  const { image, found } = result;
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = canvas.height = 1;
  if (!jpeg) throw Error('This browser could not save the scanned page.');
  return { jpeg, width: image.width, height: image.height, found };
}

/** Scans photos into one PDF, a page per photo, each page sized to A4. */
export async function scanToPdf(files, options) {
  const { imagesToPDF } = await import('../shared/pdf-tools.mjs');
  const pages = [];
  let found = 0;
  for (const file of files) {
    const scan = await scanPhoto(file, options);
    if (scan.found) found++;
    pages.push({ bytes: new Uint8Array(await scan.jpeg.arrayBuffer()), type: 'image/jpeg' });
  }
  const pdf = await imagesToPDF(pages, { pageSize: 'a4' });
  return { pdf: new Blob([pdf], { type: 'application/pdf' }), found };
}
