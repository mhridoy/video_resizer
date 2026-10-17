import { hasShipmentQr } from './shipment-qr.js';
import { createWorker } from 'tesseract.js';
import { detectShipmentText } from '../shared/shipment-detection.mjs';
import { sealRegions } from '../shared/photo-regions.mjs';
import { readPhoto } from './photo-source.js';
import { photoConcurrency } from '../shared/parallel.mjs';

async function startWorker() {
  const root = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  const worker = await createWorker('eng', 1, {
    workerPath: `${root}worker.min.js`, corePath: root, langPath: root, workerBlobURL: false,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  return worker;
}

/**
 * Reads shipment numbers off photos. Engines are started in parallel so several photos can
 * be read at once; `scan` takes whichever engine is free, so callers just run concurrently.
 */
export async function createShipmentScanner(size = photoConcurrency()) {
  const workers = await Promise.all(Array.from({ length: Math.max(1, size) }, startWorker));
  const idle = [...workers];
  const waiting = [];
  const take = () => idle.length ? Promise.resolve(idle.pop()) : new Promise(resolve => waiting.push(resolve));
  const give = worker => { const next = waiting.shift(); if (next) next(worker); else idle.push(worker); };
  return {
    size: workers.length,
    close: () => Promise.all(workers.map(worker => worker.terminate())),
    async scan(input, check = () => {}, knownQr) {
      check();
      // One decode per photo: the OCR copy, the QR pixels and the seal crop all come from it.
      const source = input.stretchTo ? input : await readPhoto(input);
      const worker = await take();
      try {
        check();
        const { data } = await worker.recognize(source.textCanvas());
        check();
        const hasQrCode = knownQr ?? await hasShipmentQr(source);
        check();
        const found = detectShipmentText(data.text, { hasQrCode });
        if (found.category) return found;
        // Keep a likely seal photo even when the engraved serial cannot be read.
        // Do not spend time retrying the serial: the photo is the required evidence.
        const { canvas, context } = source.viewAt(320);
        try {
          const regions = sealRegions(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          return regions.length ? { ...found, category: 'seals', possibleSeal: true } : found;
        } finally { canvas.width = canvas.height = 1; }
      } finally {
        give(worker);
        if (source !== input) source.close();
      }
    },
  };
}
