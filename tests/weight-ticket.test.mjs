import test from 'node:test';
import assert from 'node:assert/strict';
import { readTicket, printedWeights, handwrittenTotal, ticketContainers } from '../shared/weight-ticket.mjs';
import { extractShipmentFields } from '../shared/shipment-summary.mjs';

// Shaped like real OCR of the yard's tickets (figures made up): the whole-page reading, then
// the scanner's two close readings of the right-hand column.
const COLUMN = '--- TICKET COLUMN ---';
const ticket = (column, extra = '') => `SCRAP EVALUATION\nVECHILE NO.\n${extra}\n${COLUMN}\n${column}\n${COLUMN}\n${column.replace(/ : /g, '\n')}`;

test('printed weighings must add up; a misread digit is outvoted', () => {
  const text = ticket('1 ST WEIGHT : 15750 Kg\n2ND WEIGHT : 38740 Ka\nNET WEIGHT : 22999 Kg', 'NET WEIGHT\n22990 Kg');
  assert.deepEqual(printedWeights(text), { first: 15750, second: 38740, net: 22990, deduction: 0, confirmed: true });
});

test('a colon read as "1" in front of a figure is dropped', () => {
  const text = 'NET WEIGHT\n121540\nKg\n1 ST WEIGHT\n1 14480 Kg\n2 ND WEIGHT\n1 36020 Kg';
  assert.equal(printedWeights(text).net, 21540);
});

test('clean ticket: the printed net is the weight', () => {
  const read = readTicket(ticket('1STWEIGHT : 14250 Kg\n2 ND WEIGHT : 34410 Kg\nNET WEIGHT : 20160 Kg\nDRIVER\'S SIGN. FOREMAN SIGN.'));
  assert.equal(read.final, 20160);
  assert.ok(read.printedConfirmed);
  assert.ok(!read.handwritten && !read.handwrittenUnread);
});

test('bags deducted by hand: the total is taken when the amount beside it agrees', () => {
  const read = readTicket(ticket('1 ST WEIGHT : 15750 Kg\n2 ND WEIGHT : 38740 Kg\nNET WEIGHT : 22990 Kg\n(-) 24 Kg\n= 22966 Kg\nDRIVER\'S SIGN.'));
  assert.equal(read.final, 22966);
  assert.equal(read.adjustment, -24);
  assert.ok(read.handwrittenConfirmed);
});

test('a handwritten total with a stray mark for its last digit is rebuilt only when confirmed', () => {
  assert.deepEqual(handwrittenTotal(`${COLUMN}\nNET WEIGHT : 20190 Kg\n©) 22 kg\n= 2016% kg\nDRIVER'S SIGN.`, 20190), { final: 20168, adjustment: -22, confirmed: true });
});

test('a truck head added by hand: "(+) 590" with the total unread', () => {
  const read = readTicket(ticket('1STWEIGHT : 18440 Kg\n2ND WEIGHT : 34250 Kg\nNET WEIGHT : 15810 Kg\n(+) 590 kg\n=lcYoo\nDRIVER\'S SIGN.'));
  assert.equal(read.final, 16400);
  assert.equal(read.handwrittenConfirmed, false);
});

test('writing that cannot be read is reported, and the printed net kept', () => {
  const read = readTicket(ticket('1 ST WEIGHT : 18770 Kg\n2 ND WEIGHT : 43600 Kg\nNET WEIGHT : 24830 Kg\n3 Aegh Xr © 6\n©) Tb R778\nDRIVER\'S SIGN.'));
  assert.equal(read.final, 24830);
  assert.ok(read.handwrittenUnread);
});

test('the operator\'s signature on the whole-page reading is not handwriting under the net', () => {
  const text = `NET WEIGHT :\n19480 KG\n1‘\nW\nPERATOR\n${COLUMN}\n1 ST WEIGHT : 14630 Kg\n2ND WEIGHT : 34110 Kg\nNET WEIGHT : 19480 Kg\nDRIVER'S SIGN.`;
  assert.ok(!readTicket(text).handwrittenUnread);
});

test('a truck head\'s own ticket is marked, and a PDF holding both prefers the load', () => {
  assert.ok(readTicket(ticket('1ST WEIGHT : 7460 Kg\n2 ND WEIGHT : 7260 Kg\nNET WEIGHT : 200 Kg')).head);
  const both = ticket('1ST WEIGHT : 18440 Kg\n2ND WEIGHT : 34250 Kg\nNET WEIGHT : 15810 Kg') + '\n1STWEIGHT : 7820 Kg\n2 ND WEIGHT : 7230 Kg\nNET WEIGHT : 590 Kg';
  assert.equal(readTicket(both).net, 15810);
});

test('a printed deduction line (digital ticket)', () => {
  const read = readTicket('1st Weight: 18620 kg\n2nd Weight: 38620 kg\nDeduction: -40 kg\nNet Weight: 19960.00 kg');
  assert.equal(read.net, 19960);
  assert.ok(read.printedConfirmed);
});

test('extractShipmentFields uses the ticket reader and asks for a check when unsure', () => {
  const sure = extractShipmentFields(ticket('1 ST WEIGHT : 15750 Kg\n2 ND WEIGHT : 38740 Kg\nNET WEIGHT : 22990 Kg\n(-) 24 Kg\n= 22966 Kg\nDRIVER\'S SIGN.'));
  assert.equal(sure.weightMt, 22.966);
  assert.ok(sure.weightHandwritten && !sure.weightCheck);
  const unsure = extractShipmentFields(ticket('1 ST WEIGHT : 18770 Kg\n2 ND WEIGHT : 43600 Kg\nNET WEIGHT : 24830 Kg\n©) Tb R778\nDRIVER\'S SIGN.'));
  assert.equal(unsure.weightMt, 24.83);
  assert.ok(unsure.weightCheck);
});

test('container on the vehicle line: lookalike letters and one lost digit recovered by the check digit', () => {
  assert.deepEqual(ticketContainers('KOCU 2F98273').map(c => c.id), ['KOCU2198273']);
  assert.deepEqual(ticketContainers('TLXU25°1852').map(c => c.id), ['TLXU2511852']);
  // Clean or hopeless readings are left to the ordinary detector.
  assert.deepEqual(ticketContainers('TLXU 2511852'), []);
  assert.deepEqual(ticketContainers('KOCUZFESERS'), []);
});
