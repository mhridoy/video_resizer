import { createWorker } from 'tesseract.js';
import { detectShipmentText } from '../shared/shipment-detection.mjs';
import { sealRegions } from '../shared/photo-regions.mjs';

export async function createShipmentScanner() {
  const root = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  const worker = await createWorker('eng', 1, {
    workerPath: `${root}worker.min.js`, corePath: root, langPath: root, workerBlobURL: false,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  return {
    close: () => worker.terminate(),
    async scan(file, check = () => {}) {
      check();
      const { data } = await worker.recognize(file);
      check();
      const found = detectShipmentText(data.text);
      if (found.category) return found;
      // Keep a likely seal photo even when the engraved serial cannot be read.
      // Do not spend time retrying the serial: the photo is the required evidence.
      const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas');
      try {
        const ratio = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const regions = sealRegions(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        return regions.length ? { ...found, category: 'seals', possibleSeal: true } : found;
      } finally { bitmap.close(); canvas.width = canvas.height = 1; }
    },
  };
}
