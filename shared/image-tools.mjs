export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function imageDimensions(sourceWidth, sourceHeight, { mode = 'image', width = 1920, height = 1080 } = {}) {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) throw Error('This image has invalid dimensions.');
  if (sourceWidth * sourceHeight > 80_000_000) throw Error('Image is too large. Use images below 80 megapixels.');
  if (mode !== 'image') return { width: sourceWidth, height: sourceHeight };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) throw Error('Width and height must be whole numbers between 1 and 8192.');
  const factor = Math.min(width / sourceWidth, height / sourceHeight, 1);
  return { width: Math.max(1, Math.round(sourceWidth * factor)), height: Math.max(1, Math.round(sourceHeight * factor)) };
}

export function imageType(file) {
  if (IMAGE_TYPES.includes(file.type)) return file.type;
  const extension = file.name?.split('.').pop().toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[extension] || '';
}
