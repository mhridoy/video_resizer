import { readPhoto } from './photo-source.js';
export async function fingerprintPhoto(input) {
  const source = input.stretchTo ? input : await readPhoto(input);
  try {
    const { data } = source.stretchTo(9, 8);
    const hash = [];
    const gray = offset => (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash.push(gray((y * 9 + x) * 4) > gray((y * 9 + x + 1) * 4));
    const colors = [];
    for (let i = 0; i < data.length; i += 4) colors.push(data[i], data[i + 1], data[i + 2]);
    return { hash, colors, aspect: source.aspect };
  } finally { if (source !== input) source.close(); }
}
