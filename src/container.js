import { fileKind, safeRelativePath, extensionOf } from '../shared/fit-size.mjs';
import { CATEGORIES, parseContainer, detectContainer, categorize, standardPath, importableFromZip, allocateBudget, SHARE_WEIGHT, isChatTranscript, safeIdentifier, uniqueOutputName, SHIPPING_DOCUMENTS } from '../shared/container.mjs';
import { shrinkFile, cancelShrink } from './shrink.js';
import { icon } from './icons.js';
import { LOADING_STAGES, suggestLoadingPhotos } from '../shared/loading-photos.mjs';
import { analyzeShipment, shipmentAIStatus } from './shipment-ai.js';
import { fingerprintPhoto } from './photo-fingerprint.js';
import { detectShipmentText, resolveShipmentGroup } from '../shared/shipment-detection.mjs';

const $ = id => document.getElementById(id);
const native = window.desktop;
const KIND_ICON = { image: 'image', video: 'video', pdf: 'file', doc: 'file', other: 'file' };
const STATE = { replaced: 'Replaced', queued: 'Pending', processing: 'Processing', done: 'Reduced', kept: 'Kept as is', error: 'Failed', cancelled: 'Cancelled' };
let sourceFolder, folderReplaced = false, replacingFolder = false;
let aiController, analysisProblem = '', packageReady = false;
let items = [], busy = false, cancelled = false, epoch = 0, packs = [], nextId = 1;

