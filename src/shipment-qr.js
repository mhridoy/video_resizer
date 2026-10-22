import jsQR from 'jsqr';
import { readPhoto } from './photo-source.js';
// Decode locally. QR payloads are not uploaded, logged, opened or treated as instructions.
export async function hasShipmentQr(input) {
  const source = input.imageData ? input : await readPhoto(input);
  try {
    const image = source.imageData();
    return Boolean(jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }));
  } finally { if (source !== input) source.close(); }
}
