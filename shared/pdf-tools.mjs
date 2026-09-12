import { PDFDocument, degrees } from 'pdf-lib';

export function pageGroups(text = '', count) {
  if (!Number.isInteger(count) || count < 1) throw Error('This PDF contains no pages.');
  if (!text.trim()) return Array.from({ length: count }, (_, i) => [i]);
  return text.split(';').map(group => {
    const result = [];
    for (const part of group.split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw Error('Use pages like 1-3,5; 6-8. Semicolons create separate PDFs.');
      const a = Number(m[1]), b = Number(m[2] || m[1]);
      if (a < 1 || b < a || b > count) throw Error(`Page numbers must be between 1 and ${count}.`);
      for (let n = a; n <= b; n++) if (!result.includes(n - 1)) result.push(n - 1);
    }
    return result;
  });
}

async function load(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw Error('Cannot read this PDF. Use a valid, unlocked PDF.'); }
}

export async function mergePDF(inputs) {
  if (inputs.length < 2) throw Error('Choose at least two PDFs to merge.');
  const out = await PDFDocument.create();
  for (const bytes of inputs) {
    const doc = await load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  if (!out.getPageCount()) throw Error('Choose PDFs containing pages.');
  return out.save({ useObjectStreams: true });
}

export async function splitPDF(bytes, ranges = '') {
  const source = await load(bytes);
  const outputs = [];
  for (const group of pageGroups(ranges, source.getPageCount())) {
    const out = await PDFDocument.create();
    (await out.copyPages(source, group)).forEach(p => out.addPage(p));
    outputs.push(await out.save({ useObjectStreams: true }));
  }
  return outputs;
}

export async function compressPDF(bytes) {
  const source = await load(bytes);
  const result = await source.save({ useObjectStreams: true, addDefaultPage: false });
  return result.length < bytes.length ? result : bytes;
}

export async function rotatePDF(bytes, angle = 90, ranges = '') {
  if (![90, 180, 270].includes(Number(angle))) throw Error('Choose a rotation of 90°, 180° or 270°.');
  const source = await load(bytes);
  const selected = new Set(pageGroups(ranges, source.getPageCount()).flat());
  for (const index of selected) {
    const page = source.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + Number(angle)) % 360));
  }
  return source.save({ useObjectStreams: true });
}

// Browser callers normalize WebP to PNG before embedding. Bytes stay local.
export async function imagesToPDF(images, { pageSize = 'a4', onProgress = () => {} } = {}) {
  if (!images.length) throw Error('Choose at least one image.');
  if (!['a4', 'original'].includes(pageSize)) throw Error('Choose A4 or original image size.');
  const out = await PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    const item = typeof images[i] === 'function' ? await images[i]() : images[i];
    if (!['image/jpeg', 'image/png'].includes(item.type)) throw Error('PDF images must be JPG or PNG.');
    onProgress(i, images.length);
    const image = item.type === 'image/jpeg' ? await out.embedJpg(item.bytes) : await out.embedPng(item.bytes);
    const landscape = image.width > image.height;
    const [width, height] = pageSize === 'original' ? [image.width * 0.75, image.height * 0.75] : landscape ? [841.89, 595.28] : [595.28, 841.89];
    const margin = pageSize === 'original' ? 0 : 24;
    const factor = Math.min((width - 2 * margin) / image.width, (height - 2 * margin) / image.height);
    const imageWidth = image.width * factor, imageHeight = image.height * factor;
    out.addPage([width, height]).drawImage(image, { x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, width: imageWidth, height: imageHeight });
  }
  return out.save({ useObjectStreams: true });
}
