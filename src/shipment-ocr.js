import { hasShipmentQr } from './shipment-qr.js';
import { createWorker } from 'tesseract.js';
import { detectShipmentText, sealsFromCloseUp } from '../shared/shipment-detection.mjs';
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
        const read = async canvas => {
          try { return (await recognize(worker, canvas)).data; }
          catch (error) { if (error.timedOut) worker = await replace(worker); throw error; }
        };
        data = await read(source.textCanvas());
        check();
        check();
        // A QR code only decides between an ordinary and a VAT invoice, and looking for one
        // is the slowest step there is, so only invoices are searched.
        let found = detectShipmentText(data.text, { hasQrCode: knownQr === true });
        if (found.category === 'invoices' && knownQr === undefined) {
          const hasQrCode = await hasShipmentQr(source);
          check();
          if (hasQrCode) found = detectShipmentText(data.text, { hasQrCode });
        }
        if (found.category || found.containers.length) return { ...found, text: data.text };
        // A seal photo: find the seal's coloured plastic, enlarge it and read its serial,
        // which runs along the seal's body and is usually photographed sideways.
        const { canvas: small, context } = source.viewAt(320);
        const pixels = context.getImageData(0, 0, small.width, small.height).data;
        // Cyan plastic is a seal on its own; yellow (bumpers, stripes) only once a serial is read.
        const cyan = sealRegions(pixels, small.width, small.height, ['cyan']).length > 0;
        const regions = sealRegions(pixels, small.width, small.height);
        small.width = small.height = 1;
        if (!regions.length) return { ...found, text: data.text };
        // Tight crops read best; two sizes and three turns, stopping at the first serial.
        let closeUp = '';
        search: for (const region of regions.slice(0, 2)) {
          for (const edge of [600, 900]) for (const turn of [0, 1, -1]) {
            const crop = source.crop(region, { pad: 0.04, edge, turn });
            try { closeUp += '\n' + (await read(crop)).text; } finally { crop.width = crop.height = 1; }
            check();
            if (sealsFromCloseUp(closeUp).length) break search;
          }
        }
        const seals = sealsFromCloseUp(closeUp);
        // Part of a serial ("8936") lets the import match this photo to a seal read elsewhere.
        const sealDigits = [...new Set(closeUp.match(/\d{4,10}/g) || [])];
        if (!seals.length && !cyan) return { ...found, text: `${data.text}\n${closeUp}`, sealDigits };
        return { ...found, text: `${data.text}\n${closeUp}`, seals: [...found.seals, ...seals], category: 'seals', possibleSeal: !seals.length };
      } finally {
        if (worker) give(worker);
        if (source !== input) source.close();
      }
    },
  };
}
