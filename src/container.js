import { fileKind, limitBytes, safeRelativePath, extensionOf } from '../shared/fit-size.mjs';
import { CATEGORIES, categoryById, parseContainer, detectContainer, categorize, standardPath, packParts, manifestCsv } from '../shared/container.mjs';
import { shrinkFile, cancelShrink } from './shrink.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const native = window.desktop;
const KIND_ICON = { image: 'image', video: 'video', pdf: 'file', doc: 'file', other: 'file' };
const STATE = { queued: 'Pending', processing: 'Processing', done: 'Reduced', kept: 'Within limit', error: 'Failed', cancelled: 'Cancelled' };
let items = [], busy = false, cancelled = false, epoch = 0, packs = [], nextId = 1;

const formatSize = n => !n ? '0 KB' : n < 1024 ** 2 ? `${Math.max(0.1, n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
const setStatus = message => { $('cp-status').textContent = message; };
const pending = () => packs.length && items.some(item => item.output && !item.saved);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const reference = () => $('cp-reference').value.trim().replace(/[^\w.-]+/g, '-').slice(0, 40);

function defaultContainer() {
  const parsed = parseContainer($('cp-container').value);
  return parsed?.id || '';
}
const containerOf = item => item.container?.id || defaultContainer() || 'Unassigned';

export function activateContainerTool() {
  $('cp-hint').textContent = native ? 'Photos, videos, PDF and Office files · Native video engine' : 'Photos, videos (up to 1 GB each), PDF and Office files';
  syncContainerField(); syncPresets(); render();
}

// ---------- Import ----------
function addFiles(list) {
  if (busy) return;
  const known = new Set(items.map(item => `${item.path}|${item.file.size}`));
  let added = 0, skipped = 0;
  for (const file of list) {
    const path = safeRelativePath(file.relativeName || file.webkitRelativePath || file.name);
    const kind = fileKind(path);
    if (kind === 'skip' || !file.size) { skipped++; continue; }
    if (known.has(`${path}|${file.size}`)) continue;
    known.add(`${path}|${file.size}`);
    items.push({ id: nextId++, file, path, kind, category: categorize(path), container: detectContainer(path), status: 'queued', progress: 0 });
    added++;
  }
  sortItems(); clearPacks(); render();
  const containers = new Set(items.map(item => item.container?.id).filter(Boolean));
  setStatus(added ? `${added} ${added === 1 ? 'file' : 'files'} imported${containers.size ? ` · ${containers.size} container ${containers.size === 1 ? 'number' : 'numbers'} detected` : ''}${skipped ? ` · ${skipped} system or empty files ignored` : ''}. Review the categories, then prepare the files.` : 'No new files were imported.');
}

function sortItems() {
  const order = Object.fromEntries(CATEGORIES.map((category, index) => [category.id, index]));
  items.sort((a, b) => containerOf(a).localeCompare(containerOf(b)) || order[a.category] - order[b.category] || a.path.localeCompare(b.path, undefined, { numeric: true }));
}

// ---------- Table ----------
function resultText(item) {
  if (item.status === 'error') return item.error;
  if (item.status === 'processing') return `${Math.round(item.progress)}%`;
  if (item.output) return item.status === 'kept' ? formatSize(item.output.size) : `${formatSize(item.output.size)} · −${Math.max(0, Math.round((1 - item.output.size / item.file.size) * 100))}%`;
  return '—';
}

function rowFor(item) {
  if (!item.row) {
    const tr = el('tr');
    const file = el('td', 'cell-file');
    const fileIcon = el('span', `file-icon ${item.kind}`); fileIcon.innerHTML = icon(KIND_ICON[item.kind]);
    const names = el('div', 'file-names');
    const name = el('strong', '', item.path.split('/').pop()); name.title = item.path;
    const folder = el('small', '', item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : 'Selected file');
    names.append(name, folder); file.append(fileIcon, names);
    const container = el('td', 'cell-container');
    const category = el('td');
    const select = el('select', 'table-select'); select.setAttribute('aria-label', `Category for ${item.path}`);
    for (const option of CATEGORIES) select.append(new Option(option.label, option.id));
    select.onchange = () => { item.category = select.value; clearPacks(); sortItems(); render(); };
    category.append(select);
    const size = el('td', 'num');
    const result = el('td', 'cell-result');
    const badge = el('span', 'status-badge'); const detail = el('span', 'result-detail');
    const bar = el('progress'); bar.max = 100;
    result.append(badge, detail, bar);
    tr.append(file, container, category, size, result);
    item.row = { tr, container, select, size, badge, detail, bar };
  }
  const { tr, container, select, size, badge, detail, bar } = item.row;
  const id = containerOf(item);
  container.replaceChildren(el('span', `mono${item.container ? '' : ' muted'}`, id));
  if (item.container && !item.container.valid) container.append(el('span', 'flag', 'Check digit'));
  container.title = item.container ? (item.container.valid ? 'Detected from folder or file name' : 'Detected, but the ISO 6346 check digit does not match') : 'Uses the default container number';
  select.value = item.category; select.disabled = busy;
  size.textContent = formatSize(item.file.size);
  badge.className = `status-badge ${item.status}`; badge.textContent = STATE[item.status];
  detail.textContent = resultText(item); detail.title = item.note || item.error || '';
  bar.hidden = item.status !== 'processing'; bar.value = item.progress;
  tr.className = item.status === 'error' ? 'row-error' : '';
  return tr;
}

function render() {
  $('cp-rows').replaceChildren(...items.map(rowFor));
  $('cp-table-wrap').hidden = !items.length; $('cp-empty').hidden = items.length > 0;
  $('cp-dropzone').classList.toggle('compact', items.length > 0);
  const counts = Object.fromEntries(CATEGORIES.map(category => [category.id, 0]));
  items.forEach(item => { counts[item.category]++; });
  $('cp-categories').replaceChildren(...CATEGORIES.map(category => {
    const chip = el('span', `chip${counts[category.id] ? '' : ' empty'}`); chip.append(el('b', '', String(counts[category.id])), document.createTextNode(` ${category.label}`)); return chip;
  }));
  $('cp-categories').hidden = !items.length;
  const containers = new Set(items.map(containerOf));
  $('cp-total').textContent = items.length ? `${items.length} files · ${containers.size} ${containers.size === 1 ? 'container' : 'containers'} · ${formatSize(items.reduce((sum, item) => sum + item.file.size, 0))}` : 'No files imported';
  $('cp-count').textContent = String(items.length);
  $('cp-start').disabled = busy || !items.length;
  $('cp-clear').disabled = busy || !items.length;
}

function setBusy(value) {
  busy = value;
  $('container-panel').setAttribute('aria-busy', String(value));
  for (const id of ['cp-pick-folder', 'cp-pick-files', 'cp-limit', 'cp-container', 'cp-reference', 'cp-rename', 'cp-mute']) $(id).disabled = value;
  document.querySelectorAll('[data-cp-limit], #cp-results button').forEach(button => { button.disabled = value; });
  $('cp-start').hidden = value; $('cp-cancel').hidden = !value; $('cp-progress-wrap').hidden = !value;
  items.forEach(rowFor); render();
  window.dispatchEvent(new CustomEvent('container-busy', { detail: value }));
}

function syncPresets() {
  document.querySelectorAll('[data-cp-limit]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cpLimit === String(Number($('cp-limit').value)))));
}

function syncContainerField() {
  const raw = $('cp-container').value.trim(), parsed = parseContainer(raw), note = $('cp-container-state');
  note.className = 'field-note';
  if (!raw) note.textContent = 'Used for files whose folder or file name has no container number.';
  else if (!parsed) { note.textContent = 'Use 4 letters and 7 digits, for example MSCU 123456-7.'; note.classList.add('warn'); }
  else if (!parsed.valid) { note.textContent = `${parsed.id}: the ISO 6346 check digit does not match. Please verify the number.`; note.classList.add('warn'); }
  else { note.textContent = `${parsed.id} · valid ISO 6346 number`; note.classList.add('ok'); }
  $('cp-name-example').textContent = `${parsed?.id || 'MSCU1234567'}_INVOICE_01.pdf`;
}

// ---------- Processing ----------
$('cp-start').onclick = async () => {
  if (busy || !items.length) return;
  let target;
  try { target = limitBytes($('cp-limit').value); } catch (error) { setStatus(error.message); $('cp-limit').focus(); return; }
  if (pending() && !confirm('Prepare the files again? Downloads you have not saved will be replaced.')) return;
  const mute = $('cp-mute').checked;
  cancelled = false; const token = ++epoch;
  const queue = items.filter(item => !item.output || item.target !== target || item.mute !== mute);
  queue.forEach(item => Object.assign(item, { status: 'queued', progress: 0, output: undefined, error: '', note: '' }));
  clearPacks(); setBusy(true);
  let last = 0;
  for (const [index, item] of queue.entries()) {
    if (cancelled || token !== epoch) { item.status = 'cancelled'; rowFor(item); continue; }
    item.status = 'processing'; rowFor(item); item.row.tr.scrollIntoView({ block: 'nearest' });
    setStatus(`Processing ${index + 1} of ${queue.length}: ${item.path}`);
    $('cp-progress').value = index / queue.length * 100;
    const job = {
      mute,
      check: () => { if (cancelled || token !== epoch) throw Error('Cancelled'); },
      progress: value => { item.progress = value; const now = performance.now(); if (now - last > 120) { last = now; rowFor(item); } },
      status: setStatus,
    };
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const result = await shrinkFile(item, target, job);
      if (result.blob.size > target) throw Error('Still above the limit.');
      Object.assign(item, { output: result.blob, outputExtension: extensionOf(result.path) || extensionOf(item.path), note: result.note, target, mute, status: result.kept ? 'kept' : 'done' });
    } catch (error) {
      item.status = cancelled ? 'cancelled' : 'error';
      item.error = cancelled ? '' : error.message || 'Out of memory. Use the desktop app for very large files.';
    }
    item.progress = 100; rowFor(item);
  }
  $('cp-progress').value = 100;
  setBusy(false); buildPacks(target);
};

$('cp-cancel').onclick = async () => {
  cancelled = true; ++epoch; setStatus('Cancelling…');
  try { await cancelShrink(); } catch (error) { setStatus(error.message); }
};

// ---------- Packaging ----------
function clearPacks() { packs = []; $('cp-results').hidden = true; $('cp-packs').replaceChildren(); }

function buildPacks(target) {
  const rename = $('cp-rename').checked, ref = reference();
  const groups = new Map();
  for (const item of items.filter(entry => entry.output)) {
    const container = containerOf(item);
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push(item);
  }
  packs = [...groups].map(([container, list]) => {
    const files = [];
    for (const category of CATEGORIES) {
      const inCategory = list.filter(item => item.category === category.id);
      inCategory.forEach((item, index) => {
        const path = standardPath(container, category.id, index + 1, inCategory.length, item.outputExtension, item.path.replace(/\.[^./]+$/, `.${item.outputExtension}`), rename);
        files.push({ item, name: path, blob: item.output, size: item.output.size });
      });
    }
    const manifest = new Blob([manifestCsv(files.map(file => ({ container, category: file.item.category, path: file.name, original: file.item.path, originalSize: file.item.file.size, size: file.size, note: file.item.note })))], { type: 'text/csv' });
    const manifestFile = { name: `${container}/${container}_manifest.csv`, blob: manifest, size: manifest.size };
    const base = `${container}${ref ? `_${ref}` : ''}`;
    return { container, base, files, manifest: manifestFile, parts: packParts([manifestFile, ...files], target) };
  });
  renderPacks(target);
}

function renderPacks(target) {
  const failed = items.filter(item => item.status === 'error');
  const ready = packs.reduce((sum, pack) => sum + pack.files.length, 0);
  const reduced = items.filter(item => item.status === 'done');
  const before = reduced.reduce((sum, item) => sum + item.file.size, 0), after = reduced.reduce((sum, item) => sum + item.output.size, 0);
  $('cp-results-title').textContent = ready ? `${ready} ${ready === 1 ? 'file is' : 'files are'} ready to send` : 'No files are ready';
  $('cp-results-sub').textContent = `Every file is under ${formatSize(target)}. Email parts are ZIP files that also stay under ${formatSize(target)} each.`;
  const stats = [[ready, 'Files ready'], [reduced.length, 'Reduced'], [failed.length, 'Need attention'], [before ? `${Math.round((1 - after / before) * 100)}%` : '—', 'Size saved']];
  $('cp-stats').replaceChildren(...stats.map(([value, label]) => { const box = el('div', 'stat'); box.append(el('strong', '', String(value)), el('span', '', label)); return box; }));
  const cards = packs.map(pack => {
    const card = el('article', 'pack');
    const head = el('div', 'pack-head');
    const title = el('div'); title.append(el('h3', 'mono', pack.container), el('p', '', `${pack.files.length} files · ${formatSize(pack.files.reduce((sum, file) => sum + file.size, 0))}`));
    const actions = el('div', 'pack-actions');
    const zip = el('button', 'btn btn-primary'); zip.innerHTML = `${icon('arrow-down')}<span>Download ZIP</span>`; zip.onclick = () => downloadPack(pack, [pack.manifest, ...pack.files], `${pack.base}.zip`, false);
    const csv = el('button', 'btn btn-secondary'); csv.innerHTML = `${icon('file')}<span>Manifest</span>`; csv.onclick = () => saveBlob(pack.manifest.blob, `${pack.base}_manifest.csv`);
    actions.append(zip, csv); head.append(title, actions);
    const counts = el('div', 'pack-counts');
    for (const category of CATEGORIES) {
      const count = pack.files.filter(file => file.item.category === category.id).length;
      if (count) counts.append(el('span', 'chip', `${count} ${category.label}`));
    }
    const parts = el('div', 'pack-parts');
    parts.append(el('span', 'parts-label', `Email parts (${pack.parts.length})`));
    pack.parts.forEach((part, index) => {
      const button = el('button', 'btn btn-secondary btn-sm');
      button.textContent = `Part ${index + 1} · ${formatSize(part.reduce((sum, file) => sum + file.size, 0))}`;
      button.onclick = () => downloadPack(pack, part, `${pack.base}_Part${index + 1}of${pack.parts.length}.zip`, false);
      parts.append(button);
    });
    card.append(head, counts, parts);
    return card;
  });
  if (failed.length) {
    const box = el('div', 'alert');
    box.append(el('strong', '', `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be reduced`));
    const list = el('ul'); failed.forEach(item => list.append(el('li', '', `${item.path} — ${item.error}`))); box.append(list);
    cards.push(box);
  }
  $('cp-packs').replaceChildren(...cards);
  $('cp-save-folder').hidden = !ready || !window.showDirectoryPicker;
  $('cp-download-all').hidden = !ready;
  $('cp-results').hidden = false;
  $('cp-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus(cancelled ? 'Cancelled. Completed files are available below.' : failed.length ? `Finished. ${failed.length} ${failed.length === 1 ? 'file needs' : 'files need'} attention.` : 'Finished. All files are within the limit.');
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadPack(pack, files, filename) {
  setBusy(true); setStatus(`Preparing ${filename}…`);
  try {
    const { downloadZip } = await import('../shared/download-zip.mjs');
    await downloadZip(files.map(file => ({ name: file.name, blob: file.blob })), filename, { keepFolders: true });
    files.forEach(file => { if (file.item) file.item.saved = true; });
    setStatus(`${filename} download started.`);
  } catch (error) { setStatus(`Could not create the ZIP: ${error.message}`); }
  finally { setBusy(false); }
}

$('cp-download-all').onclick = () => {
  const files = packs.flatMap(pack => [pack.manifest, ...pack.files]);
  if (files.reduce((sum, file) => sum + file.size, 0) > 1.5 * 1024 ** 3) { setStatus('Too large for one ZIP. Download each container separately or use Save to folder.'); return; }
  const ref = reference();
  downloadPack(null, files, `Container-Documents${ref ? `_${ref}` : ''}.zip`);
};

$('cp-save-folder').onclick = async () => {
  let root;
  try { root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'container-pack' }); } catch { return; }
  setBusy(true);
  try {
    const files = packs.flatMap(pack => [pack.manifest, ...pack.files]);
    for (const [index, file] of files.entries()) {
      setStatus(`Saving ${index + 1} of ${files.length}: ${file.name}`);
      const segments = file.name.split('/'), name = segments.pop();
      let directory = root;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
      const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
      try { await writable.write(file.blob); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
      if (file.item) file.item.saved = true;
    }
    setStatus(`Saved ${files.length} files to “${root.name}”, one folder per container.`);
  } catch (error) { setStatus(`Could not save: ${error.message}`); }
  finally { setBusy(false); }
};

// ---------- Inputs ----------
$('cp-pick-folder').onclick = () => { if (!busy) $('cp-folder-input').click(); };
$('cp-pick-files').onclick = () => { if (!busy) $('cp-files-input').click(); };
for (const id of ['cp-folder-input', 'cp-files-input']) $(id).onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };
$('cp-clear').onclick = () => {
  if (busy || (pending() && !confirm('Clear all files? Downloads you have not saved will be lost.'))) return;
  items = []; clearPacks(); render(); setStatus('');
};
$('cp-limit').addEventListener('input', () => { syncPresets(); clearPacks(); });
$('cp-container').addEventListener('input', () => { syncContainerField(); clearPacks(); sortItems(); items.forEach(rowFor); render(); });
for (const id of ['cp-reference', 'cp-rename']) $(id).addEventListener('input', () => { if (packs.length) buildPacks(limitBytes($('cp-limit').value)); });
document.querySelectorAll('[data-cp-limit]').forEach(button => { button.onclick = () => { $('cp-limit').value = button.dataset.cpLimit; syncPresets(); clearPacks(); }; });

const zone = $('cp-dropzone');
zone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) zone.classList.add('dragging'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
zone.addEventListener('drop', async event => {
  event.preventDefault(); zone.classList.remove('dragging'); if (busy) return;
  const entries = [...event.dataTransfer.items].map(entry => entry.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = [...event.dataTransfer.files];
  async function walk(entry, parent = '') {
    if (entry.isFile) { const file = await new Promise((resolve, reject) => entry.file(resolve, reject)); file.relativeName = parent + file.name; return [file]; }
    const reader = entry.createReader(), files = [];
    for (let batch; (batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))).length;) for (const child of batch) files.push(...await walk(child, `${parent}${entry.name}/`));
    return files;
  }
  try { addFiles(entries.length ? (await Promise.all(entries.map(entry => walk(entry)))).flat() : fallback); }
  catch { setStatus('Could not read that folder. Please use Choose folder.'); }
});
window.addEventListener('beforeunload', event => { if (busy || pending()) { event.preventDefault(); event.returnValue = ''; } });
