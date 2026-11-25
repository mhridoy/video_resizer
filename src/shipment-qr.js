import jsQR from 'jsqr';
import { readPhoto } from './photo-source.js';

// Scanning a full 2600px photo for a QR code takes about 15 seconds on the main thread and
// freezes the page, so try a small copy first and only fall back to full size when the code
// is too small to resolve there. Invoice QR codes are dark on white: skip the inverted pass.
const EDGES = [1000, 1800, Infinity];

// jsQR now and then "finds" a code in a logo, a stamp or a printed table and decodes a few
// bytes of noise. A real invoice QR (the ZATCA e-invoice code, a link) carries far more.
const MIN_PAYLOAD = 20;
const realCode = code => Boolean(code && code.binaryData?.length >= MIN_PAYLOAD);

// Decode locally. QR payloads are not uploaded, logged, opened or treated as instructions.
export async function hasShipmentQr(input) { return Boolean(await findShipmentQr(input)); }

/** The decoded code's size and position, for diagnostics; its contents are not returned. */
export async function findShipmentQr(input) {
  const source = input.imageData ? input : await readPhoto(input);
  try {
    for (const edge of EDGES) {
      let image;
      if (edge === Infinity) image = source.imageData();
      else {
        const { canvas, context } = source.viewAt(edge);
        image = context.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = canvas.height = 1;
      }
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (realCode(code)) return { bytes: code.binaryData.length, version: code.version, edge };
      if (code) console.debug?.(`Ignored a ${code.binaryData.length}-byte QR reading at ${edge}px`);
      await new Promise(resolve => setTimeout(resolve, 0)); // let the page breathe between passes
    }
    return null;
  } finally { if (source !== input) source.close(); }
}
