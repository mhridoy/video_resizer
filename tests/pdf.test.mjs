import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { pageGroups, mergePDF, splitPDF, compressPDF, rotatePDF, imagesToPDF } from '../shared/pdf-tools.mjs';

async function fixture(widths) { const document = await PDFDocument.create(); widths.forEach(width => document.addPage([width, 200])); return document.save({ useObjectStreams: false }); }

test('merge and split preserve requested page order and reject invalid ranges', async () => {
  const a = await fixture([100, 110]), b = await fixture([120]);
  const merged = await mergePDF([a, b]);
  assert.deepEqual((await PDFDocument.load(merged)).getPages().map(page => page.getWidth()), [100, 110, 120]);
  const parts = await splitPDF(merged, '3,1;2');
  assert.equal(parts.length, 2);
  assert.deepEqual((await PDFDocument.load(parts[0])).getPages().map(page => page.getWidth()), [120, 100]);
  assert.equal((await splitPDF(merged, '')).length, 3);
  for (const invalid of ['0', '4', '2-1', 'x', '1;']) assert.throws(() => pageGroups(invalid, 3));
  assert.deepEqual(pageGroups('1-3,2; 3,1', 3), [[0, 1, 2], [2, 0]]);
  assert.throws(() => pageGroups('', 0), /no pages/);
  await assert.rejects(() => mergePDF([a]), /at least two/);
});

test('compression returns a valid PDF and never increases file size', async () => {
  const original = await fixture([100, 110, 120]), output = await compressPDF(original);
  assert.ok(output.length <= original.length);
  assert.equal((await PDFDocument.load(output)).getPageCount(), 3);
  await assert.rejects(() => compressPDF(new Uint8Array([1, 2, 3])), /valid, unlocked/);
});

test('rotation composes existing angles and touches each selected page once', async () => {
  const source = await PDFDocument.load(await fixture([100, 110, 120]));
  source.getPage(0).setRotation(degrees(270));
  const bytes = await source.save();
  const selected = await PDFDocument.load(await rotatePDF(bytes, 90, '1-2; 1'));
  assert.deepEqual(selected.getPages().map(page => page.getRotation().angle), [0, 90, 0]);
  assert.deepEqual(selected.getPages().map(page => page.getWidth()), [100, 110, 120]);
  const all = await PDFDocument.load(await rotatePDF(bytes, 180));
  assert.deepEqual(all.getPages().map(page => page.getRotation().angle), [90, 180, 180]);
  await assert.rejects(() => rotatePDF(bytes, 45), /90°/);
  await assert.rejects(() => rotatePDF(bytes, 90, '4'), /between 1 and 3/);
});

// Minimal valid 1×1 and 2×1 PNG fixtures exercise PDF page sizing and input order.
const pixel = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const widePixel = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=', 'base64'));

test('images to PDF creates ordered pages, supports A4 and original dimensions', async () => {
  const image = { bytes: pixel, type: 'image/png' };
  const progress = [];
  const wide = { bytes: widePixel, type: 'image/png' };
  const original = await PDFDocument.load(await imagesToPDF([wide, async () => image], { pageSize: 'original', onProgress: (index, count) => progress.push([index, count]) }));
  assert.equal(original.getPageCount(), 2);
  assert.deepEqual(original.getPages().map(page => page.getSize()), [{ width: 1.5, height: 0.75 }, { width: 0.75, height: 0.75 }]);
  assert.deepEqual(progress, [[0, 2], [1, 2]]);
  const a4 = await PDFDocument.load(await imagesToPDF([image]));
  assert.deepEqual(a4.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  const landscape = await PDFDocument.load(await imagesToPDF([wide]));
  assert.deepEqual(landscape.getPage(0).getSize(), { width: 841.89, height: 595.28 });
  await assert.rejects(() => imagesToPDF([]), /at least one/);
  await assert.rejects(() => imagesToPDF([image], { pageSize: 'letter' }), /A4/);
  await assert.rejects(() => imagesToPDF([{ ...image, type: 'image/webp' }]), /JPG or PNG/);
});
