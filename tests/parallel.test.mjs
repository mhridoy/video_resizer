import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit, photoConcurrency } from '../shared/parallel.mjs';

test('runs work in parallel without exceeding the limit or losing order', async () => {
  let running = 0, peak = 0;
  const order = [];
  const results = await mapLimit([10, 1, 5, 1, 1, 1], 3, async (value, index) => {
    running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, value));
    order.push(index); running--;
    return value * 2;
  });
  assert.deepEqual(results, [20, 2, 10, 2, 2, 2]);
  assert.equal(peak, 3);
  // The slowest item started first but finished last: the others did not wait for it.
  assert.equal(order.at(-1), 0);
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 0, async value => value), [1, 2]);
});

test('leaves a core free and never runs away on a many-core machine', () => {
  assert.equal(photoConcurrency(1), 1);
  assert.equal(photoConcurrency(2), 1);
  assert.equal(photoConcurrency(4), 3);
  assert.equal(photoConcurrency(32), 4);
  for (const unknown of [0, NaN, 'four', null]) assert.equal(photoConcurrency(unknown), 1, String(unknown));
});
