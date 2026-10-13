import { fileKind, limitBytes, safeRelativePath, replaceExtension, videoPlan, videoArgs, IMAGE_STEPS, scaledSize, extensionOf } from '../shared/fit-size.mjs';

const $ = id => document.getElementById(id);
const native = window.desktop;
const KIND_LABEL = { image: 'IMG', video: 'VID', pdf: 'PDF', doc: 'DOC', other: 'FILE' };
const DOC_STEPS = [{ maxEdge: 2400, quality: 0.8 }, { maxEdge: 1800, quality: 0.7 }, { maxEdge: 1400, quality: 0.6 }, { maxEdge: 1000, quality: 0.5 }, { maxEdge: 800, quality: 0.42 }];
const PDF_STEPS = [{ dpi: 110, quality: 0.7 }, { dpi: 90, quality: 0.6 }, { dpi: 72, quality: 0.5 }, { dpi: 60, quality: 0.4 }];
const MAX_WEB_VIDEO = 1024 ** 3;
let items = [], busy = false, cancelled = false, epoch = 0, ffmpeg, ffmpegReady = false, loadController;

const formatSize = n => !n ? '0 KB' : n < 1024 ** 2 ? `${Math.max(0.1, n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
const status = message => { $('fit-status').textContent = message; };
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
const checkCancelled = token => { if (cancelled || token !== epoch) throw Error('Cancelled'); };
const limit = () => limitBytes($('fit-limit').value);
const pending = () => items.some(item => item.output && !item.saved);

export function activateFitTool() {
  $('fit-hint').textContent = native ? 'JPG, PNG, WebP · MP4, MOV, MKV & more · PDF · DOCX, PPTX, XLSX · Native video engine'
    : 'JPG, PNG, WebP · MP4, MOV, MKV & more (up to 1 GB each) · PDF · DOCX, PPTX, XLSX';
  syncPresets(); render();
}

// ---------- File selection ----------
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
    items.push({ file, path, kind, status: 'queued', progress: 0 }); added++;
  }
  items.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  render();
  status(added ? `${added} ${added === 1 ? 'file' : 'files'} added${skipped ? ` · ${skipped} system or empty files skipped` : ''}. Ready when you are.` : 'No new files were added.');
}

function describe(item) {
  const base = formatSize(item.file.size);
  if (item.status === 'error') return `${base} · ${item.error}`;
  if (item.output) return `${base} → ${formatSize(item.output.size)}${item.note ? ` · ${item.note}` : ''}`;
  if (item.status === 'skipped') return `${base} · ${item.note}`;
  return item.note ? `${base} · ${item.note}` : base;
}
const STATE_TEXT = { queued: 'Waiting', processing: 'Working…', done: 'Fitted', kept: 'Already fits', error: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' };

function rowFor(item) {
  if (!item.row) {
    const row = document.createElement('div'); row.className = 'fit-row';
    const kind = document.createElement('span'); kind.className = `fit-kind ${item.kind}`; kind.textContent = KIND_LABEL[item.kind];
    const info = document.createElement('div');
    const name = document.createElement('span'); name.className = 'fit-name'; name.textContent = item.path; name.title = item.path;
    const detail = document.createElement('span'); detail.className = 'fit-detail';
    info.append(name, detail);
    const state = document.createElement('span'); state.className = 'fit-state';
    const progress = document.createElement('progress'); progress.max = 100; progress.hidden = true;
    row.append(kind, info, state, progress);
    item.row = { row, detail, state, progress };
  }
  const { row, detail, state, progress } = item.row;
  detail.textContent = describe(item);
  state.textContent = STATE_TEXT[item.status]; state.className = `fit-state ${item.status}`;
  progress.hidden = item.status !== 'processing'; progress.value = item.progress;
  return row;
}

function render() {
  $('fit-files').replaceChildren(...items.map(rowFor));
  $('fit-count').textContent = String(items.length);
  $('fit-empty').hidden = items.length > 0;
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  const counts = items.reduce((map, item) => ({ ...map, [item.kind]: (map[item.kind] || 0) + 1 }), {});
  $('fit-total-size').textContent = items.length ? `${formatSize(total)} · ${Object.entries(counts).map(([kind, count]) => `${count} ${KIND_LABEL[kind].toLowerCase()}`).join(', ')}` : 'No files selected';
  $('fit-start').disabled = busy || !items.some(item => !['done', 'kept'].includes(item.status));
  $('fit-clear').disabled = busy || !items.length;
}

function setBusy(value) {
  busy = value;
  $('fit-panel').setAttribute('aria-busy', String(value));
  for (const id of ['fit-pick-folder', 'fit-pick-files', 'fit-limit', 'fit-include-other', 'fit-mute', 'fit-save-folder', 'fit-download']) $(id).disabled = value;
  document.querySelectorAll('[data-fit-limit]').forEach(button => { button.disabled = value; });
  $('fit-start').hidden = value; $('fit-cancel').hidden = !value; $('fit-progress').hidden = !value;
  render();
  window.dispatchEvent(new CustomEvent('fit-busy', { detail: value }));
}

function syncPresets() {
  document.querySelectorAll('[data-fit-limit]').forEach(button => button.classList.toggle('active', button.dataset.fitLimit === String(Number($('fit-limit').value))));
}

// ---------- Images ----------
function hasTransparency(bitmap) {
  const size = scaledSize(bitmap.width, bitmap.height, 256);
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

async function encode(bitmap, { width, height }, type, quality) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw Error('Image processing is unavailable on this device.');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.type !== type) throw Error('This browser cannot export this image format.');
    return blob;
  } finally { canvas.width = canvas.height = 1; }
}

async function decode(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { throw Error('Cannot read this image. HEIC and RAW photos are not supported; export them as JPG first.'); }
}

let webpSupport;
async function canEncodeWebp() {
  if (webpSupport === undefined) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    webpSupport = await new Promise(resolve => canvas.toBlob(blob => resolve(blob?.type === 'image/webp'), 'image/webp', 0.8));
  }
  return webpSupport;
}

async function fitImage(item, target, token) {
  const bitmap = await decode(item.file);
  try {
    if (bitmap.width * bitmap.height > 120_000_000) throw Error('Image is above 120 megapixels.');
    // Photos become JPG. Transparent graphics become WebP (or PNG where WebP export is unavailable).
    const alpha = extensionOf(item.path) !== 'jpg' && extensionOf(item.path) !== 'jpeg' && hasTransparency(bitmap);
    const type = !alpha ? 'image/jpeg' : await canEncodeWebp() ? 'image/webp' : 'image/png';
    const extension = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[type];
    for (const [index, step] of IMAGE_STEPS.entries()) {
      checkCancelled(token);
      item.progress = (index + 1) / IMAGE_STEPS.length * 100; rowFor(item);
      const size = scaledSize(bitmap.width, bitmap.height, step.maxEdge);
      const blob = await encode(bitmap, size, type, step.quality);
      if (blob.size <= target) {
        const resized = size.width !== bitmap.width ? ` · ${size.width}×${size.height}` : '';
        return { blob, path: replaceExtension(item.path, extension), note: `${extension.toUpperCase()} ${Math.round(step.quality * 100)}%${resized}` };
      }
      await yieldToBrowser();
    }
    throw Error('Could not get this image under the limit without making it unusable.');
  } finally { bitmap.close(); }
}

// ---------- PDF ----------
async function fitPdf(item, target, token) {
  const input = new Uint8Array(await item.file.arrayBuffer());
  const { compressPDF } = await import('../shared/pdf-tools.mjs');
  try {
    const structural = await compressPDF(input);
    if (structural.length <= target) return { blob: new Blob([structural], { type: 'application/pdf' }), path: item.path, note: 'Structural compression · text kept' };
  } catch (error) { if (/encrypt|password/i.test(error.message)) throw Error('This PDF is password protected.'); }
  const { scanCompress } = await import('./pdf-scan.js');
  for (const [index, step] of PDF_STEPS.entries()) {
    checkCancelled(token);
    const output = await scanCompress(input, message => { status(`${item.path}: ${message}`); }, { ...step, maxEdge: 2400 });
    checkCancelled(token);
    item.progress = (index + 1) / PDF_STEPS.length * 100; rowFor(item);
    if (output.length <= target && output !== input) return { blob: new Blob([output], { type: 'application/pdf' }), path: item.path, note: `Image pages · ${step.dpi} DPI · text not selectable` };
  }
  throw Error('Could not get this PDF under the limit. Try splitting it first.');
}

// ---------- Office documents ----------
async function fitDoc(item, target, token) {
  const { shrinkOfficeFile } = await import('../shared/office-zip.mjs');
  const input = new Uint8Array(await item.file.arrayBuffer());
  for (const [index, step] of DOC_STEPS.entries()) {
    checkCancelled(token);
    const blob = await shrinkOfficeFile(input, async (name, bytes) => {
      checkCancelled(token);
      const jpeg = /\.jpe?g$/i.test(name);
      let bitmap;
      try { bitmap = await createImageBitmap(new Blob([bytes])); } catch { return null; }
      try {
        const size = scaledSize(bitmap.width, bitmap.height, step.maxEdge);
        // PNG keeps its format (it may be referenced as PNG); only its dimensions can shrink.
        if (!jpeg && size.width === bitmap.width) return null;
        const output = await encode(bitmap, size, jpeg ? 'image/jpeg' : 'image/png', step.quality);
        return new Uint8Array(await output.arrayBuffer());
      } finally { bitmap.close(); }
    });
    item.progress = (index + 1) / DOC_STEPS.length * 100; rowFor(item);
    if (blob.size <= target) return { blob: new Blob([blob], { type: item.file.type || 'application/octet-stream' }), path: item.path, note: `Pictures re-encoded · max ${step.maxEdge}px` };
    await yieldToBrowser();
  }
  throw Error('Could not get this document under the limit. Its text or embedded videos are too large.');
}

// ---------- Video ----------
async function browserEngine(token) {
  if (ffmpeg && ffmpegReady) return ffmpeg;
  status('Loading the video engine (about 32 MB). This happens once per session.');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  checkCancelled(token);
  const engine = new FFmpeg(), controller = new AbortController();
  ffmpeg = engine; ffmpegReady = false; loadController = controller;
  let wasmURL;
  try {
    const base = new URL('./ffmpeg/', document.baseURI);
    const get = async url => { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw Error('Could not download the video engine. Check your connection and retry.'); return response; };
    const manifest = await (await get(new URL('core.json', base))).json();
    const parts = await Promise.all(manifest.chunks.map(async name => (await get(new URL(name, base))).arrayBuffer()));
    checkCancelled(token);
    wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
    await engine.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL });
    checkCancelled(token);
    ffmpegReady = true; return engine;
  } catch (error) {
    controller.abort(); engine.terminate();
    if (ffmpeg === engine) { ffmpeg = undefined; ffmpegReady = false; }
    throw error;
  } finally { if (wasmURL) URL.revokeObjectURL(wasmURL); if (loadController === controller) loadController = undefined; }
}

async function fitVideoNative(item, target) {
  const stop = native.onFitProgress(value => { item.progress = value; rowFor(item); });
  try {
    const data = await native.fitVideo(item.file, target, $('fit-mute').checked);
    return { blob: new Blob([data], { type: 'video/mp4' }), path: replaceExtension(item.path, 'mp4'), note: 'MP4 · native engine' };
  } finally { stop(); }
}

async function fitVideoBrowser(item, target, token) {
  if (item.file.size > MAX_WEB_VIDEO) throw Error('Over the 1 GB browser limit. Use the desktop app for this video.');
  const engine = await browserEngine(token);
  const inputName = `input.${extensionOf(item.path) || 'mp4'}`;
  let log = '', duration = 0, attempt = 0;
  const logger = ({ message }) => {
    log = (log + '\n' + message).slice(-4000);
    const match = message.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  };
  const listener = ({ time }) => { if (duration && Number.isFinite(time)) { item.progress = Math.min(99, (attempt + time / 1e6 / duration) / (attempt + 1) * 100); rowFor(item); } };
  engine.on('log', logger); engine.on('progress', listener);
  try {
    await engine.writeFile(inputName, new Uint8Array(await item.file.arrayBuffer()));
    checkCancelled(token);
    await engine.exec(['-hide_banner', '-i', inputName]); // Reads the duration; "no output" is expected.
    for (; attempt < 4; attempt++) {
      checkCancelled(token);
      const plan = videoPlan(duration, target, attempt, { mute: $('fit-mute').checked });
      status(`${item.path}: encoding at ${plan.videoKbps} kbps, up to ${plan.maxEdge}px${attempt ? ` (attempt ${attempt + 1})` : ''}…`);
      const code = await engine.exec(['-hide_banner', '-y', '-i', inputName, ...videoArgs(plan), 'output.mp4']);
      checkCancelled(token);
      if (code !== 0) throw Error(`Could not convert this video. ${log.split('\n').filter(Boolean).slice(-2).join(' ')}`);
      const output = await engine.readFile('output.mp4');
      if (output.byteLength && output.byteLength <= target) return { blob: new Blob([output], { type: 'video/mp4' }), path: replaceExtension(item.path, 'mp4'), note: `MP4 · ${plan.videoKbps} kbps · max ${plan.maxEdge}px` };
    }
    throw Error('Could not get this video under the limit.');
  } catch (error) {
    // A failed WASM instance can be left in a bad state; start fresh for the next file.
    if (ffmpeg === engine) { engine.terminate(); ffmpeg = undefined; ffmpegReady = false; }
    throw error;
  } finally {
    engine.off('log', logger); engine.off('progress', listener);
    if (ffmpeg === engine && ffmpegReady) { await engine.deleteFile(inputName).catch(() => {}); await engine.deleteFile('output.mp4').catch(() => {}); }
  }
}

// ---------- Batch ----------
async function processItem(item, target, token) {
  if (item.file.size <= target && !(item.kind === 'video' && $('fit-mute').checked)) {
    if (item.kind === 'other' && !$('fit-include-other').checked) return { skip: 'Not included' };
    return { blob: item.file, path: item.path, kept: true, note: 'Original kept' };
  }
  if (item.kind === 'image') return fitImage(item, target, token);
  if (item.kind === 'pdf') return fitPdf(item, target, token);
  if (item.kind === 'doc') return fitDoc(item, target, token);
  if (item.kind === 'video') {
    if (native) return fitVideoNative(item, target);
    return fitVideoBrowser(item, target, token);
  }
  throw Error('This file type cannot be made smaller. Compress or split it in its own app.');
}

$('fit-start').onclick = async () => {
  if (busy) return;
  let target;
  try { target = limit(); } catch (error) { status(error.message); return; }
  if (pending() && !confirm('Process again and replace results you have not saved?')) return;
  cancelled = false; const token = ++epoch;
  const queue = items.filter(item => !['done', 'kept'].includes(item.status) || item.target !== target);
  queue.forEach(item => { item.status = 'queued'; item.progress = 0; item.output = undefined; item.saved = false; item.error = ''; item.note = ''; });
  setBusy(true); $('fit-results').replaceChildren();
  for (const [index, item] of queue.entries()) {
    if (cancelled || token !== epoch) { item.status = 'cancelled'; rowFor(item); continue; }
    item.status = 'processing'; rowFor(item); item.row.row.scrollIntoView({ block: 'nearest' });
    status(`Working on ${index + 1} of ${queue.length}: ${item.path}`);
    $('fit-progress').value = index / queue.length * 100;
    await yieldToBrowser();
    try {
      const result = await processItem(item, target, token);
      if (result.skip) { item.status = 'skipped'; item.note = result.skip; }
      else {
        if (result.blob.size > target) throw Error('The result is still above the limit.');
        item.output = result.blob; item.outputPath = result.path; item.note = result.note; item.target = target;
        item.status = result.kept ? 'kept' : 'done';
      }
    } catch (error) {
      item.status = cancelled ? 'cancelled' : 'error';
      item.error = cancelled ? '' : error.message || 'Ran out of memory. Try the desktop app for very large files.';
    }
    item.progress = 100; rowFor(item);
  }
  $('fit-progress').value = 100;
  setBusy(false); showResults(target);
};

function showResults(target) {
  const ready = items.filter(item => item.output);
  const fitted = items.filter(item => item.status === 'done'), failed = items.filter(item => item.status === 'error');
  const before = fitted.reduce((sum, item) => sum + item.file.size, 0), after = fitted.reduce((sum, item) => sum + item.output.size, 0);
  $('fit-summary').textContent = ready.length ? `${ready.length} ${ready.length === 1 ? 'file' : 'files'} ready, each under ${formatSize(target)}` : 'No files are ready';
  const stats = document.createElement('div'); stats.className = 'fit-stats';
  for (const [value, label] of [[fitted.length, 'made smaller'], [items.filter(item => item.status === 'kept').length, 'already fit'], [failed.length, 'could not fit'], [before ? `${Math.round((1 - after / before) * 100)}%` : '—', 'saved on fitted files']]) {
    const box = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; box.append(strong, span); stats.append(box);
  }
  const children = [stats];
  if (failed.length) {
    const list = document.createElement('ul'); list.className = 'fit-failures';
    failed.forEach(item => { const li = document.createElement('li'); li.textContent = `${item.path}: ${item.error}`; list.append(li); });
    children.push(list);
  }
  $('fit-results').replaceChildren(...children);
  $('fit-save-folder').hidden = !ready.length || !window.showDirectoryPicker;
  $('fit-download').hidden = !ready.length;
  status(cancelled ? 'Cancelled. Finished files are still available to save.' : failed.length ? `Done with ${failed.length} ${failed.length === 1 ? 'file' : 'files'} that could not fit. See details below.` : 'All done! Save your files below. Originals are unchanged.');
}

$('fit-cancel').onclick = async () => {
  cancelled = true; ++epoch; status('Cancelling…');
  try { if (native) await native.cancelFit(); loadController?.abort(); if (ffmpeg) { ffmpeg.terminate(); ffmpeg = undefined; ffmpegReady = false; } }
  catch (error) { status(error.message); }
};

$('fit-download').onclick = async () => {
  const ready = items.filter(item => item.output);
  const total = ready.reduce((sum, item) => sum + item.output.size, 0);
  if (total > 1.5 * 1024 ** 3) { status('These results are too large for one ZIP. Use Save to folder in Chrome or Edge, or the desktop app.'); return; }
  setBusy(true); status('Preparing your ZIP…');
  try {
    const { downloadZip } = await import('../shared/download-zip.mjs');
    await downloadZip(ready.map(item => ({ name: item.outputPath, blob: item.output })), `Binary-Beat-under-${Number($('fit-limit').value)}MB.zip`, { keepFolders: true });
    ready.forEach(item => { item.saved = true; });
    status('ZIP download started. Folder structure is preserved inside the ZIP.');
  } catch (error) { status(`Could not create the ZIP: ${error.message}`); }
  finally { setBusy(false); }
};

$('fit-save-folder').onclick = async () => {
  let root;
  try { root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'binary-beat-fit' }); } catch { return; }
  setBusy(true);
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const output = await root.getDirectoryHandle(`Binary Beat under ${Number($('fit-limit').value)} MB ${stamp}`, { create: true });
    const ready = items.filter(item => item.output);
    for (const [index, item] of ready.entries()) {
      status(`Saving ${index + 1} of ${ready.length}: ${item.outputPath}`);
      const segments = item.outputPath.split('/'), name = segments.pop();
      let directory = output;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
      const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
      try { await writable.write(item.output); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
      item.saved = true;
    }
    status(`Saved ${ready.length} files to “${root.name}/${output.name}”, with your folder structure.`);
  } catch (error) { status(`Could not save: ${error.message}`); }
  finally { setBusy(false); }
};

// ---------- Inputs ----------
$('fit-pick-folder').onclick = () => { if (!busy) $('fit-folder-input').click(); };
$('fit-pick-files').onclick = () => { if (!busy) $('fit-files-input').click(); };
for (const id of ['fit-folder-input', 'fit-files-input']) $(id).onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };
$('fit-clear').onclick = () => {
  if (busy || (pending() && !confirm('Clear everything? Results you have not saved will be lost.'))) return;
  items = []; $('fit-results').replaceChildren(); $('fit-save-folder').hidden = $('fit-download').hidden = true; render(); status('Selection cleared.');
};
$('fit-limit').addEventListener('input', syncPresets);
document.querySelectorAll('[data-fit-limit]').forEach(button => { button.onclick = () => { $('fit-limit').value = button.dataset.fitLimit; syncPresets(); }; });

const zone = $('fit-dropzone');
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
  catch { status('Could not read that folder. Please use Choose folder.'); }
});
window.addEventListener('beforeunload', event => { if (busy || pending()) { event.preventDefault(); event.returnValue = ''; } });
