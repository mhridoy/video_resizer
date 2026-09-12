import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDimensions, imageType } from '../shared/image-tools.mjs';

test('resize fits either landscape or portrait within bounds without upscaling', () => {
  assert.deepEqual(imageDimensions(4000, 3000, { width: 1920, height: 1080 }), { width: 1440, height: 1080 });
  assert.deepEqual(imageDimensions(3000, 4000, { width: 1920, height: 1080 }), { width: 810, height: 1080 });
  assert.deepEqual(imageDimensions(100, 50), { width: 100, height: 50 });
  assert.deepEqual(imageDimensions(1, 10000, { width: 100, height: 100 }), { width: 1, height: 100 });
});

test('compression and conversion preserve dimensions while all modes enforce memory limits', () => {
  for (const mode of ['image-compress', 'image-convert', 'images-pdf']) {
    assert.deepEqual(imageDimensions(4000, 3000, { mode, width: 100, height: 100 }), { width: 4000, height: 3000 });
    assert.throws(() => imageDimensions(10000, 10000, { mode }), /80 megapixels/);
  }
  for (const width of [0, -1, 8193, 2.5, NaN]) assert.throws(() => imageDimensions(100, 100, { width, height: 100 }), /whole numbers/);
  assert.throws(() => imageDimensions(0, 50), /invalid dimensions/);
});

test('supported image detection accepts MIME types and extension fallback', () => {
  assert.equal(imageType({ type: '', name: 'photo.JPEG' }), 'image/jpeg');
  assert.equal(imageType({ type: 'image/webp', name: 'photo' }), 'image/webp');
  assert.equal(imageType({ type: 'application/pdf', name: 'document.pdf' }), '');
});
