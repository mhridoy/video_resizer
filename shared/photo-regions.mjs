// Small saturated cyan regions are common on bolt seals. Restrict the size and
// shape so a blue container door does not become a seal crop.
export function sealRegions(data, width, height) {
  const mask = new Uint8Array(width * height), visited = new Uint8Array(mask.length), regions = [];
  for (let i = 0; i < mask.length; i++) {
    const [r, g, b] = data.subarray(i * 4, i * 4 + 3);
    mask[i] = b > 145 && g > 105 && g - r > 70 && b > g * .95 ? 1 : 0;
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    const queue = [i]; visited[i] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let pos = 0; pos < queue.length; pos++) {
      const pixel = queue[pos], x = pixel % width, y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const next of [x ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, pixel - width, pixel + width]) {
        if (next >= 0 && next < mask.length && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (queue.length > mask.length * .015 && w * h < mask.length * .18 && Math.max(w / h, h / w) > 1.25) regions.push({ x: minX / width, y: minY / height, w: w / width, h: h / height, area: queue.length });
  }
  return regions.sort((a, b) => b.area - a.area).slice(0, 3);
}
