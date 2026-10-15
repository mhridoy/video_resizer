export async function fingerprintPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(bitmap, 0, 0, 9, 8);
    const { data } = ctx.getImageData(0, 0, 9, 8), hash = [];
    const gray = offset => (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash.push(gray((y * 9 + x) * 4) > gray((y * 9 + x + 1) * 4));
    const colors = [];
    for (let i = 0; i < data.length; i += 4) colors.push(data[i], data[i + 1], data[i + 2]);
    return { hash, colors, aspect: bitmap.width / bitmap.height };
  } finally { bitmap.close(); }
}
