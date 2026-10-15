// Transaction shared by desktop and browser folder adapters. Temporary recovery
// data is removed on success; source deletion never starts before staging finishes.
export const RECOVERY_PREFIX = '.binary-beat-recovery-';
export function checkedPath(value, flat = false) {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u001f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..') || (flat && value.includes('/'))) throw Error('Invalid replacement path.');
  return value;
}
export async function replaceFolder(io, originals, outputs, { check = () => {}, status = () => {} } = {}) {
  if (!originals.length || !outputs.length) throw Error('No complete folder output to replace.');
  const sourceNames = new Set(), targetNames = new Set();
  for (const original of originals) {
    checkedPath(original.path);
    if (sourceNames.has(original.path.toLowerCase())) throw Error('Ambiguous original filenames.');
    sourceNames.add(original.path.toLowerCase());
  }
  for (const output of outputs) {
    checkedPath(output.name, true);
    if (output.name.startsWith('.') || targetNames.has(output.name.toLowerCase())) throw Error('Invalid or duplicate output name.');
    targetNames.add(output.name.toLowerCase());
  }
  const preflight = async () => {
    for (const original of originals) { check(); await io.verify(original); }
    for (const entry of await io.listRoot()) {
      if (entry.name.startsWith(RECOVERY_PREFIX)) throw Error(`An interrupted replacement needs recovery: ${entry.name}. Restore its originals before importing again.`);
      if (targetNames.has(entry.name.toLowerCase()) && (entry.kind !== 'file' || !sourceNames.has(entry.name.toLowerCase()))) throw Error(`Output would overwrite an unrelated file: ${entry.name}`);
    }
  };
  await preflight(); check();
  const temporary = RECOVERY_PREFIX + crypto.randomUUID();
  await io.mkdir(temporary);
  const removed = [], written = [];
  let committing = false;
  try {
    await io.write(`${temporary}/recovery.json`, new TextEncoder().encode(JSON.stringify({ originals: originals.map(o => o.path), outputs: outputs.map(o => o.name) })), true);
    for (const [index, original] of originals.entries()) {
      check(); status(`Preparing replacement: protecting original ${index + 1} of ${originals.length}…`);
      await io.verify(original);
      await io.copy(original.path, `${temporary}/originals/${original.path}`);
      await io.verify(original);
    }
    for (const output of outputs) {
      check(); await io.write(`${temporary}/prepared/${output.name}`, output.data, true);
    }
    // Verify all sources again immediately before touching any originals.
    for (const original of originals) { check(); await io.verify(original); }
    // Detect new unrelated destinations created while outputs were staged.
    for (const entry of await io.listRoot()) if (targetNames.has(entry.name.toLowerCase()) && (entry.kind !== 'file' || !sourceNames.has(entry.name.toLowerCase()))) throw Error(`A new file conflicts with output: ${entry.name}`);
    committing = true;
    for (const original of originals) {
      check(); await io.verify(original); await io.remove(original.path); removed.push(original.path);
    }
    for (const [index, output] of outputs.entries()) {
      check(); status(`Replacing files in the original folder: ${index + 1} of ${outputs.length}…`);
      await io.copy(`${temporary}/prepared/${output.name}`, output.name); written.push(output.name);
    }
  } catch (error) {
    const rollbackErrors = [];
    if (committing) {
      for (const name of written.reverse()) try { await io.remove(name); } catch (failure) { rollbackErrors.push(failure); }
      for (const name of removed) try { await io.copy(`${temporary}/originals/${name}`, name); } catch (failure) { rollbackErrors.push(failure); }
    }
    if (!rollbackErrors.length) {
      try { await io.removeTree(temporary); } catch { /* Keep recovery data if cleanup is refused. */ }
      throw Error(`${error.message} ${committing ? 'Original files were restored. Re-select the source folder before retrying.' : 'Original files were not changed.'}`);
    }
    throw Error(`Replacement stopped. Original backups are in ${temporary}/originals. Keep this folder for recovery. ${error.message}`);
  }
  // A cleanup failure must never roll back a completed replacement after some
  // backups may already have been removed.
  let cleanupWarning = '';
  try { await io.removeTree(temporary); }
  catch { cleanupWarning = `Files replaced, but temporary recovery data remains in ${temporary}.`; }
  const directories = new Set(originals.flatMap(original => { const parts = original.path.split('/'); parts.pop(); return parts.map((_, index) => parts.slice(0, index + 1).join('/')); }));
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try { await io.removeEmptyDirectory?.(directory); } catch { /* Leave nonempty or newly changed folders alone. */ }
  }
  return { count: outputs.length, cleanupWarning };
}
