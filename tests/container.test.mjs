import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDigit, parseContainer, detectContainer, categorize, standardPath, packParts, manifestCsv, importableFromZip } from '../shared/container.mjs';

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

test('imports files out of a WhatsApp chat-export ZIP and skips its noise', async () => {
  const { writeZip } = await import('../shared/office-zip.mjs');
  const { listZipEntries, zipEntryBlob } = await import('../shared/read-zip-blob.mjs');
  const text = new TextEncoder().encode('chat transcript line\n'.repeat(500));
  const photo = new Uint8Array(40_000).fill(200);
  const archive = await writeZip([
    { name: '_chat.txt', data: text },
    { name: 'IMG-20261013-WA0001.jpg', data: photo },
    { name: 'media/weight ticket.jpg', data: photo },
    { name: '__MACOSX/._IMG-20261013-WA0001.jpg', data: new Uint8Array([1, 2]) },
    { name: '.DS_Store', data: new Uint8Array([3]) },
  ]);
  const entries = await listZipEntries(archive);
  const wanted = entries.filter(entry => !entry.directory && entry.size && importableFromZip(entry.name));
  assert.deepEqual(wanted.map(entry => entry.name), ['IMG-20261013-WA0001.jpg', 'media/weight ticket.jpg']);
  // The transcript is deflated and the photo is stored; both must come back byte for byte.
  assert.equal(entries.find(entry => entry.name === '_chat.txt').method, 8);
  assert.deepEqual(new Uint8Array(await (await zipEntryBlob(archive, wanted[0])).arrayBuffer()), photo);
  assert.deepEqual(new Uint8Array(await (await zipEntryBlob(archive, entries[0])).arrayBuffer()), text);
  await assert.rejects(listZipEntries(new Blob([new Uint8Array(500)])), /not a ZIP/);
  assert.equal(importableFromZip('folder/'), false);
  assert.equal(importableFromZip('photos/IMG_1.jpg'), true);
});

test('shares one email budget across its attachments', async () => {
  const { allocateBudget } = await import('../shared/container.mjs');
  const MB = 1024 ** 2;
  // A small invoice keeps its size; the oversized video absorbs the rest of the budget.
  assert.deepEqual(allocateBudget([2 * MB, 100 * MB], 24 * MB), [2 * MB, 22 * MB]);
  // Nothing fits an equal share, so every file gets the same slice.
  assert.deepEqual(allocateBudget([40 * MB, 40 * MB, 40 * MB], 24 * MB), [8 * MB, 8 * MB, 8 * MB]);
  // A set that already fits is left completely alone.
  assert.deepEqual(allocateBudget([1 * MB, 2 * MB], 24 * MB), [1 * MB, 2 * MB]);
  for (const targets of [allocateBudget([30 * MB, 1 * MB, 9 * MB, 60 * MB], 24 * MB), allocateBudget(Array(30).fill(5 * MB), 24 * MB)]) {
    assert.ok(targets.reduce((sum, value) => sum + value, 0) <= 24 * MB);
    assert.ok(targets.every(value => value > 0));
  }
  assert.deepEqual(allocateBudget([], 24 * MB), []);
  assert.throws(() => allocateBudget([1], 0));
});

test('a video draws a bigger share than photos, and huge sets split across emails', async () => {
  const { allocateBudget, SHARE_WEIGHT, filesPerEmail } = await import('../shared/container.mjs');
  const MB = 1024 ** 2;
  const sizes = [80 * MB, 5 * MB, 5 * MB], weights = [SHARE_WEIGHT.video, SHARE_WEIGHT.image, SHARE_WEIGHT.image];
  const [video, photo] = allocateBudget(sizes, 24 * MB, weights);
  assert.ok(video > photo * 5, `video ${video} vs photo ${photo}`);
  assert.ok(allocateBudget(sizes, 24 * MB, weights).reduce((sum, value) => sum + value, 0) <= 24 * MB);
  // Weights never starve a file that already fits: it keeps its size and frees the surplus.
  assert.deepEqual(allocateBudget([1 * MB, 60 * MB], 24 * MB, [1, SHARE_WEIGHT.video]), [1 * MB, 23 * MB]);
  assert.equal(filesPerEmail(24 * MB), 111);
  assert.equal(filesPerEmail(1024), 1);
});
