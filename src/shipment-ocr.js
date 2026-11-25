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
// Ordinary photos read in about a second. A busy, grainy picture can keep the engine busy
// for minutes without finding anything, so a photo gets this long before it is given up on
// (it stays in the pack, marked for review) and its engine is replaced by a fresh one.
const PHOTO_TIME_LIMIT = 15_000;
const timedOut = () => Object.assign(Error('Reading this photo took too long.'), { timedOut: true });

export async function createShipmentScanner(size = photoConcurrency()) {
  const workers = new Set(await Promise.all(Array.from({ length: Math.max(1, size) }, startWorker)));
  const idle = [...workers];
  const waiting = [];
  let closed = false;
  const take = () => idle.length ? Promise.resolve(idle.pop()) : new Promise(resolve => waiting.push(resolve));
  const give = worker => { const next = waiting.shift(); if (next) next(worker); else idle.push(worker); };
  const recognize = async (worker, canvas) => {
    let timer;
    try {
      return await Promise.race([worker.recognize(canvas), new Promise((_, reject) => { timer = setTimeout(() => reject(timedOut()), PHOTO_TIME_LIMIT); })]);
    } finally { clearTimeout(timer); }
  };
  // Terminating is the only way to stop a recognition in progress.
  const replace = async worker => {
    workers.delete(worker); worker.terminate().catch(() => {});
    if (closed) return undefined;
    const fresh = await startWorker();
    if (closed) { fresh.terminate().catch(() => {}); return undefined; }
    workers.add(fresh); return fresh;
  };
  return {
    size: workers.size,
    close: () => { closed = true; return Promise.all([...workers].map(worker => worker.terminate())); },
    async scan(input, check = () => {}, knownQr) {
      check();
      // One decode per photo: the OCR copy, the QR pixels and the seal crop all come from it.
      const source = input.stretchTo ? input : await readPhoto(input);
      let worker = await take();
      try {
        check();
        let data;
        try { ({ data } = await recognize(worker, source.textCanvas())); }
        catch (error) { if (error.timedOut) worker = await replace(worker); throw error; }
        check();
        // A QR code only decides between an ordinary and a VAT invoice, and looking for one
        // is the slowest step there is, so only invoices are searched.
        let found = detectShipmentText(data.text, { hasQrCode: knownQr === true });
        if (found.category === 'invoices' && knownQr === undefined) {
          const hasQrCode = await hasShipmentQr(source);
          check();
          if (hasQrCode) found = detectShipmentText(data.text, { hasQrCode });
        }
        if (found.category) return { ...found, text: data.text };
        // Keep a likely seal photo even when the engraved serial cannot be read.
        // Do not spend time retrying the serial: the photo is the required evidence.
        const { canvas, context } = source.viewAt(320);
        try {
          const regions = sealRegions(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          return { ...found, text: data.text, ...(regions.length ? { category: 'seals', possibleSeal: true } : {}) };
        } finally { canvas.width = canvas.height = 1; }
      } finally {
        if (worker) give(worker);
        if (source !== input) source.close();
      }
    },
  };
}
