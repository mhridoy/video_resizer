import { PDFDocument } from 'pdf-lib';
export function pageGroups(text, count) {
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
  const out = await PDFDocument.create();
  for (const bytes of inputs) {
    const doc = await load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  if (!out.getPageCount()) throw Error('Choose PDFs containing pages.');
  return out.save({ useObjectStreams: true });
}
export async function splitPDF(bytes, ranges) {
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
