import test from 'node:test';
import assert from 'node:assert/strict';
import { extractShipmentFields, shipmentSummary } from '../shared/shipment-summary.mjs';

test('reads PO, forwarder and weight in MT from an invoice', () => {
  const fields = extractShipmentFields('COMMERCIAL INVOICE NO 551\nPO NO: 4500123456   DATE 12/10/2026\nFREIGHT FORWARDER: ABC LOGISTICS LTD.   TEL 555\nNET WEIGHT: 24,500 KGS\nGROSS WEIGHT 25,100 KGS');
  assert.deepEqual(fields, { po: '4500123456', forwarder: 'ABC LOGISTICS LTD', weightMt: 24.5, weightBasis: 'net' });
});

test('weight already in MT, and European decimals', () => {
  assert.equal(extractShipmentFields('TOTAL G.W. 18.75 MT').weightMt, 18.75);
  assert.equal(extractShipmentFields('NET WEIGHT 24.500,5 KG').weightMt, 24.501);
});

test('subject is one line and leaves out what is unknown', () => {
  const { subject, body } = shipmentSummary({ container: 'CSQU3054383', seal: 'ML0098812', weightMt: 24.5, weightBasis: 'net', po: '4500123456' });
  assert.equal(subject, 'CNTR CSQU3054383 | WT 24.500 MT NET | SEAL ML0098812 | PO 4500123456');
  assert.ok(!/Forwarder/.test(body));
});
