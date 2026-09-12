import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { pageGroups, mergePDF, splitPDF, compressPDF } from '../shared/pdf-tools.mjs';
async function fixture(widths) { const d=await PDFDocument.create();widths.forEach(w=>d.addPage([w,200]));return d.save({useObjectStreams:false}); }
test('merge and split preserve requested page order and reject invalid ranges',async()=>{
 const a=await fixture([100,110]),b=await fixture([120]);
 const merged=await mergePDF([a,b]);const doc=await PDFDocument.load(merged);assert.deepEqual(doc.getPages().map(p=>p.getWidth()),[100,110,120]);
 const parts=await splitPDF(merged,'3,1;2');assert.equal(parts.length,2);assert.deepEqual((await PDFDocument.load(parts[0])).getPages().map(p=>p.getWidth()),[120,100]);
 assert.equal((await splitPDF(merged,'')).length,3);
 for(const bad of ['0','4','2-1','x','1;'])assert.throws(()=>pageGroups(bad,3));
});
test('compression returns a valid PDF and never increases file size',async()=>{
 const a=await fixture([100,110,120]);const b=await compressPDF(a);assert.ok(b.length<=a.length);assert.equal((await PDFDocument.load(b)).getPageCount(),3);
 await assert.rejects(()=>compressPDF(new Uint8Array([1,2,3])),/valid, unlocked/);
});
