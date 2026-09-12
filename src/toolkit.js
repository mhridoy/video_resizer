import { imageType } from '../shared/image-tools.mjs';
import { encodeImage } from './image-tools.js';

const $ = id => document.getElementById(id);
const formatSize = value => !value ? '0 KB' : value < 1024 ** 2 ? `${Math.max(0.1, value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(2)} MB`;
const tools = {
  image: { title: 'Resize image', action: 'Resize images', help: 'JPG, PNG and WebP. Fit images inside your chosen dimensions while keeping proportions. Smaller images stay at their original size.' },
  'image-compress': { title: 'Compress image', action: 'Compress images', help: 'Reduce JPG, PNG and WebP file sizes while keeping their pixel dimensions. Choose JPG or WebP for adjustable quality. An original is kept if the result is larger.' },
  'image-convert': { title: 'Convert image', action: 'Convert images', help: 'Convert between JPG, PNG and WebP at the original dimensions. JPG fills transparent areas with white. PNG preserves transparency.' },
  merge: { title: 'Merge PDF', action: 'Merge PDFs', help: 'Combine two or more PDFs in the order below. Use the arrow buttons to reorder your files. Forms, bookmarks and digital signatures may not carry over.' },
  split: { title: 'Split PDF', action: 'Split PDF', help: 'Extract the pages you need, or save every page as a separate PDF. Forms, bookmarks and digital signatures may not carry over.' },
  compress: { title: 'Compress PDF', action: 'Compress PDFs', help: 'Structural compression keeps page content unchanged. Choose image mode for scanned documents. Already compact files may stay the same size. Use unsigned PDFs.' },
  rotate: { title: 'Rotate PDF', action: 'Rotate PDFs', help: 'Turn PDF pages clockwise by 90°, 180° or 270°. Page content remains intact. Use unsigned PDFs; any existing digital signatures will be invalidated.' },
  'images-pdf': { title: 'Images to PDF', action: 'Create PDF', help: 'Turn JPG, PNG and WebP images into one PDF, in the order below. Reorder your images, then choose A4 pages or the original image dimensions.' },
};
let files = [], results = [], busy = false, tool = 'image';
const isImageTool = () => tool.startsWith('image');
const pendingResults = () => results.some(item => !item.downloaded);
const pdfTools = () => import('../shared/pdf-tools.mjs');
const announce = message => { $('tool-status').textContent = message; };

function clearResults() {
  results.forEach(item => URL.revokeObjectURL(item.url)); results = [];
  $('tool-results').replaceChildren();
  if ($('tool-result-summary')) $('tool-result-summary').textContent = '';
  if ($('tool-download-all')) $('tool-download-all').hidden = true;
  updateProgress(0, false);
}

function updateProgress(percent, visible = true) {
  const element = $('tool-progress');
  if (!element) return;
  element.hidden = !visible;
  if (element.tagName === 'PROGRESS') { element.max = 100; element.value = percent; }
  else { element.setAttribute('role', 'progressbar'); element.setAttribute('aria-valuemin', '0'); element.setAttribute('aria-valuemax', '100'); element.setAttribute('aria-valuenow', String(Math.round(percent))); element.style.setProperty('--progress', `${percent}%`); }
}

function renderFiles() {
  $('tool-files').replaceChildren();
  files.forEach((file, index) => {
    const row = document.createElement('div'); row.className = 'tool-file';
    const info = document.createElement('div'); info.className = 'tool-file-info';
    const name = document.createElement('strong'); name.textContent = file.name;
    const details = document.createElement('span'); details.textContent = `${index + 1} · ${formatSize(file.size)}`;
    info.append(name, details);
    const actions = document.createElement('div'); actions.className = 'tool-file-actions';
    for (const [label, title, unavailable, action] of [
      ['↑', 'Move up', index === 0, () => { [files[index - 1], files[index]] = [files[index], files[index - 1]]; }],
      ['↓', 'Move down', index === files.length - 1, () => { [files[index + 1], files[index]] = [files[index], files[index + 1]]; }],
      ['×', 'Remove', false, () => files.splice(index, 1)],
    ]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary icon-button'; button.textContent = label;
      button.disabled = busy || unavailable; button.setAttribute('aria-label', `${title} ${file.name}`); button.title = `${title} ${file.name}`;
      button.onclick = () => { if (busy) return; action(); renderFiles(); };
      actions.append(button);
    }
    row.append(info, actions); $('tool-files').append(row);
  });
  $('tool-run').disabled = busy || files.length < (tool === 'merge' ? 2 : 1);
  $('tool-clear').disabled = busy || (!files.length && !results.length);
  if ($('tool-count')) $('tool-count').textContent = String(files.length);
  if ($('tool-total-size')) $('tool-total-size').textContent = formatSize(files.reduce((sum, file) => sum + file.size, 0));
  if ($('tool-empty')) $('tool-empty').hidden = files.length > 0;
}

