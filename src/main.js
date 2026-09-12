import { inputArgs, encodingArgs, validateOptions, isVideo } from '../shared/options.mjs';

const $ = id => document.getElementById(id);
const native = window.desktop;
const queue = [];
let busy = false, cancelled = false, ffmpeg, epoch = 0, ready = false, packaging = false;
let outputDirectory, webDirectory, loadController, activeTool, progressTimer;
const pendingProgress = new Set();
const bytes = n => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
function notice(message) { $('notice').textContent = message; }
function settings() {
  return validateOptions({ resolution: $('resolution').value, profile: document.querySelector('input[name=profile]:checked').value,
    hardware: $('hardware').checked, trimStart: Number($('trim-start').value || 0),
    trimEnd: $('trim-end').value.trim() === '' ? undefined : Number($('trim-end').value), mute: $('mute').checked });
}
export function activateVideoTool(id) {
  if (busy || !['video', 'video-compress', 'video-trim', 'video-mute'].includes(id)) return false;
  if (activeTool !== id) {
    $('resolution').value = ['video-trim', 'video-mute'].includes(id) ? 'original' : id === 'video-compress' ? '720' : '1080';
    document.querySelector(`input[name=profile][value=${id === 'video-compress' ? 'smaller' : 'balanced'}]`).checked = true;
    $('trim-start').value = '0'; $('trim-end').value = ''; $('mute').checked = id === 'video-mute';
    $('video-advanced').open = ['video-trim', 'video-mute'].includes(id);
    activeTool = id;
  }
  updateSummary();
  return true;
}
function syncControls() {
  $('start').disabled = busy || !queue.some(f => f.status !== 'done');
  $('clear').disabled = busy || !queue.length;
  $('cancel').hidden = !busy || packaging;
  for (const id of ['pick-folder', 'pick-files', 'resolution', 'output', 'hardware', 'save-web-folder', 'trim-start', 'trim-end', 'mute', 'video-download-all']) $(id).disabled = busy;
  document.querySelectorAll('input[name=profile], .remove-video').forEach(el => { el.disabled = busy; });
  $('video-download-all').hidden = queue.filter(f => f.url).length < 2;
  document.querySelector('#video-panel .format small').textContent = $('mute').checked ? 'H.264 · No audio' : 'H.264 + AAC';
}
function setBusy(value) {
  if (busy === value) return;
  busy = value;
  $('video-panel').setAttribute('aria-busy', String(value));
  syncControls();
  window.dispatchEvent(new CustomEvent('video-busy', { detail: value }));
}
function scheduleProgress(file) {
  pendingProgress.add(file);
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = undefined;
    for (const item of pendingProgress) if (queue.includes(item)) updateRow(item);
    pendingProgress.clear(); updateSummary(false);
  }, 100);
}
function updateSummary(controls = true) {
  const completed = queue.filter(f => f.status === 'done');
  const terminal = queue.filter(f => ['done', 'error', 'cancelled'].includes(f.status));
  const saving = completed.reduce((sum, f) => sum + f.size - f.outputSize, 0);
  $('count').textContent = queue.length;
  $('done-count').textContent = `${completed.length} / ${queue.length}`;
  $('total-size').textContent = queue.length ? `${queue.length} ${queue.length === 1 ? 'video' : 'videos'} · ${bytes(queue.reduce((sum, f) => sum + f.size, 0))}` : 'No videos selected';
  $('saved').textContent = completed.length ? bytes(Math.abs(saving)) : '—';
  $('saved-label').textContent = saving >= 0 ? 'space saved' : 'extra output space';
  $('overall').value = queue.length ? (terminal.length * 100 + queue.filter(f => f.status === 'processing').reduce((sum, f) => sum + (f.progress || 0), 0)) / queue.length : 0;
  if (controls) syncControls();
}
function updateRow(file) {
  let row = document.getElementById(file.id);
  if (!row) {
    row = document.createElement('div'); row.className = 'video-row'; row.id = file.id;
    row.innerHTML = '<div class="video-icon" aria-hidden="true">▶</div><div><span class="video-name"></span><div class="video-details"></div><progress class="row-progress" max="100" aria-label="Video progress"></progress></div><div class="video-actions"><span class="status"></span><button class="remove-video" type="button">×</button></div>';
    const remove = row.querySelector('.remove-video');
    remove.setAttribute('aria-label', `Remove ${file.name}`); remove.title = 'Remove video';
    remove.onclick = () => {
      if (busy) return;
      if (file.url && !confirm('Remove this video and its download link? Save your download first.')) return;
      const index = queue.indexOf(file); if (index === -1) return;
      if (file.url) URL.revokeObjectURL(file.url);
      queue.splice(index, 1); pendingProgress.delete(file); row.remove(); updateSummary();
      if (!queue.length) $('batch-status').textContent = 'Ready when you are.';
    };
    $('queue').append(row);
  }
  row.querySelector('.video-name').textContent = file.name;
  row.querySelector('.video-name').title = file.name;
  row.querySelector('.video-details').textContent = `${bytes(file.size)}${file.outputSize ? ` → ${bytes(file.outputSize)}` : ''}${file.note ? ` · ${file.note}` : ''}${file.error ? ` · ${file.error}` : ''}`;
  const status = row.querySelector('.status'); status.className = `status ${file.status}`;
  status.textContent = file.status === 'processing' ? `${Math.round(file.progress || 0)}%` : ({ queued: 'Waiting', done: 'Finished', error: 'Failed', cancelled: 'Cancelled' })[file.status];
  const progress = row.querySelector('progress'); progress.hidden = file.status !== 'processing'; progress.value = file.progress || 0;
  row.querySelector('.remove-video').disabled = busy;
  if (file.url && !row.querySelector('.download')) {
    const link = document.createElement('a'); link.className = 'download'; link.href = file.url; link.download = file.name.replaceAll(/[\\/]/g, '_') + '.optimized.mp4'; link.textContent = 'Download ↓'; row.querySelector('.video-actions').append(link);
  }
}
function addFiles(files) {
  if (busy) return;
  let ignored = 0;
  for (const input of files) {
    const name = native ? input.name : input.webkitRelativePath || input.relativeName || input.name;
    if (!isVideo(name)) { ignored++; continue; }
    if (queue.some(f => native ? f.id === input.id : f.name === name && f.size === input.size)) continue;
    const file = { id: native ? input.id : crypto.randomUUID(), name, size: input.size, file: native ? undefined : input, status: 'queued', progress: 0 };
    queue.push(file); updateRow(file);
  }
  updateSummary();
  notice(ignored ? `${ignored} non-video files skipped.` : queue.length ? 'Ready. Choose your settings and optimize the batch.' : 'No supported video files found.');
}
function finish(error) {
  setBusy(false);
  queue.filter(f => f.status === 'queued' || f.status === 'processing').forEach(f => { f.status = error ? 'error' : 'cancelled'; if (error) f.error = error; updateRow(f); });
  const failed = queue.filter(f => f.status === 'error').length;
  $('batch-status').textContent = error ? 'Batch could not finish.' : cancelled ? 'Batch cancelled. Finished videos are kept.' : failed ? `Batch finished · ${failed} failed` : 'Your videos are ready.';
  if (error) notice(error);
  else if (!native && !cancelled) notice(webDirectory ? 'Finished videos are saved in your selected output folder.' : 'Download your finished videos from the queue. Keep this tab open until your downloads are saved.');
  updateSummary();
}
if (native) {
  $('download-windows').hidden = true;
  $('mode').textContent = 'DESKTOP EDITION'; $('native-options').hidden = false; $('web-note').hidden = true;
  $('drop-hint').textContent = 'MP4, MOV, MKV, WebM & more · Choose a folder or select videos';
  native.onEvent(event => {
    if (event.type === 'fatal') { finish(event.error); return; }
    if (event.type === 'finished') { cancelled = event.cancelled; $('open-output').hidden = false; finish(); return; }
    const file = queue.find(f => f.id === event.id);
    if (file) {
      Object.assign(file, event);
      if (event.status || file.status !== 'processing') { updateRow(file); updateSummary(); }
      else scheduleProgress(file);
      if (event.status === 'processing') $('batch-status').textContent = `Processing ${file.name}`;
    }
  });
}
if (!native && 'showDirectoryPicker' in window) {
  $('save-web-folder').hidden = false;
  $('save-web-folder').onclick = async () => {
    try { webDirectory = await window.showDirectoryPicker({ mode: 'readwrite' }); $('save-web-folder').textContent = `Save to: ${webDirectory.name}`; notice('Each batch creates a new output subfolder. Results will save automatically.'); }
    catch (error) { if (error.name !== 'AbortError') notice(error.message); }
  };
}
for (const kind of ['folder', 'files']) {
  $(`pick-${kind}`).onclick = async () => {
    try { if (native) addFiles(await native.pickInput(kind)); else $(kind === 'folder' ? 'folder-input' : 'files-input').click(); }
    catch (error) { notice(error.message); }
  };
}
for (const id of ['folder-input', 'files-input']) $(id).onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };
$('output').onclick = async () => { try { const dir = await native.pickOutput(); if (dir) $('output-label').textContent = dir; } catch (error) { notice(error.message); } };
$('open-output').onclick = async () => { try { await native.openOutput(); } catch (error) { notice(error.message); } };
$('clear').onclick = () => {
  if (busy) return;
  if (!native && queue.some(f => f.url) && !confirm('Clear all videos and download links? Save your downloads first.')) return;
  queue.forEach(f => { if (f.url) URL.revokeObjectURL(f.url); }); queue.length = 0; pendingProgress.clear(); $('queue').replaceChildren();
  native?.clear().catch(error => notice(error.message)); $('batch-status').textContent = 'Ready when you are.'; notice(''); updateSummary();
};
const zone = $('dropzone');
zone.ondragover = event => { event.preventDefault(); if (!busy && !native) zone.classList.add('dragging'); };
zone.ondragleave = () => zone.classList.remove('dragging');
zone.ondrop = async event => {
  event.preventDefault(); zone.classList.remove('dragging'); if (busy || native) return;
  const entries = [...event.dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallbackFiles = [...event.dataTransfer.files];
  async function walk(entry, parent = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file.relativeName = parent + file.name; return [file];
    }
    const reader = entry.createReader(); const files = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) files.push(...await walk(child, parent + entry.name + '/'));
    }
    return files;
  }
  try { const files = entries.length ? (await Promise.all(entries.map(entry => walk(entry)))).flat() : fallbackFiles; addFiles(files); }
  catch { notice('Could not read that folder. Please use Choose folder.'); }
};
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
window.addEventListener('beforeunload', event => { if (busy || (!native && queue.some(f => f.url))) { event.preventDefault(); event.returnValue = ''; } });

