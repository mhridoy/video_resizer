import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDigit, parseContainer, detectContainer, categorize, standardPath, packParts, manifestCsv } from '../shared/container.mjs';

test('validates ISO 6346 container numbers', () => {
  assert.equal(checkDigit('CSQU305438'), 3);
  assert.deepEqual(parseContainer('csqu 305438-3'), { id: 'CSQU3054383', valid: true });
  assert.deepEqual(parseContainer('CSQU3054384'), { id: 'CSQU3054384', valid: false });
  for (const value of ['', 'CSQU30543', 'C5QU3054383', 'invoice 2024']) assert.equal(parseContainer(value), null);
});

test('detects container numbers in folders and file names', () => {
  assert.equal(detectContainer('Loads/CSQU3054383/photos/1.jpg').id, 'CSQU3054383');
  assert.equal(detectContainer('2024-05 CSQU 305438-3 loading.mp4').id, 'CSQU3054383');
  assert.equal(detectContainer('Loads/ABCU1234561 vs CSQU3054383/a.jpg').id, 'CSQU3054383');
  assert.equal(detectContainer('Loads/photos/IMG_0001.jpg'), null);
});

test('sorts files into container document categories', () => {
  assert.equal(categorize('MSCU/IMG_0001.JPG'), 'photos');
  assert.equal(categorize('MSCU/loading.mov'), 'videos');
  assert.equal(categorize('MSCU/Commercial Invoice 551.pdf'), 'invoices');
  assert.equal(categorize('MSCU/inv-2041.pdf'), 'invoices');
  assert.equal(categorize('MSCU/Weight Ticket.jpg'), 'weight');
  assert.equal(categorize('MSCU/VGM declaration.pdf'), 'weight');
  assert.equal(categorize('MSCU/kanta slip.jpg'), 'weight');
  assert.equal(categorize('MSCU/Bill of Lading.pdf'), 'documents');
  assert.equal(categorize('MSCU/Packing list.xlsx'), 'documents');
  assert.equal(categorize('MSCU/notes.pdf'), 'documents');
  assert.equal(categorize('MSCU/seal photo.jpg'), 'photos');
  assert.equal(categorize('Invoices/scan.jpg'), 'invoices');
});

test('builds standard names and email-sized parts', () => {
  assert.equal(standardPath('CSQU3054383', 'invoices', 3, 12, 'pdf', 'x/a.pdf'), 'CSQU3054383/03_Invoices/CSQU3054383_INVOICE_03.pdf');
  assert.equal(standardPath('', 'photos', 1, 1, 'jpg', 'x/IMG 1.jpg', false), 'Unassigned/01_Load_Photos/IMG 1.jpg');
  const files = [10, 10, 10, 3].map((mb, i) => ({ name: `f${i}`, size: mb * 1024 ** 2 }));
  const parts = packParts(files, 24 * 1024 ** 2);
  assert.deepEqual(parts.map(part => part.map(file => file.name)), [['f0', 'f1', 'f3'], ['f2']]);
  for (const part of parts) assert.ok(part.reduce((sum, file) => sum + file.size + 100, 22) <= 24 * 1024 ** 2);
  const csv = manifestCsv([{ container: 'CSQU3054383', category: 'weight', path: 'a,b.jpg', original: 'x.jpg', originalSize: 5, size: 4, note: 'ok' }]);
  assert.match(csv, /Weight tickets,"a,b\.jpg"/);
});
