import test from 'node:test';
import assert from 'node:assert/strict';
import { mp4Duration } from '../shared/mp4-duration.mjs';

const be32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const box = (type, ...bodies) => { const body = bodies.flat(); return [...be32(8 + body.length), ...[...type].map(c => c.charCodeAt(0)), ...body]; };
const file = bytes => { const data = Uint8Array.from(bytes); return [async (start, end) => data.slice(start, end), data.length]; };

test('reads duration from mvhd when moov comes after the media', async () => {
  const mvhd = box('mvhd', [0, 0, 0, 0], be32(0), be32(0), be32(600), be32(18000), new Array(80).fill(0));
  const bytes = [...box('ftyp', [...'qt  '].map(c => c.charCodeAt(0)), be32(0)), ...box('mdat', new Array(5000).fill(7)), ...box('moov', mvhd)];
  assert.equal(await mp4Duration(...file(bytes)), 30);
});

test('returns 0 for a file without a movie header', async () => {
  assert.equal(await mp4Duration(...file(box('mdat', [1, 2, 3]))), 0);
});