const formatSize = n => !n ? '0 KB' : n < 1024 ** 2 ? `${Math.max(0.1, n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
const setStatus = message => { $('cp-status').textContent = message; };
const pending = () => packs.length && items.some(item => item.output && !item.saved);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const reference = () => $('cp-reference').value.trim().replace(/[^\w.-]+/g, '-').slice(0, 40);
// Mail servers measure the encoded message, and base64 inflates attachments by about 37%.
const emailBudget = () => {
  const mb = Number($('cp-limit').value);
  if (!Number.isFinite(mb) || mb < 1 || mb > 2048) throw Error('Choose an email limit from 1 to 2048 MB.');
  return Math.floor(mb * 1_000_000 / ($('cp-headroom').checked ? 1.37 : 1));
};
const zipBytes = files => 22 + files.reduce((sum, file) => sum + file.size + 76 + 2 * new TextEncoder().encode(file.name).length, 0);


function defaultContainer() {
  const parsed = parseContainer($('cp-container').value);
  return parsed?.id || '';
}
const sealOf = item => item.seal || safeIdentifier($('cp-seal').value);
const containerOf = item => item.container?.id || defaultContainer() || 'Unassigned';

export function activateContainerTool() {
  $('cp-hint').textContent = native ? 'Photos, videos, PDF, Office files, or a WhatsApp chat-export ZIP' : 'Photos, videos (up to 1 GB each), PDF, Office files, or a WhatsApp chat-export ZIP';
  syncContainerField(); syncPresets(); render(); refreshAIStatus();
}

async function refreshAIStatus() {
  try {
    const service = await shipmentAIStatus();
    $('cp-ai-state').textContent = service.available ? 'AI service configured. Enter your access code to analyze shipment previews.' : 'Pro AI is not configured. With Pro AI on, preparation stops and original files are not replaced. Configure the server or choose local mode below.';
    $('cp-ai-state').classList.toggle('warn', !service.available);
    $('cp-local-mode').hidden = service.available;
  } catch {
    $('cp-ai-state').textContent = 'AI service could not be reached. Preparation with Pro AI cannot finish until it reconnects. Local mode is available.';
    $('cp-ai-state').classList.add('warn'); $('cp-local-mode').hidden = false;
  }
}
$('cp-local-mode').onclick = () => {
  if (busy) return;
  $('cp-ai').checked = false; $('cp-ai').dispatchEvent(new Event('change'));
  setStatus('Local mode selected. Click Prepare files to read numbers locally, compress and replace the chosen folder. Loading stages need manual selection; uncertain photos are kept.');
};

let importWarnings = [];
// ---------- Import ----------
// A WhatsApp "Export chat" archive (or any ZIP of files) is unpacked instead of being queued.
async function expandArchives(list) {
  const out = [];
  for (const file of list) {
    if (!/\.zip$/i.test(file.name)) { out.push(file); continue; }
    setStatus(`Opening ${file.name}…`);
    try {
      const { listZipEntries, zipEntryBlob } = await import('../shared/read-zip-blob.mjs');
      const all = await listZipEntries(file);
      const chats = all.filter(entry => !entry.directory && entry.size <= 5 * 1024 ** 2 && isChatTranscript(entry.name));
      const transcript = (await Promise.all(chats.map(async entry => (await zipEntryBlob(file, entry)).text()))).join('\n');
      const entries = all.filter(entry => !entry.directory && entry.size && importableFromZip(entry.name));
      const children = [];
      const stem = file.name.replace(/\.zip$/i, '');
      for (const [index, entry] of entries.entries()) {
        if (index % 20 === 0) { setStatus(`Opening ${file.name}: ${index + 1} of ${entries.length}…`); await new Promise(resolve => setTimeout(resolve, 0)); }
        if (cancelled) { importWarnings.push(`Import of ${file.name} was cancelled. Re-import this ZIP to include every video and document.`); break; }
        const child = new File([await zipEntryBlob(file, entry)], entry.name.split('/').pop());
        child.relativeName = `${stem}/${entry.name}`;
        child.shipmentSource = file; child.transcript = transcript;
        children.push(child);
      }
      out.push(...children);
    } catch (error) { importWarnings.push(`Could not open ${file.name}: ${error.message}`); }
  }
  return out;
}

async function addFiles(input) {
  if (busy) return;
  cancelled = false; importWarnings = []; analysisProblem = ''; setBusy(true);
  const addedItems = [];
  try {
    const list = input.some(file => /\.zip$/i.test(file.name)) ? await expandArchives(input) : input;
    const known = new Set(items.map(item => `${item.path}|${item.file.size}`));
    for (const file of list) {
      const path = safeRelativePath(file.relativeName || file.webkitRelativePath || file.name);
      const kind = fileKind(path);
      if (kind === 'skip' || !file.size || isChatTranscript(path) || (!sourceFolder && known.has(`${path}|${file.size}`))) continue;
      known.add(`${path}|${file.size}`);
      const evidence = detectShipmentText(path);
      const item = { id: nextId++, file, path, kind, category: kind === 'video' ? 'videos' : evidence.category || categorize(path), documentType: evidence.documentType, container: detectContainer(path), evidence, seal: '', status: 'queued', progress: 0, included: true, stage: '' };
      items.push(item); addedItems.push(item);
    }
    clearPacks(); render();
    for (const item of addedItems.filter(item => item.kind === 'image')) {
      if (cancelled) break;
      try { item.fingerprint = await fingerprintPhoto(item.file); } catch { item.review = 'Photo preview unavailable.'; }
    }
    if (!$('cp-ai').checked) await readLocalItems(addedItems);
    if ($('cp-ai').checked && !cancelled) {
      try { await readAI(); } catch (error) { analysisProblem = cancelled ? 'AI analysis cancelled.' : error.message; }
    }
    resolveSources();
    applyStandard();
    const detected = new Set(addedItems.map(item => item.container?.id).filter(Boolean));
    setStatus(`${addedItems.length} files imported · ${detected.size} container numbers detected. ${cancelled ? 'Photo reading cancelled; some files need manual review. ' : ''}${addedItems.filter(item => !item.included).length} similar / extra photos excluded. ${analysisProblem || 'Selection complete.'} ${importWarnings.join(' ')}`);
  } finally {
    sortItems(); setBusy(false); render();
  }
  if ($('cp-auto').checked && !cancelled && !analysisProblem && !importWarnings.length) await prepareFiles(true);
}

async function readLocalItems(list) {
  if (!$('cp-detect').checked || cancelled) return;
  const pending = list.filter(item => ['image', 'pdf'].includes(item.kind) && !item.localRead);
  if (!pending.length) return;
  let scanner;
  setStatus('Loading local photo reader…');
  try {
    scanner = await (await import('./shipment-ocr.js')).createShipmentScanner();
    for (const [index, item] of pending.entries()) {
      if (cancelled) break;
      setStatus(`Reading file ${index + 1} of ${pending.length}: ${item.file.name}`);
      const check = () => { if (cancelled) throw Error('Cancelled'); };
      try {
        const found = item.kind === 'pdf' ? await (await import('./shipment-pdf.js')).readShipmentPdf(item.file, scanner, check) : await scanner.scan(item.file, check);
        item.evidence = {
          containers: [...new Map([...item.evidence.containers, ...found.containers].map(value => [value.id, value])).values()],
          seals: [...new Map([...item.evidence.seals, ...found.seals].map(value => [value.id, value])).values()],
        };
        if (found.category) item.category = found.category;
        if (found.documentType) item.documentType = found.documentType;
        if (found.possibleSeal) item.review = 'Seal photo kept. Number is optional.';
        item.localRead = true;
      } catch (error) { if (!cancelled) item.review = 'Could not read this file. Verify its category and numbers manually.'; }
    }
  } finally { await scanner?.close(); }
}

async function readAI() {
  const pendingImages = items.filter(item => ['image', 'pdf'].includes(item.kind) && !item.ai);
  if (!pendingImages.length) { analysisProblem = ''; return; }
  aiController = new AbortController();
  try {
    await analyzeShipment(pendingImages, {
      accessCode: $('cp-ai-access').value.trim(), signal: aiController.signal, status: setStatus,
      onResult: found => {
        const item = items.find(value => String(value.id) === found.id);
        item.ai = found;
        // Uncertain evidence must not cause automatic deletion or stage assignment.
        if (found.confidence >= .7 || found.category === 'seals') item.category = found.category;
        item.documentType = found.documentType;
        item.evidence = {
          containers: [...new Map([...item.evidence.containers, ...(found.container ? [found.container] : [])].map(value => [value.id, value])).values()],
          seals: [...new Map([...item.evidence.seals, ...(found.seal ? [{ id: found.seal, explicit: true }] : [])].map(value => [value.id, value])).values()],
        };
        item.review = found.category === 'seals' && !found.seal ? 'Seal photo kept. Number is optional.' : found.reason;
      },
    });
    analysisProblem = '';
  } finally { aiController = undefined; }
}

function resolveSources() {
  const sources = new Map();
  for (const item of items) {
    const source = item.file.shipmentSource || (item.path.includes('/') ? item.path.split('/')[0] : 'Selected files');
    if (!sources.has(source)) sources.set(source, []);
    sources.get(source).push(item);
  }
  for (const group of sources.values()) resolveShipmentGroup(group, group[0].file.transcript || '').forEach((value, index) => {
    const item = group[index];
    if (!item.manualContainer) item.container = value.container;
    if (!item.manualSeal) item.seal = value.seal;
    item.review = value.review || item.review;
  });
}
function applyStandard() {
  if (!$('cp-standard').checked || cancelled) return;
  for (const group of groupByAllSources()) {
    const suggestions = new Map(suggestLoadingPhotos(group).map(value => [value.id, value]));
    group.forEach(item => {
      Object.assign(item, suggestions.get(item.id));
      if (item.manualIncluded !== undefined && item.category === 'photos') item.included = item.manualIncluded;
    });
  }
}

function sortItems() {
  const order = Object.fromEntries(CATEGORIES.map((category, index) => [category.id, index]));
  items.sort((a, b) => containerOf(a).localeCompare(containerOf(b)) || order[a.category] - order[b.category] || a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Table ----------
function resultText(item) {
  if (item.status === 'error') return item.error;
  if (item.status === 'processing') return `${Math.round(item.progress)}%`;
  if (item.output) return ['kept', 'replaced'].includes(item.status) ? formatSize(item.output.size) : `${formatSize(item.output.size)} · −${Math.max(0, Math.round((1 - item.output.size / item.file.size) * 100))}%`;
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
    names.append(name, folder);
    if (item.kind === 'image') {
      item.previewUrl = URL.createObjectURL(item.file);
      const preview = el('a'); preview.href = item.previewUrl; preview.target = '_blank'; preview.rel = 'noopener'; preview.title = 'Open photo to verify numbers and loading stage';
      const thumb = el('img', 'shipment-thumb'); thumb.src = item.previewUrl; thumb.alt = item.file.name; thumb.loading = 'lazy'; preview.append(thumb); file.append(preview);
    } else file.append(fileIcon);
    file.append(names);
    const container = el('td', 'cell-container');
    const containerInput = el('input', 'table-id'); containerInput.placeholder = 'Container number';
    containerInput.setAttribute('aria-label', `Container for ${item.path}`);
    containerInput.onchange = () => {
      const value = containerInput.value.trim(), parsed = parseContainer(value);
      if (value && !parsed) { setStatus('Container number must have 4 letters and 7 digits.'); rowFor(item); return; }
      item.manualContainer = true; item.container = parsed; item.review = parsed && !parsed.valid ? 'Container check digit does not match.' : '';
      applyStandard(); clearPacks(); sortItems(); render();
    };
    const sealInput = el('input', 'table-id'); sealInput.placeholder = 'Seal number';
    sealInput.setAttribute('aria-label', `Seal for ${item.path}`);
    sealInput.onchange = () => { item.manualSeal = true; item.seal = safeIdentifier(sealInput.value); clearPacks(); rowFor(item); };
    const detectionNote = el('small', 'detection-note');
    container.append(containerInput, sealInput, detectionNote);
    const category = el('td');
    const select = el('select', 'table-select'); select.setAttribute('aria-label', `Category for ${item.path}`);
    for (const option of CATEGORIES) select.append(new Option(option.label, option.id));
    select.onchange = () => { item.category = item.kind === 'video' ? 'videos' : select.value; if (item.category !== 'photos') { item.included = true; item.stage = ''; } clearPacks(); sortItems(); render(); };
    const documentSelect = el('select', 'table-select'); documentSelect.setAttribute('aria-label', `Document type for ${item.path}`);
    for (const type of SHIPPING_DOCUMENTS) documentSelect.append(new Option(type.label, type.id));
    documentSelect.onchange = () => { item.documentType = documentSelect.value; clearPacks(); render(); };
    const stageSelect = el('select', 'table-select'); stageSelect.setAttribute('aria-label', `Loading stage for ${item.path}`);
    stageSelect.append(new Option('Loading stage: review', ''));
    for (const stage of LOADING_STAGES) stageSelect.append(new Option(`${stage}% loaded`, String(stage)));
    stageSelect.onchange = () => {
      item.stage = stageSelect.value === '' ? '' : Number(stageSelect.value); item.included = true;
      item.manualStage = item.stage; applyStandard(); clearPacks(); render();
    };
    const includeLabel = el('label', 'include-photo'), included = el('input'); included.type = 'checkbox';
    included.setAttribute('aria-label', `Include ${item.path}`);
    included.onchange = () => { item.manualIncluded = included.checked; item.included = included.checked; clearPacks(); render(); };
    includeLabel.append(included, document.createTextNode(' Keep photo'));
    const selectionNote = el('small', 'detection-note');
    category.append(select, documentSelect, stageSelect, includeLabel, selectionNote);
    const size = el('td', 'num');
    const result = el('td', 'cell-result');
    const badge = el('span', 'status-badge'); const detail = el('span', 'result-detail');
    const bar = el('progress'); bar.max = 100;
    result.append(badge, detail, bar);
    const send = el('td', 'cell-send');
    const download = el('button', 'btn btn-secondary btn-sm');
    download.innerHTML = `${icon('arrow-down')}<span>Save</span>`;
    download.onclick = () => { saveBlob(item.output, item.sendName.split('/').pop()); item.saved = true; setStatus(`Saved ${item.sendName.split('/').pop()}.`); };
    send.append(download);
    tr.append(file, container, category, size, result, send);
    item.row = { tr, container, containerInput, sealInput, detectionNote, folder, documentSelect, stageSelect, included, includeLabel, selectionNote, select, size, badge, detail, bar, download };
  }
  const { tr, container, containerInput, sealInput, detectionNote, folder, documentSelect, stageSelect, included, includeLabel, selectionNote, select, size, badge, detail, bar, download } = item.row;
  const id = containerOf(item);
  containerInput.value = id === 'Unassigned' ? '' : id; containerInput.disabled = busy || folderReplaced;
  sealInput.value = sealOf(item); sealInput.disabled = busy || folderReplaced;
  detectionNote.textContent = item.review || (!item.container && !defaultContainer() ? 'Container not detected' : !sealOf(item) ? 'Seal number optional' : 'Verify detected numbers');
  folder.textContent = item.sendName || item.path;
  folder.title = item.sendName || item.path;
  documentSelect.hidden = item.category !== 'shipping'; documentSelect.disabled = busy || folderReplaced; documentSelect.value = item.documentType || 'SHIPPING_DOC';
  stageSelect.hidden = item.category !== 'photos'; stageSelect.disabled = busy || folderReplaced; stageSelect.value = String(item.stage ?? '');
  includeLabel.hidden = item.category !== 'photos'; included.checked = item.included !== false; included.disabled = busy || folderReplaced;
  selectionNote.textContent = item.category === 'photos' ? item.selectionReason || '' : '';
  select.value = item.category; select.disabled = busy || folderReplaced || item.kind === 'video';
  size.textContent = formatSize(item.file.size);
  badge.className = `status-badge ${item.status}`; badge.textContent = STATE[item.status];
  detail.textContent = resultText(item); detail.title = item.note || item.error || '';
  bar.hidden = item.status !== 'processing'; bar.value = item.progress;
  download.hidden = !item.output || !item.sendName; download.disabled = busy;
  if (item.sendName) download.title = `Save ${item.sendName.split('/').pop()}`;
  tr.className = item.status === 'error' ? 'row-error' : item.included === false ? 'row-excluded' : '';
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
  $('cp-total').textContent = items.length ? `${items.filter(item => item.included !== false).length} kept / ${items.length} files · ${containers.size} ${containers.size === 1 ? 'container' : 'containers'} · ${formatSize(items.reduce((sum, item) => sum + item.file.size, 0))}` : 'No files imported';
  $('cp-count').textContent = String(items.length);
  $('cp-start').disabled = busy || folderReplaced || !items.some(item => item.included !== false);
  $('cp-clear').disabled = busy || (!items.length && !sourceFolder);
  $('cp-pick-files').disabled = busy || Boolean(sourceFolder);
  $('cp-folder-mode').textContent = folderReplaced ? 'Original folder replaced successfully' : sourceFolder ? `Will replace files in ${sourceFolder.name} after successful preparation` : 'Choose folder: replace originals in place. ZIP uploads: download prepared files.';
}

function setBusy(value) {
  busy = value;
  $('container-panel').setAttribute('aria-busy', String(value));
  for (const id of ['cp-pick-folder', 'cp-pick-files', 'cp-limit', 'cp-headroom', 'cp-container', 'cp-seal', 'cp-reference', 'cp-rename', 'cp-mute', 'cp-detect', 'cp-standard', 'cp-ai', 'cp-auto', 'cp-ai-access', 'cp-local-mode']) $(id).disabled = value || (folderReplaced && !['cp-pick-folder', 'cp-pick-files'].includes(id));
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
  $('cp-name-example').textContent = `${parsed?.id || 'MSCU1234567'}_SEAL-123456_WEIGHT_01.jpg`;
}

// ---------- Processing ----------
$('cp-start').onclick = () => prepareFiles(false).catch(error => { setBusy(false); setStatus(error.message); });
async function prepareFiles(automatic = false) {
  if (busy || folderReplaced || !items.length) return;
  let budget;
  try { budget = emailBudget(); } catch (error) { setStatus(error.message); $('cp-limit').focus(); return; }
  if (!automatic && pending() && !confirm('Prepare the files again? Downloads you have not saved will be replaced.')) return;
  if ($('cp-ai').checked) {
    cancelled = false; setBusy(true);
    try { await readAI(); resolveSources(); applyStandard(); }
    catch (error) { analysisProblem = cancelled ? 'AI analysis cancelled.' : error.message; setStatus(analysisProblem); return; }
    finally { setBusy(false); }
    if (cancelled) return;
  } else {
    analysisProblem = ''; cancelled = false; setBusy(true);
    try { await readLocalItems(items); resolveSources(); applyStandard(); }
    catch (error) { setStatus(`Local reading unavailable: ${error.message}`); return; }
    finally { setBusy(false); }
    if (cancelled) return;
  }
  if (importWarnings.length) { setStatus(importWarnings.join(' ') + ' Re-import the missing files before preparing.'); return; }
  const mute = $('cp-mute').checked;
  cancelled = false; const token = ++epoch;
  // One budget for the entire import, including all containers and every video.
  const included = items.filter(item => item.included !== false);
  const reserve = 65_536 + included.length * 2048;
  if (budget <= reserve) { setStatus('Too many files for this email limit.'); return; }
  const targets = allocateBudget(included.map(item => item.file.size), budget - reserve, included.map(item => SHARE_WEIGHT[item.kind] || 1));
  included.forEach((item, index) => { item.plan = targets[index]; });
  const queue = items.filter(item => item.included !== false && (!item.output || item.appliedTarget !== item.plan || item.mute !== mute));
  queue.forEach(item => Object.assign(item, { status: 'queued', progress: 0, output: undefined, sendName: '', error: '', note: '' }));
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
      const result = await shrinkFile(item, item.plan, job);
      if (result.blob.size > item.plan) throw Error('Still above its share of the email.');
      Object.assign(item, { output: result.blob, outputExtension: extensionOf(result.path) || extensionOf(item.path), note: result.note, appliedTarget: item.plan, mute, status: result.kept ? 'kept' : 'done' });
    } catch (error) {
      item.status = cancelled ? 'cancelled' : 'error';
      item.error = cancelled ? '' : error.message || 'Out of memory. Use the desktop app for very large files.';
    }
    item.progress = 100; rowFor(item);
  }
  $('cp-progress').value = 100;
  setBusy(false); buildPacks(budget);
  if (packageReady && sourceFolder) await replaceOriginalFolder();
}

$('cp-cancel').onclick = async () => {
  if (replacingFolder) return;
  cancelled = true; ++epoch; aiController?.abort(); setStatus('Cancelling…');
  try { await cancelShrink(); } catch (error) { setStatus(error.message); }
};

// ---------- Packaging ----------
function clearPacks() { packageReady = false; items.forEach(item => { item.sendName = ''; if (item.row) rowFor(item); }); packs = []; $('cp-results').hidden = true; $('cp-packs').replaceChildren(); }

function buildPacks(budget) {
  const rename = $('cp-rename').checked, ref = reference();
  const groups = new Map();
  for (const item of items.filter(entry => entry.output && entry.included !== false)) {
    const container = containerOf(item);
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push(item);
  }
  const usedNames = new Set();
  packs = [...groups].map(([container, list]) => {
    const files = [];
    for (const category of CATEGORIES) {
      const inCategory = list.filter(item => item.category === category.id);
      inCategory.forEach((item, index) => {
        const path = uniqueOutputName(standardPath(container, category.id, index + 1, inCategory.length, item.outputExtension, item.path.replace(/\.[^./]+$/, `.${item.outputExtension}`), rename, sealOf(item), item.category === 'photos' ? item.stage : '', item.documentType), usedNames);
        item.sendName = path;
        files.push({ item, name: path, blob: item.output, size: item.output.size });
      });
    }
    const base = `${container}${ref ? `_${ref}` : ''}`;
    return { container, base, files };
  });
  items.forEach(rowFor);
  renderPacks(budget);
}

function renderPacks(budget) {
  const failed = items.filter(item => item.included !== false && item.status === 'error');
  const ready = packs.reduce((sum, pack) => sum + pack.files.length, 0);
  const allFiles = packs.flatMap(pack => pack.files);
  const totalBytes = zipBytes(allFiles);
  const missing = items.filter(item => item.included !== false && !item.output);
  packageReady = Boolean(ready && !missing.length && !cancelled && !analysisProblem && !importWarnings.length && totalBytes <= budget);
  const emails = packageReady ? 1 : 0;
  const reduced = items.filter(item => item.included !== false && item.status === 'done');
  const before = reduced.reduce((sum, item) => sum + item.file.size, 0), after = reduced.reduce((sum, item) => sum + item.output.size, 0);
  $('cp-results-title').textContent = packageReady ? `${ready} files ready · one email` : 'Package incomplete — needs attention';
  $('cp-results-sub').textContent = `Whole batch: ${(totalBytes / 1_000_000).toFixed(2)} / ${(budget / 1_000_000).toFixed(2)} MB, including ZIP headers. ${packageReady ? 'All containers share this one budget.' : totalBytes > budget ? 'Above the total limit; increase the limit or reduce the selection.' : `${missing.length} files unfinished. ${analysisProblem}`}`;
  const stats = [[ready, 'Files ready'], [emails, emails === 1 ? 'Email' : 'Emails'], [failed.length, 'Need attention'], [before ? `${Math.round((1 - after / before) * 100)}%` : '—', 'Size saved']];
  $('cp-stats').replaceChildren(...stats.map(([value, label]) => { const box = el('div', 'stat'); box.append(el('strong', '', String(value)), el('span', '', label)); return box; }));
  const cards = packs.map(pack => {
    const card = el('article', 'pack');
    const head = el('div', 'pack-head');
    const total = pack.files.reduce((sum, file) => sum + file.size, 0);
    const title = el('div'); title.append(el('h3', 'mono', pack.container), el('p', '', `${pack.files.length} files · ${formatSize(total)} · part of the combined email`));
    const actions = el('div', 'pack-actions');
    const each = el('button', 'btn btn-primary'); each.innerHTML = `${icon('arrow-down')}<span>Save ${pack.files.length} files</span>`;
    each.onclick = () => saveFiles(pack.files, `${pack.container}: `);
    const zip = el('button', 'btn btn-secondary'); zip.innerHTML = `${icon('file')}<span>ZIP</span>`;
    zip.title = 'One ZIP of this container, for upload portals';
    zip.onclick = () => downloadPack(pack, pack.files, `${pack.base}.zip`);
    actions.append(each, zip); head.append(title, actions);
    const counts = el('div', 'pack-counts');
    for (const category of CATEGORIES) {
      const count = pack.files.filter(file => file.item.category === category.id).length;
      if (count) counts.append(el('span', 'chip', `${count} ${category.label}`));
    }
    card.append(head, counts);
    return card;
  });
  if (failed.length) {
    const box = el('div', 'alert');
    box.append(el('strong', '', `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be reduced`));
    const list = el('ul'); failed.forEach(item => list.append(el('li', '', `${item.path} — ${item.error}`))); box.append(list);
    cards.push(box);
  }
  $('cp-packs').replaceChildren(...cards);
  $('cp-replace-folder').hidden = !packageReady || !sourceFolder || folderReplaced;
  $('cp-save-folder').hidden = Boolean(sourceFolder) || folderReplaced || !packageReady || !(native?.pickSaveFolder || window.showDirectoryPicker);
  $('cp-download-all').hidden = !packageReady; $('cp-zip-all').hidden = !packageReady;
  $('cp-results').hidden = false;
  $('cp-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus(cancelled ? 'Cancelled. Completed files are available below.' : failed.length ? `Finished. ${failed.length} ${failed.length === 1 ? 'file needs' : 'files need'} attention.` : packageReady ? 'Ready. All selected files and every video fit the total email limit.' : 'Package incomplete. Review the results.');
}

async function downloadPack(pack, files, filename) {
  setBusy(true); setStatus(`Preparing ${filename}…`);
  try {
    const { createZip } = await import('../shared/download-zip.mjs');
    const blob = await createZip(files, { keepFolders: true });
    if (blob.size > emailBudget()) throw Error('ZIP exceeds the total email limit.');
    saveBlob(blob, filename);
    files.forEach(file => { if (file.item) file.item.saved = true; });
    setStatus(`${filename} download started.`);
  } catch (error) { setStatus(`Could not create the ZIP: ${error.message}`); }
  finally { setBusy(false); }
}

// Saves each file on its own, so they can be attached to an email directly.
async function saveFiles(files, prefix = '') {
  setBusy(true);
  try {
    for (const [index, file] of files.entries()) {
      setStatus(`${prefix}saving ${index + 1} of ${files.length}: ${file.name.split('/').pop()}`);
      saveBlob(file.blob, file.name.split('/').pop());
      if (file.item) file.item.saved = true;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    setStatus(`${files.length} ${files.length === 1 ? 'file' : 'files'} sent to your Downloads folder. Your browser may ask to allow multiple downloads.`);
  } finally { setBusy(false); }
}

$('cp-zip-all').onclick = () => packageReady && downloadPack(null, packs.flatMap(pack => pack.files), 'Container-Load-Pack.zip');

$('cp-download-all').onclick = () => packageReady && saveFiles(packs.flatMap(pack => pack.files));

$('cp-save-folder').onclick = async () => {
  if (!packageReady) return;
  const files = packs.flatMap(pack => pack.files);
  if (native?.pickSaveFolder) {
    let root;
    try { root = await native.pickSaveFolder(); } catch (error) { setStatus(error.message); return; }
    if (!root) return;
    setBusy(true);
    try {
      for (const [index, file] of files.entries()) {
        setStatus(`Saving ${index + 1} of ${files.length}: ${file.name}`);
        await native.saveInto(file.name, new Uint8Array(await file.blob.arrayBuffer()));
        if (file.item) file.item.saved = true;
      }
      setStatus(`Saved ${files.length} files in ${root}, all together in the root folder.`);
      native.openSaveFolder?.().catch(() => {});
    } catch (error) { setStatus(`Could not save: ${error.message}`); }
    finally { setBusy(false); }
    return;
  }
  let root;
  try { root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'container-pack' }); } catch { return; }
  setBusy(true);
  try {
    const existing = new Set();
    for await (const name of root.keys()) existing.add(name.toLowerCase());
    const collision = files.find(file => existing.has(file.name.toLowerCase()));
    if (collision) throw Error(`A file named ${collision.name} already exists. Choose an empty output folder.`);
    for (const [index, file] of files.entries()) {
      setStatus(`Saving ${index + 1} of ${files.length}: ${file.name}`);
      const segments = file.name.split('/'), name = segments.pop();
      let directory = root;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
      const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
      try { await writable.write(file.blob); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
      if (file.item) file.item.saved = true;
    }
    setStatus(`Saved ${files.length} files to “${root.name}”, all together in the root folder.`);
  } catch (error) { setStatus(`Could not save: ${error.message}`); }
  finally { setBusy(false); }
};

async function replaceOriginalFolder() {
  if (!packageReady || !sourceFolder || folderReplaced || busy) return;
  setBusy(true); replacingFolder = true; $('cp-cancel').hidden = true;
  try {
    const prepared = packs.flatMap(pack => pack.files);
    const outputs = [];
    for (const file of prepared) {
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      file.blob = new Blob([bytes], { type: file.blob.type });
      file.item.output = file.blob;
      outputs.push({ name: file.name, data: native ? bytes : file.blob });
    }
    setStatus(`Replacing files in ${sourceFolder.name}…`);
    const result = sourceFolder.token
      ? await native.replaceShipmentFolder(sourceFolder.token, outputs)
      : await (await import('./source-folder.js')).replaceSourceFolder(sourceFolder, outputs, { status: setStatus });
    folderReplaced = true;
    for (const item of items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    items = prepared.map(({ item, name, blob }) => {
      item.file = new File([blob], name, { type: blob.type });
      item.path = `${sourceFolder.name}/${name}`; item.saved = true; item.status = 'replaced'; item.row = undefined; item.previewUrl = undefined;
      return item;
    });
    $('cp-replace-folder').hidden = true; $('cp-save-folder').hidden = true;
    $('cp-results-title').textContent = `${prepared.length} files replaced in ${sourceFolder.name}`;
    setStatus(result.cleanupWarning || `Done. Prepared files are in ${sourceFolder.name}. Replaced originals and excluded photos were removed. No CSV or extra output folder.`);
  } catch (error) {
    setStatus(`Folder replacement did not finish: ${error.message}`);
    $('cp-replace-folder').hidden = false;
  } finally { replacingFolder = false; setBusy(false); }
}
$('cp-replace-folder').onclick = replaceOriginalFolder;

async function importFolder(root) {
  if (busy) return;
  if (items.length || sourceFolder) { setStatus('Clear the current batch before choosing a replacement folder.'); return; }
  let selected;
  cancelled = false; setBusy(true);
  const check = () => { if (cancelled) throw Error('Folder import cancelled. Originals were not changed.'); };
  try {
    // The picker runs directly from the user's gesture, before loading modules.
    if (!root && native?.pickShipmentFolder) selected = await native.pickShipmentFolder();
    else if (!root && window.showDirectoryPicker) root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'shipment-source' });
    else if (!root) { setStatus('This browser cannot replace local files. Use the desktop app or a browser with folder write access.'); return; }
    if (!selected && !root) return;
    check();
    let files;
    if (selected) {
      files = [];
      for (const [index, entry] of selected.files.entries()) {
        check(); setStatus(`Opening folder: ${index + 1} of ${selected.files.length}…`);
        const data = await native.readShipmentFile(selected.token, entry.id);
        const file = new File([data], entry.path.split('/').pop(), { lastModified: entry.lastModified });
        file.relativeName = `${selected.name}/${entry.path}`; file.shipmentSource = selected; files.push(file);
      }
      selected.files = files;
    } else selected = await (await import('./source-folder.js')).openSourceFolder(root, check);
    files = selected.files;
    const transcripts = await Promise.all(files.filter(file => isChatTranscript(file.name) && file.size <= 5 * 1024 ** 2).map(file => file.text()));
    check();
    for (const file of files) file.transcript = transcripts.join('\n');
    sourceFolder = selected; folderReplaced = false;
  } finally { setBusy(false); }
  await addFiles(selected.files);
}

// ---------- Inputs ----------
$('cp-pick-folder').onclick = () => importFolder().catch(error => { if (error.name !== 'AbortError') setStatus(error.message); });
$('cp-pick-files').onclick = () => { if (!busy && !sourceFolder) $('cp-files-input').click(); };
for (const id of ['cp-files-input']) $(id).onchange = event => { const picked = [...event.target.files]; event.target.value = ''; addFiles(picked).catch(error => setStatus(error.message)); };
$('cp-clear').onclick = () => {
  if (busy || (pending() && !confirm('Clear all files? Downloads you have not saved will be lost.'))) return;
  items.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); }); items = []; sourceFolder = undefined; folderReplaced = false; analysisProblem = ''; importWarnings = []; clearPacks(); setBusy(false); setStatus('');
};
$('cp-limit').addEventListener('input', () => { syncPresets(); clearPacks(); });
$('cp-headroom').addEventListener('change', clearPacks);
$('cp-ai').addEventListener('change', () => { analysisProblem = ''; clearPacks(); setStatus($('cp-ai').checked ? 'Pro AI enabled. Preview images are sent to the AI service.' : 'Local mode: loading percentages require manual selection.'); });
$('cp-standard').addEventListener('change', () => {
  if ($('cp-standard').checked) applyStandard();
  else items.forEach(item => { item.included = true; delete item.manualIncluded; item.selectionReason = ''; });
  clearPacks(); render();
});
function groupByAllSources() {
  const groups = new Map();
  for (const item of items) {
    const source = item.file.shipmentSource || (item.path.includes('/') ? item.path.split('/')[0] : 'Selected files');
    // A known container shares one quota even across multiple ZIPs. Ambiguous
    // shipments do not lose evidence merely because their IDs are unresolved.
    const id = containerOf(item);
    const key = id !== 'Unassigned' ? id : /Multiple container/.test(item.review || '') ? item : source;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}
$('cp-seal').addEventListener('input', () => { clearPacks(); render(); });
$('cp-container').addEventListener('input', () => { syncContainerField(); applyStandard(); clearPacks(); sortItems(); items.forEach(rowFor); render(); });
for (const id of ['cp-reference', 'cp-rename']) $(id).addEventListener('input', () => { if (packs.length) buildPacks(emailBudget()); });
document.querySelectorAll('[data-cp-limit]').forEach(button => { button.onclick = () => { $('cp-limit').value = button.dataset.cpLimit; syncPresets(); clearPacks(); }; });

const zone = $('cp-dropzone');
zone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) zone.classList.add('dragging'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
zone.addEventListener('drop', async event => {
  event.preventDefault(); zone.classList.remove('dragging'); if (busy) return;
  if (sourceFolder) { setStatus('Clear this folder batch before importing other files.'); return; }
  const transferItems = [...event.dataTransfer.items];
  const fallback = [...event.dataTransfer.files];
  const legacyDirectories = transferItems.some(entry => entry.webkitGetAsEntry?.()?.isDirectory);
  const handles = transferItems.map(entry => entry.getAsFileSystemHandle?.());
  try {
    const resolved = (await Promise.all(handles)).filter(Boolean);
    const directories = resolved.filter(handle => handle.kind === 'directory');
    if (directories.length) {
      if (directories.length !== 1 || resolved.length !== 1) throw Error('Choose one shipment folder at a time for replacement.');
      await importFolder(directories[0]);
    } else if (legacyDirectories) setStatus('Use Choose folder to grant access for replacing files in that folder.');
    else await addFiles(fallback);
  } catch (error) { if (error.name !== 'AbortError') setStatus(error.message); }
});
window.addEventListener('beforeunload', event => { if (busy || pending()) { event.preventDefault(); event.returnValue = ''; } });
