import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceEvidence, invoiceFilename } from '../shared/invoice-documents.mjs';
import { detectShipmentText } from '../shared/shipment-detection.mjs';
import { standardPath, uniqueOutputName } from '../shared/container.mjs';
import { validateAIResult } from '../shared/shipment-ai.mjs';

test('extracts labeled invoice references without using VAT registration or dates', () => {
  const found=invoiceEvidence('COMMERCIAL INVOICE\nInvoice No: INV/000123\nVAT Registration No: 310000000003\nDate: 2026-10-16');
  assert.equal(found.invoiceNumber,'INV-000123');
  assert.equal(found.category,'invoices');
  assert.equal(invoiceEvidence('INVOICE\nVAT No: 310000000003\nInvoice Date: 2026-10-16').invoiceNumber,'');
  assert.equal(invoiceEvidence('فاتورة\nرقم الفاتورة: ٠٠١٢٣').invoiceNumber,'00123');
  assert.equal(invoiceEvidence('Invoice No: 001\nInvoice No: 002').invoiceConflict,true);
});
test('QR promotes invoices to VAT but preserves packing lists, weight tickets and shipping documents', () => {
  assert.equal(detectShipmentText('INVOICE\nInvoice No: 001',{hasQrCode:true}).category,'vat');
  assert.equal(detectShipmentText('PACKING LIST\nInvoice No: 001',{hasQrCode:true}).category,'packing');
  assert.equal(detectShipmentText('WEIGHT TICKET\nINVOICE No: 001',{hasQrCode:true}).category,'weight');
  assert.equal(detectShipmentText('TERMINAL HANDLING INVOICE No: 001',{hasQrCode:true}).category,'shipping');
  assert.equal(detectShipmentText('QR payment code',{hasQrCode:true}).category,null);
});
test('uses the requested exact invoice, VAT and packing-list filenames', () => {
  assert.equal(invoiceFilename('invoices','00123',false,1,'pdf'),'Inv 00123.pdf');
  assert.equal(invoiceFilename('invoices','00123',true,1,'jpg'),'VAT 00123.jpg');
  assert.equal(invoiceFilename('packing','00123',true,1,'pdf'),'Packing List Inv 00123.pdf');
  assert.equal(standardPath('CSQU3054383','invoices',1,1,'pdf','x.pdf',true,'SEAL123','','','00123',false),'Inv 00123.pdf');
  assert.match(invoiceFilename('invoices','',false,1,'pdf'),/^Inv Number unknown 01.pdf$/);
  const names=new Set();
  assert.equal(uniqueOutputName('Inv 001.pdf',names),'Inv 001.pdf');
  assert.equal(uniqueOutputName('Inv 001.pdf',names),'Inv 001_2.pdf');
});
test('validates AI invoice metadata and normalizes QR category without inventing a reference', () => {
  const file={id:'1',category:'invoices',container:null,seal:null,stage:'unknown',confidence:.95,quality:.8,documentType:'SHIPPING_DOC',duplicateOf:null,reason:'Invoice with QR',invoiceNumber:'0001/26',hasQrCode:true};
  const result=validateAIResult({files:[file]},['1'])[0];
  assert.equal(result.category,'vat');assert.equal(result.invoiceNumber,'0001-26');
  assert.throws(()=>validateAIResult({files:[{...file,hasQrCode:'yes'}]},['1']),/invoice metadata/);
  assert.equal(validateAIResult({files:[{...file,invoiceNumber:null}]},['1'])[0].invoiceNumber,'');
});
