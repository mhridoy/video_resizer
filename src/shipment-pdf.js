import './map-polyfill.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { detectShipmentText } from '../shared/shipment-detection.mjs';
import { hasShipmentQr } from './shipment-qr.js';
GlobalWorkerOptions.workerSrc = workerURL;
const openPdf = async file => getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
async function renderPage(page, edge = 2200) {
  const original = page.getViewport({scale:1}), viewport = page.getViewport({scale:Math.min(2.5,edge/Math.max(original.width,original.height))});
  const canvas = document.createElement('canvas'); canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  try {
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
  } finally {canvas.width=canvas.height=1;}
}
export async function readShipmentPdf(file, scanner, check) {
  const loading = await openPdf(file), readings=[];
  try {
    const pdf=await loading.promise;
    for(let n=1;n<=Math.min(pdf.numPages,3);n++) {
      check();const page=await pdf.getPage(n), content=await page.getTextContent();
      const text=content.items.map(item=>(item.str||'')+(item.hasEOL?'\n':' ')).join('');
      const preview=await renderPage(page), hasQrCode=await hasShipmentQr(preview);
      let found={...detectShipmentText(text,{hasQrCode}),text};
      if(text.trim().length<30 && scanner) found=await scanner.scan(preview,check,hasQrCode);
      readings.push(found);page.cleanup();
    }
    const numbers=[...new Set(readings.map(value=>value.invoiceNumber).filter(Boolean))];
    let category=readings.find(value=>value.category)?.category;
    const hasQrCode=readings.some(value=>value.hasQrCode);
    if(category==='invoices' && hasQrCode) category='vat';
    return {
      containers:[...new Map(readings.flatMap(value=>value.containers).map(value=>[value.id,value])).values()],
      seals:[...new Map(readings.flatMap(value=>value.seals).map(value=>[value.id,value])).values()],
      category,hasQrCode,invoiceNumber:numbers.length===1?numbers[0]:'',invoiceConflict:numbers.length>1||readings.some(value=>value.invoiceConflict),
      documentType:readings.find(value=>value.documentType)?.documentType,
      text:readings.map(value=>value.text||'').join('\n'),
    };
  } finally {await loading.destroy();}
}
export async function shipmentPdfPreviews(file, check = () => {}) {
  const loading=await openPdf(file), previews=[];
  try {
    const pdf=await loading.promise;
    for(let n=1;n<=Math.min(pdf.numPages,3);n++) {
      check(); const page=await pdf.getPage(n);
      previews.push(await renderPage(page));page.cleanup();
    }
    return previews;
  } finally {await loading.destroy();}
}
