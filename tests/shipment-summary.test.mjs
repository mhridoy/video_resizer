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

test('subject follows the team format and leaves out what is unknown', () => {
  const { subject, body } = shipmentSummary({ container: 'CSQU3054383', seal: 'ML0098812', weightMt: 24.5, weightBasis: 'net', po: '4500123456' });
  assert.equal(subject, 'CSQU 3054383, 4500123456');
  assert.match(body, /Weight: 24\.500 MT \(net\)/);
  assert.match(body, /Seal: ML0098812/);
  assert.ok(!/Forwarder/.test(body));
});

test('reads material, order sequence and billed quantity from a proforma invoice', () => {
  const text = 'Proforma Invoice No: 2593\nP.O. Number: PC-1276\nContainer Ref.: 2ND\nContainer No.: TLLU 2949292\nDESCRIPTION QUANTITY (MT) RATE (USD) TOTAL (USD) TOTAL (SAR)\nBrass Honey Scrap 22.198 8450.00 187573.10 702930.19\nGrand Total';
  const fields = extractShipmentFields(text);
  assert.deepEqual(fields, { po: 'PC-1276', sequence: '2ND', material: 'BRASS HONEY SCRAP', weightMt: 22.198, weightBasis: 'net' });
  const { subject } = shipmentSummary({ ...fields, container: 'TLLU2949292', forwarder: 'AKS' });
  assert.equal(subject, 'Brass Honey, TLLU 2949292, PC-1276, 2ND CNTR, AKS');
});

test('three decimals in MT are a decimal, in KG a thousands separator', () => {
  assert.equal(extractShipmentFields('NET WEIGHT 22.198 MT').weightMt, 22.198);
  assert.equal(extractShipmentFields('NET WEIGHT 22.198 KG').weightMt, 22.198);
});