async function getBrowserEngine(token) {
  if (ffmpeg && ready) return ffmpeg;
  notice('Loading the video engine (about 32 MB). This happens once per session.');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  if (cancelled || token !== epoch) throw new Error('Cancelled');
  const engine = new FFmpeg(), controller = new AbortController();
  ffmpeg = engine; ready = false; loadController = controller;
  let wasmURL;
  try {
    const base = new URL('./ffmpeg/', document.baseURI);
    const checkedFetch = async url => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not download the video engine. Check your connection and retry.');
      return response;
    };
    const manifest = await (await checkedFetch(new URL('core.json', base))).json();
    const parts = await Promise.all(manifest.chunks.map(async name => (await checkedFetch(new URL(name, base))).arrayBuffer()));
    if (cancelled || token !== epoch) throw new Error('Cancelled');
    wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
    await engine.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL });
    if (cancelled || token !== epoch) throw new Error('Cancelled');
    ready = true; return engine;
  } catch (error) {
    controller.abort(); engine.terminate();
    if (ffmpeg === engine) { ffmpeg = undefined; ready = false; }
    throw error;
  } finally {
    if (wasmURL) URL.revokeObjectURL(wasmURL);
    if (loadController === controller) loadController = undefined;
  }
}
async function uniqueOutputHandle(directory, filename) {
  const stem = filename.replace(/\.mp4$/i, '');
  let candidate = filename, suffix = 2;
  while (true) {
    try { await directory.getFileHandle(candidate); }
    catch (error) {
      if (error.name === 'NotFoundError') return directory.getFileHandle(candidate, { create: true });
      if (error.name !== 'TypeMismatchError') throw error;
    }
    candidate = `${stem} (${suffix++}).mp4`;
  }
}
async function runBrowser(options, token) {
  const directory = webDirectory ? await webDirectory.getDirectoryHandle(`Video Resizer Output ${Date.now()}`, { create: true }) : undefined;
  for (const file of queue.filter(f => f.status !== 'done')) {
    if (cancelled || token !== epoch) break;
    file.status = 'processing'; file.progress = 0; file.error = ''; updateRow(file); updateSummary();
    $('batch-status').textContent = `Processing ${file.name}`;
    let engine, listener, logger;
    const inputName = `input.${file.name.split('.').pop().toLowerCase()}`;
    try {
      // FFmpeg.wasm uses an in-memory filesystem. Bound individual inputs to avoid a predictable browser crash.
      if (file.size > 1024 ** 3) throw new Error('Over the 1 GB browser limit. Use the desktop app for this video.');
      engine = await getBrowserEngine(token);
      notice('Processing locally. Large videos can take longer than their playback time.');
      let log = '', duration = 0, sourceDuration = 0, maxFrames = 0;
      const trimmed = options.trimStart > 0 || options.trimEnd !== undefined;
      logger = ({ message }) => {
        log = (log + '\n' + message).slice(-4000);
        const match = message.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) {
          sourceDuration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          duration = Math.max(0, Math.min(sourceDuration, options.trimEnd ?? sourceDuration) - options.trimStart);
        }
        const frames = message.match(/frame=\s*(\d+)/);
        if (frames) maxFrames = Math.max(maxFrames, Number(frames[1]));
      };
      listener = ({ progress, time }) => {
        const value = duration > 0 && Number.isFinite(time) ? time / 1e6 / duration * 100 : trimmed ? 0 : progress * 100;
        file.progress = Number.isFinite(value) ? Math.max(0, Math.min(99, value)) : 0;
        scheduleProgress(file);
      };
      engine.on('progress', listener); engine.on('log', logger);
      const data = new Uint8Array(await file.file.arrayBuffer());
      if (cancelled || token !== epoch) throw new Error('Cancelled');
      await engine.writeFile(inputName, data);
      const result = await engine.exec(['-hide_banner', '-y', ...inputArgs(options), '-i', inputName, ...encodingArgs(options), 'output.mp4']);
      if (options.trimStart > 0 && sourceDuration > 0 && options.trimStart >= sourceDuration) throw new Error('Trim start must be earlier than the end of this video.');
      if (result !== 0) throw new Error(`Could not convert this video. ${log.split('\n').filter(Boolean).slice(-2).join(' ')}`);
      if (maxFrames === 0 && /(?:frame=\s*0|Output file is empty|video:0kB)/.test(log)) throw new Error('No video frames were produced. Check your trim range and try again.');
      const output = await engine.readFile('output.mp4');
      if (!output.byteLength) throw new Error('The encoder produced an empty video. Check your trim range.');
      if (cancelled || token !== epoch) throw new Error('Cancelled');
      file.outputSize = output.byteLength;
      if (directory) {
        const segments = file.name.split(/[\\/]/).filter(part => part && part !== '.' && part !== '..');
        const name = segments.pop(); let target = directory;
        for (const segment of segments) target = await target.getDirectoryHandle(segment, { create: true });
        if (cancelled || token !== epoch) throw new Error('Cancelled');
        const handle = await uniqueOutputHandle(target, `${name}.optimized.mp4`);
        const writable = await handle.createWritable();
        try { await writable.write(output); await writable.close(); }
        catch (error) { await writable.abort().catch(() => {}); throw error; }
        file.note = 'Saved to output folder';
      } else file.url = URL.createObjectURL(new Blob([output], { type: 'video/mp4' }));
      file.status = 'done'; file.progress = 100;
    } catch (error) {
      file.status = cancelled ? 'cancelled' : 'error';
      file.error = cancelled ? '' : error.message || 'This browser ran out of memory. Try a smaller file or the desktop app.';
      // Reset the worker after errors so a damaged WASM instance cannot poison later files.
      if (engine) { engine.terminate(); if (ffmpeg === engine) { ffmpeg = undefined; ready = false; } }
    } finally {
      if (engine && listener) engine.off('progress', listener);
      if (engine && logger) engine.off('log', logger);
      if (engine && ffmpeg === engine && ready) { await engine.deleteFile(inputName).catch(() => {}); await engine.deleteFile('output.mp4').catch(() => {}); }
      updateRow(file); updateSummary();
    }
  }
  finish();
}
$('start').onclick = async () => {
  if (busy || !queue.some(f => f.status !== 'done')) return;
  let options;
  try { options = settings(); } catch (error) { notice(error.message); return; }
  cancelled = false; const token = ++epoch;
  setBusy(true);
  queue.filter(f => f.status !== 'done').forEach(f => { f.status = 'queued'; f.progress = 0; f.error = ''; updateRow(f); });
  updateSummary(); $('open-output').hidden = true;
  $('batch-status').textContent = 'Preparing your batch…';
  try {
    if (native) { outputDirectory = await native.start(queue.filter(f => f.status !== 'done').map(f => f.id), options); notice(`Results will be saved in ${outputDirectory}`); }
    else await runBrowser(options, token);
  } catch (error) { finish(cancelled ? undefined : error.message); }
};
$('mute').addEventListener('change', syncControls);
$('cancel').onclick = async () => {
  cancelled = true; ++epoch;
  $('batch-status').textContent = 'Cancelling…';
  try { if (native) await native.cancel(); else { loadController?.abort(); ffmpeg?.terminate(); ffmpeg = undefined; ready = false; } }
  catch (error) { notice(error.message); }
};
$('video-download-all').onclick = async () => {
  if (busy) return;
  const completed = queue.filter(file => file.url);
  if (completed.length < 2) return;
  if (completed.reduce((sum, file) => sum + file.outputSize, 0) > 500 * 1024 ** 2) {
    notice('These results exceed the 500 MB ZIP limit. Download videos individually, or save the next batch to a folder.'); return;
  }
  packaging = true; setBusy(true); notice('Preparing your ZIP download…');
  try {
    const { downloadZip } = await import('../shared/download-zip.mjs');
    const files = [];
    for (const file of completed) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('Could not read a video result. Download videos individually.');
      files.push({ name: `${file.name.replace(/[\\/]/g, '_')}.optimized.mp4`, blob: await response.blob() });
    }
    await downloadZip(files, 'Binary-Beat-videos.zip');
    notice('Your ZIP download is ready. Individual video downloads are still available.');
  } catch (error) { notice(error.message || 'Could not create the ZIP. Download videos individually.'); }
  finally { packaging = false; setBusy(false); updateSummary(); }
};
updateSummary();
