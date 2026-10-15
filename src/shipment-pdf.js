import './map-polyfill.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { detectShipmentText } from '../shared/shipment-detection.mjs';
GlobalWorkerOptions.workerSrc = workerURL;
export async function readShipmentPdf(file, scanner, check) {
  const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const readings = [];
  try {
    const pdf = await loading.promise;
    for (let n = 1; n <= Math.min(pdf.numPages, 3); n++) {
      check();
      const page = await pdf.getPage(n), content = await page.getTextContent();
      const text = content.items.map(item => item.str || '').join(' ');
      let found = detectShipmentText(text);
      if (text.trim().length < 30 && scanner) {
        const original = page.getViewport({scale: 1}), viewport = page.getViewport({scale: Math.min(2, 2000 / Math.max(original.width, original.height))});
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try {
          await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) found = await scanner.scan(blob, check);
        } finally { canvas.width = canvas.height = 1; }
      }
      readings.push(found); page.cleanup();
    }
    return {
      containers: [...new Map(readings.flatMap(value => value.containers).map(value => [value.id, value])).values()],
      seals: [...new Map(readings.flatMap(value => value.seals).map(value => [value.id, value])).values()],
      category: readings.find(value => value.category)?.category,
      documentType: readings.find(value => value.documentType)?.documentType,
    };
  } finally { await loading.destroy(); }
}

// A bounded first-page preview for vision; the original PDF remains local.
export async function shipmentPdfPreview(file) {
  const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await loading.promise, page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(original.width, original.height)) });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    try {
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
    } finally { canvas.width = canvas.height = 1; page.cleanup(); }
  } finally { await loading.destroy(); }
}