function setBusy(value) {
  busy = value;
  $('tools-panel').setAttribute('aria-busy', String(value));
  document.querySelectorAll('#tools-panel input, #tools-panel select, #tools-panel button').forEach(element => { element.disabled = value; });
  $('tool-dropzone')?.setAttribute('aria-disabled', String(value));
  renderFiles();
  updateQuality();
  window.dispatchEvent(new CustomEvent('tool-busy', { detail: value }));
}

function addResult(data, filename, note = '', type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const record = { blob, name: filename, url, downloaded: false }; results.push(record);
  const row = document.createElement('div'); row.className = 'tool-file result-file';
  const info = document.createElement('div'); info.className = 'tool-file-info';
  const name = document.createElement('strong'); name.textContent = filename;
  const detail = document.createElement('span'); detail.textContent = `${formatSize(blob.size)}${note ? ` · ${note}` : ''}`;
  info.append(name, detail);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.className = 'primary download-link'; link.textContent = 'Download ↓';
  link.setAttribute('aria-label', `Download ${filename}`); link.onclick = () => { record.downloaded = true; };
  row.append(info, link); $('tool-results').append(row);
  if ($('tool-download-all')) $('tool-download-all').hidden = results.length < 2;
}

export function activateTool(selected) {
  if (!tools[selected] || busy) return false;
  if (selected !== tool) {
    if (pendingResults() && !confirm('Switch tools and clear these results? Download the files you need first.')) return false;
    files = []; clearResults();
  }
  tool = selected;
  $('tool-title').textContent = tools[tool].title; $('tool-run').textContent = tools[tool].action;
  $('tool-help').textContent = tools[tool].help;
  $('image-settings').hidden = !['image', 'image-compress', 'image-convert'].includes(tool);
  for (const id of ['image-width', 'image-height']) { const label = $(id)?.closest('label'); if (label) label.hidden = tool !== 'image'; }
  for (const [id, current] of [['split-settings', 'split'], ['compress-settings', 'compress'], ['rotate-settings', 'rotate'], ['images-pdf-settings', 'images-pdf']]) if ($(id)) $(id).hidden = tool !== current;
  if (tool === 'image-compress') $('image-format').value = 'image/webp';
  $('tool-input').accept = isImageTool() ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' : '.pdf,application/pdf';
  $('tool-input').multiple = tool !== 'split';
  announce(''); renderFiles(); updateQuality();
  return true;
}

function addFiles(picked) {
  if (busy) return;
  const accepted = [], rejected = [];
  let total = tool === 'split' ? 0 : files.reduce((sum, file) => sum + file.size, 0);
  for (const file of picked) {
    const valid = isImageTool() ? Boolean(imageType(file)) : file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!valid) { rejected.push(`${file.name}: choose ${isImageTool() ? 'JPG, PNG or WebP images' : 'PDF files'}.`); continue; }
    if (!file.size) { rejected.push(`${file.name}: this file is empty.`); continue; }
    if (file.size > 200 * 1024 ** 2 || total + file.size > 500 * 1024 ** 2) { rejected.push(`${file.name}: use files below 200 MB each and a batch below 500 MB.`); continue; }
    if ([...(tool === 'split' ? [] : files), ...accepted].some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
    if ((tool === 'split' ? 0 : files.length) + accepted.length >= 100) { rejected.push('Process up to 100 files at a time.'); break; }
    accepted.push(file); total += file.size;
    if (tool === 'split') break;
  }
  if (accepted.length) files = tool === 'split' ? accepted : [...files, ...accepted];
  renderFiles(); announce(rejected.length ? rejected.join(' ') : accepted.length ? `${accepted.length} ${accepted.length === 1 ? 'file added' : 'files added'}. Ready when you are.` : 'These files are already in your selection.');
}

$('tool-input').onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };
if ($('tool-pick')) $('tool-pick').onclick = () => { if (!busy) $('tool-input').click(); };
const dropzone = $('tool-dropzone');
if (dropzone) {
  for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, event => { event.preventDefault(); if (!busy) dropzone.classList.add('dragging'); });
  for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.remove('dragging'); });
  dropzone.addEventListener('drop', event => addFiles([...event.dataTransfer.files]));
}
$('tool-clear').onclick = () => {
  if (busy || (pendingResults() && !confirm('Clear these results? Download the files you need first.'))) return;
  files = []; clearResults(); renderFiles(); announce('Selection cleared.');
};
function updateQuality() {
  if ($('image-quality-value')) $('image-quality-value').textContent = `${$('image-quality').value}%`;
  const png = $('image-format').value === 'image/png';
  $('image-quality').disabled = busy || png;
  $('image-quality').setAttribute('aria-label', png ? 'Quality does not apply to PNG output' : 'Image quality');
}
$('image-quality').addEventListener('input', updateQuality);
$('image-format').addEventListener('change', updateQuality);
if ($('tool-download-all')) $('tool-download-all').onclick = async () => {
  if (busy || !results.length) return;
  if (results.reduce((sum, item) => sum + item.blob.size, 0) > 500 * 1024 ** 2) { announce('These results exceed the 500 MB ZIP limit. Download the files individually.'); return; }
  setBusy(true); announce('Preparing your ZIP download…');
  try {
    const { downloadZip } = await import('../shared/download-zip.mjs');
    await downloadZip(results, `Binary-Beat-${tool}.zip`);
    results.forEach(item => { item.downloaded = true; });
    announce('ZIP download started. Your individual downloads are still available below.');
  } catch (error) { announce(`Could not create ZIP: ${error.message}`); }
  finally { setBusy(false); }
};

