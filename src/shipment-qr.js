import jsQR from 'jsqr';
// Decode locally. QR payloads are not uploaded, logged, opened or treated as instructions.
export async function hasShipmentQr(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    for (const edge of [1800, 2800]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const image = ctx.getImageData(0,0,canvas.width,canvas.height);
      if (jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})) return true;
      if (scale === 1) break;
    }
    return false;
  } finally { bitmap.close(); canvas.width = canvas.height = 1; }
}
