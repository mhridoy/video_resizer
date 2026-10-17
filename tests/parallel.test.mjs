import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit, photoConcurrency } from '../shared/parallel.mjs';

// Each task waits for this test to release it, so the assertions never depend on timing.
const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };

test('keeps the limit, starts the next task on release, and preserves order', async () => {
  const gates = Array.from({ length: 5 }, gate);
  const started = [];
  let running = 0, peak = 0;
  const all = mapLimit([0, 1, 2, 3, 4], 2, async index => {
    started.push(index); running++; peak = Math.max(peak, running);
    await gates[index].promise;
    running--;
    return index * 10;
  });
  await Promise.resolve();
  assert.deepEqual(started, [0, 1], 'only two tasks may run at once');
  gates[0].open();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2], 'a finished task frees its lane for the next one');
  gates.forEach(value => value.open());
  assert.deepEqual(await all, [0, 10, 20, 30, 40], 'results stay in input order');
  assert.equal(peak, 2);
});

test('handles an empty list and a limit below one', async () => {
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
