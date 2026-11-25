// Bolt seals are small, saturated cyan or yellow plastic. Restrict the size and shape so a
// blue container door or a yellow bumper does not become a seal crop.
export function sealRegions(data, width, height, colors = ['cyan', 'yellow']) {
  const mask = new Uint8Array(width * height), visited = new Uint8Array(mask.length), regions = [];
  for (let i = 0; i < mask.length; i++) {
    const [r, g, b] = data.subarray(i * 4, i * 4 + 3);
    const cyan = b > 145 && g > 105 && g - r > 70 && b > g * .95;
    const yellow = r > 170 && g > 140 && b < 120 && r - b > 90 && Math.abs(r - g) < 70;
    mask[i] = (cyan && colors.includes('cyan')) || (yellow && colors.includes('yellow')) ? 1 : 0;
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
    // A seal fills most of its box, is no more than five times as long as wide, and covers less
    // than half the photo. A door's edge (a thin strip) or scattered paint does not.
    const box = w * h, aspect = Math.max(w / h, h / w);
    if (queue.length > mask.length * .015 && box < mask.length * .45 && queue.length / box > .4 && aspect <= 5) regions.push({ x: minX / width, y: minY / height, w: w / width, h: h / height, area: queue.length });
  }
  return regions.sort((a, b) => b.area - a.area).slice(0, 3);
}
