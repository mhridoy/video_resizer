// "Scanner" for phone photos of paper documents (weight tickets, invoices): find the sheet,
// straighten it, and clean it up so it reads like a flatbed scan. Pure functions on RGBA
// pixel arrays ({ data, width, height }), so they run the same in a browser or in tests.

const clamp = (value, low, high) => value < low ? low : value > high ? high : value;

// Otsu's threshold on an 8-bit histogram.
function otsu(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumBack = 0, weightBack = 0, best = 0, threshold = 128;
  for (let i = 0; i < 256; i++) {
    weightBack += histogram[i];
    if (!weightBack) continue;
    const weightFore = total - weightBack;
    if (!weightFore) break;
    sumBack += i * histogram[i];
    const meanBack = sumBack / weightBack, meanFore = (sum - sumBack) / weightFore;
    const between = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

/**
 * Finds the four corners of the sheet in a (small) photo: the largest bright, unsaturated
 * region. Returns [topLeft, topRight, bottomRight, bottomLeft] as {x, y} in pixels of this
 * image, or null when no sheet stands out from the background (a photo that is all paper).
 */
export function findSheet({ data, width, height }) {
  const count = width * height;
  const light = new Uint8Array(count), histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const value = (r + g + b) / 3 | 0;
    light[i] = value; histogram[value]++;
  }
  const threshold = Math.max(110, otsu(histogram, count));
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    mask[i] = light[i] > threshold && Math.max(r, g, b) - Math.min(r, g, b) < 70 ? 1 : 0;
  }
  // Close small gaps (printed lines and text inside the sheet) so the sheet is one region.
  const closed = dilate(dilate(mask, width, height), width, height);
  // Largest connected region.
  const label = new Int32Array(count).fill(-1);
  let bestSize = 0, bestLabel = -1;
  const queue = new Int32Array(count);
  for (let start = 0, next = 0; start < count; start++) {
    if (!closed[start] || label[start] !== -1) continue;
    let head = 0, tail = 0; queue[tail++] = start; label[start] = next;
    while (head < tail) {
      const p = queue[head++], x = p % width;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n >= 0 && n < count && closed[n] && label[n] === -1) { label[n] = next; queue[tail++] = n; }
      }
    }
    if (tail > bestSize) { bestSize = tail; bestLabel = next; }
    next++;
  }
  // A sheet must be a good part of the photo but not all of it (then there is nothing to crop).
  if (bestSize < count * 0.15) return null;
  let tl, tr, br, bl, sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity, touches = 0;
  for (let p = 0; p < count; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % width, y = (p / width) | 0;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches++;
    const s = x + y, d = x - y;
    if (s < sMin) { sMin = s; tl = { x, y }; }
    if (s > sMax) { sMax = s; br = { x, y }; }
    if (d > dMax) { dMax = d; tr = { x, y }; }
    if (d < dMin) { dMin = d; bl = { x, y }; }
  }
  const quad = [tl, tr, br, bl];
  const area = Math.abs(quad.reduce((sum, point, i) => { const next = quad[(i + 1) % 4]; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2;
  if (area < count * 0.15) return null;
  // Filling the whole frame (the edges are the photo's, not the paper's): nothing to straighten.
  if (area > count * 0.97 || touches > (width + height) * 1.2) return null;
  return quad;
}

function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    out[p] = mask[p] || (x > 0 && mask[p - 1]) || (x < width - 1 && mask[p + 1]) || (y > 0 && mask[p - width]) || (y < height - 1 && mask[p + width]) ? 1 : 0;
  }
  return out;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Output size for a straightened sheet: its real proportions, long edge capped. */
export function sheetSize(quad, maxEdge = 2200) {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(distance(tl, tr), distance(bl, br)), height = Math.max(distance(tl, bl), distance(tr, br));
  const scale = Math.min(1.6, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Homography mapping the output rectangle (0,0)-(w,h) to the quad, by solving the 8x8 system.
function homography(quad, width, height) {
  const source = [[0, 0], [width, 0], [width, height], [0, height]];
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = source[i], { x: u, y: v } = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    [A[col], A[pivot]] = [A[pivot], A[col]]; [B[col], B[pivot]] = [B[pivot], B[col]];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = A[row][col] / A[col][col];
      for (let k = col; k < 8; k++) A[row][k] -= factor * A[col][k];
      B[row] -= factor * B[col];
    }
  }
  return B.map((value, i) => value / A[i][i]);
}

/** Straightens the quad of `image` into a width x height RGBA image (bilinear sampling). */
export function warpSheet(image, quad, width, height) {
  const [a, b, c, d, e, f, g, h] = homography(quad, width, height);
  const src = image.data, W = image.width, H = image.height;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = g * x + h * y + 1;
      const u = clamp((a * x + b * y + c) / w, 0, W - 1.001), v = clamp((d * x + e * y + f) / w, 0, H - 1.001);
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const p00 = (y0 * W + x0) * 4, p10 = p00 + 4, p01 = p00 + W * 4, p11 = p01 + 4;
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] = (src[p00 + k] * (1 - fx) + src[p10 + k] * fx) * (1 - fy) + (src[p01 + k] * (1 - fx) + src[p11 + k] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/**
 * Cleans a sheet like a scanner's "document" mode: divides out uneven lighting and shadows,
 * turns the paper white and strengthens the ink, keeping coloured stamps and handwriting.
 * Works in place.
 */
export function enhanceSheet(image) {
  const { data, width, height } = image;
  // Background light: the brightest nearby paper. Estimate on a coarse grid, take a local
  // maximum so text and lines do not darken it, then blur and sample it back up.
  const cell = Math.max(4, Math.round(Math.max(width, height) / 160));
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  // One grid per colour channel, taken from each cell's brightest pixel: dividing by the
  // paper's own colour also removes the blue or yellow cast of the light it was shot under.
  let grids = [0, 1, 2].map(() => new Float32Array(gw * gh));
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let best = -1, at = 0;
    for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x += 2) {
      const p = (y * width + x) * 4, value = data[p] + data[p + 1] + data[p + 2];
      if (value > best) { best = value; at = p; }
    }
    for (let k = 0; k < 3; k++) grids[k][gy * gw + gx] = data[at + k];
  }
  const spread = (input, radius, pick) => {
    const out = new Float32Array(input.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let acc = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const value = input[yy * gw + xx];
        if (pick === 'max') acc = Math.max(acc, value); else { acc += value; n++; }
      }
      out[y * gw + x] = pick === 'max' ? acc : acc / n;
    }
    return out;
  };
  grids = grids.map(grid => spread(spread(grid, 2, 'max'), 3, 'mean'));
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1.001, Math.max(0, y / cell - 0.5)), y0 = gy | 0, fy = gy - y0, y1 = Math.min(gh - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gw - 1.001, Math.max(0, x / cell - 0.5)), x0 = gx | 0, fx = gx - x0, x1 = Math.min(gw - 1, x0 + 1);
      const p = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const grid = grids[k];
        const background = Math.max(40,
          (grid[y0 * gw + x0] * (1 - fx) + grid[y0 * gw + x1] * fx) * (1 - fy) + (grid[y1 * gw + x0] * (1 - fx) + grid[y1 * gw + x1] * fx) * fy);
        // Normalise to the paper, then a contrast curve: paper to white, ink darker.
        let value = data[p + k] / background;
        value = value >= 0.88 ? 1 : (value / 0.88) ** 2.4;
        data[p + k] = clamp(value * 255, 0, 255);
      }
    }
  }
  return image;
}

/**
 * The whole scan on a photo. `small` is a downscaled copy used to find the sheet, `full` the
 * full-resolution photo. Returns { image, found } where found says whether a sheet was cropped.
 */
export function scanDocument(full, small, { maxEdge = 2200 } = {}) {
  const quad = findSheet(small);
  let image;
  if (quad) {
    const scale = full.width / small.width;
    const corners = quad.map(point => ({ x: point.x * scale, y: point.y * scale }));
    const size = sheetSize(corners, maxEdge);
    image = warpSheet(full, corners, size.width, size.height);
  } else image = { data: new Uint8ClampedArray(full.data), width: full.width, height: full.height };
  return { image: enhanceSheet(image), found: Boolean(quad) };
}
