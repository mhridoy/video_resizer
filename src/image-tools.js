import { IMAGE_TYPES, imageDimensions } from '../shared/image-tools.mjs';

export async function encodeImage(file, { mode = 'image', width, height, type = 'image/jpeg', quality = 0.8 } = {}) {
  if (!IMAGE_TYPES.includes(type)) throw Error('Choose JPG, PNG or WebP output.');
  if (!Number.isFinite(quality) || quality < 0.2 || quality > 1) throw Error('Quality must be between 20 and 100.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw Error('Cannot read this image. Choose a valid JPG, PNG or WebP file.'); }
  let canvas;
  try {
    const dimensions = imageDimensions(bitmap.width, bitmap.height, { mode, width, height });
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('Image processing is unavailable in this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.type !== type) throw Error('This browser cannot export the selected image format. Try JPG or PNG.');
    return { blob, ...dimensions };
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
}