async function processImage(file) {
  const output = await encodeImage(file, { mode: tool, width: Number($('image-width').value), height: Number($('image-height').value), type: $('image-format').value, quality: Number($('image-quality').value) / 100 });
  const dimensions = `${output.width} × ${output.height}`;
  if (tool === 'image-compress' && output.blob.size >= file.size) { addResult(file, file.name, `${dimensions} · Already compact — original kept`); return; }
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[output.blob.type];
  const suffix = tool === 'image' ? `${output.width}x${output.height}` : tool === 'image-compress' ? 'compressed' : 'converted';
  const saving = tool === 'image-compress' ? ` · ${Math.round((1 - output.blob.size / file.size) * 100)}% smaller` : '';
  addResult(output.blob, `${file.name.replace(/\.[^.]+$/, '')}-${suffix}.${extension}`, dimensions + saving);
}

$('tool-run').onclick = async () => {
  if (busy || !files.length) return;
  if (pendingResults() && !confirm('Replace these results? Download the files you need first.')) return;
  clearResults(); setBusy(true); updateProgress(0);
  let failed = 0;
  try {
    if (tool === 'merge') {
      announce('Merging your PDFs…');
      const { mergePDF } = await pdfTools();
      addResult(await mergePDF(await Promise.all(files.map(async file => new Uint8Array(await file.arrayBuffer())))), 'Binary-Beat-merged.pdf', `${files.length} PDFs combined`);
    } else if (tool === 'images-pdf') {
      const { imagesToPDF } = await pdfTools();
      const images = files.map((file, i) => async () => {
        announce(`Preparing image ${i + 1} of ${files.length}: ${files[i].name}`);
        await new Promise(resolve => setTimeout(resolve, 0));
        // Normalize orientation consistently and support WebP through the browser decoder.
        const type = imageType(file) === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        try {
          const encoded = await encodeImage(file, { mode: 'images-pdf', type, quality: 0.92 });
          return { bytes: new Uint8Array(await encoded.blob.arrayBuffer()), type };
        } catch (error) { throw Error(`${file.name}: ${error.message}`); }
      });
      const output = await imagesToPDF(images, { pageSize: $('pdf-page-size')?.value || 'a4', onProgress: (index, count) => { announce(`Creating PDF page ${index + 1} of ${count}…`); updateProgress((index + 1) / count * 100); } });
      addResult(output, 'Binary-Beat-images.pdf', `${files.length} ${files.length === 1 ? 'page' : 'pages'}`);
    } else {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]; announce(`Processing ${index + 1} of ${files.length}: ${file.name}`);
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
          if (isImageTool()) await processImage(file);
          else {
            const input = new Uint8Array(await file.arrayBuffer()), stem = file.name.replace(/\.pdf$/i, '');
            const library = await pdfTools();
            if (tool === 'split') {
              const parts = await library.splitPDF(input, $('pdf-ranges').value);
              parts.forEach((part, number) => addResult(part, `${stem}-part-${number + 1}.pdf`));
            } else if (tool === 'rotate') {
              const angle = Number($('pdf-rotation')?.value || 90);
              addResult(await library.rotatePDF(input, angle, $('pdf-rotate-ranges')?.value || ''), `${stem}-rotated.pdf`, `${angle}° clockwise`);
            } else {
              const output = $('pdf-compression').value === 'scan' ? await (await import('./pdf-scan.js')).scanCompress(input, announce) : await library.compressPDF(input);
              addResult(output, `${stem}-compressed.pdf`, output.length === input.length ? 'Already compact — original kept' : `${Math.round((1 - output.length / input.length) * 100)}% smaller`);
            }
          }
        } catch (error) {
          failed++;
          const message = document.createElement('p'); message.className = 'tool-error'; message.textContent = `${file.name}: ${error.message}`; $('tool-results').append(message);
        }
        updateProgress((index + 1) / files.length * 100);
      }
    }
    updateProgress(100);
    const total = results.reduce((sum, item) => sum + item.blob.size, 0);
    if ($('tool-result-summary')) $('tool-result-summary').textContent = results.length ? `${results.length} ${results.length === 1 ? 'file' : 'files'} ready · ${formatSize(total)}` : 'No files were created';
    announce(failed ? `${results.length} ${results.length === 1 ? 'result ready' : 'results ready'}, ${failed} ${failed === 1 ? 'file failed' : 'files failed'}. See details below.` : 'All done! Your files are ready to download. Originals are unchanged.');
  } catch (error) { announce(error.message); updateProgress(0, false); }
  finally { setBusy(false); }
};
window.addEventListener('beforeunload', event => { if (busy || pendingResults()) { event.preventDefault(); event.returnValue = ''; } });
