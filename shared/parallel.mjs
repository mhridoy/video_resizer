// Runs work over a list with a bounded number in flight, keeping results in input order.
// Photo reading is CPU-bound, so an unbounded fan-out would thrash memory instead of helping.
export async function mapLimit(items, limit, worker) {
  const count = Math.max(1, Math.floor(limit));
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, runner));
  return results;
}

// One worker per spare core, capped: each parallel photo holds a decoded canvas and an
// OCR engine, so more than a handful costs memory without reading any faster.
export const photoConcurrency = (cores = globalThis.navigator?.hardwareConcurrency) =>
  Math.max(1, Math.min(4, (Number.isFinite(cores) && cores > 1 ? cores : 2) - 1));
