import { mergePDF, splitPDF, compressPDF } from '../shared/pdf-tools.mjs';
const $ = id => document.getElementById(id);
const size = n => (n / 1024 / 1024).toFixed(2) + ' MB';
let files = [], urls = [], busy = false;
const names = { image: 'Image resize', merge: 'Merge PDFs', split: 'Split PDF', compress: 'Compress PDF' };
let tool = 'image';
function clearResults() { urls.forEach(URL.revokeObjectURL); urls = []; $('tool-results').replaceChildren(); }
function renderFiles() {
  $('tool-files').replaceChildren();
  files.forEach((file, index) => {
    const row = document.createElement('div'); row.className = 'tool-file';
    const name = document.createElement('span'); name.textContent = `${index + 1}. ${file.name} · ${size(file.size)}`; row.append(name);
    for (const [label, action] of [['↑', () => { if(index) [files[index-1], files[index]] = [files[index], files[index-1]]; }], ['Remove', () => files.splice(index, 1)]]) {
      const b = document.createElement('button'); b.className = 'secondary'; b.textContent = label; b.disabled = busy; b.setAttribute('aria-label', `${label === '↑' ? 'Move up' : 'Remove'} ${file.name}`); b.onclick = () => { action(); renderFiles(); }; row.append(b);
    }
    $('tool-files').append(row);
  });
  $('tool-run').disabled = busy || !files.length;
}
function setBusy(value) { busy = value; $('tools-panel').setAttribute('aria-busy', value); document.querySelectorAll('#tools-panel input, #tools-panel select, #tools-panel button, .tool-nav button').forEach(x => x.disabled = value); renderFiles(); }
function result(data, filename, note) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob); urls.push(url);
  const row = document.createElement('div'); row.className = 'tool-file';
  const label = document.createElement('span'); label.textContent = `${filename} · ${size(blob.size)}${note ? ' · ' + note : ''}`;
  const a = document.createElement('a'); a.href = url; a.download = filename; a.className = 'primary'; a.textContent = 'Download ↓'; row.append(label, a); $('tool-results').append(row);
}
for (const button of document.querySelectorAll('.tool-nav button')) button.onclick = () => {
  if (busy) return;
  const selected = button.dataset.tool;
  document.querySelectorAll('.tool-nav button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('video-panel').hidden = selected !== 'video'; $('tools-panel').hidden = selected === 'video';
  if (selected === 'video') return;
  if (tool !== selected) { files = []; clearResults(); }
  tool = selected; $('tool-title').textContent = names[tool]; $('tool-run').textContent = names[tool];
  $('image-settings').hidden = tool !== 'image'; $('split-settings').hidden = tool !== 'split'; $('compress-settings').hidden = tool !== 'compress';
  $('tool-input').accept = tool === 'image' ? 'image/jpeg,image/png,image/webp' : '.pdf,application/pdf';
  $('tool-input').multiple = ['image', 'merge', 'compress'].includes(tool);
  $('tool-help').textContent = tool === 'image' ? 'JPG, PNG and WebP. Keep proportions, resize a batch and choose your output format. JPG uses a white background for transparent pixels.' : tool === 'merge' ? 'PDFs merge in the order below. Use ↑ to reorder. Forms, bookmarks and digital signatures may not carry over; use ordinary document PDFs.' : tool === 'split' ? 'Leave ranges blank for one PDF per page. Or enter 1-3,5; 6-8 to create two files. Forms, bookmarks and digital signatures may not carry over.' : 'Lossless structural compression keeps page content unchanged. Scanned photos are not downsampled. Already optimized PDFs may stay the same size. Signed PDFs should not be processed.';
  $('tool-status').textContent = ''; renderFiles();
};
$('tool-input').onchange = e => {
  const picked = [...e.target.files]; e.target.value = '';
  if (tool === 'split') files = [];
  for (const file of picked) if (!files.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) files.push(file);
  renderFiles();
};
$('tool-clear').onclick = () => { if (urls.length && !confirm('Clear results? Download your files first.')) return; files=[]; clearResults(); renderFiles(); $('tool-status').textContent=''; };
$('tool-run').onclick = async () => {
  if (busy || !files.length) return;
  if (urls.length && !confirm('Replace previous results? Download them first.')) return;
  clearResults(); setBusy(true); let failed = 0;
  try {
    if (files.some(f => f.size > 200 * 1024 ** 2) || files.reduce((s,f)=>s+f.size,0)>500*1024**2) throw Error('Use files under 200 MB each and a batch under 500 MB.');
    if (tool === 'merge') {
      if (files.length < 2) throw Error('Choose at least two PDFs to merge.');
      $('tool-status').textContent = 'Merging PDFs…';
      result(await mergePDF(await Promise.all(files.map(async f => new Uint8Array(await f.arrayBuffer())))), 'Binary-Beat-merged.pdf');
    } else {
      for (let i=0;i<files.length;i++) {
        const file=files[i]; $('tool-status').textContent=`Processing ${i+1} / ${files.length}: ${file.name}`;
        await new Promise(r=>setTimeout(r,0));
        try {
          if(tool==='image') await resizeImage(file);
          else {
            const input=new Uint8Array(await file.arrayBuffer());
            if(tool==='split') {
              const parts=await splitPDF(input,$('pdf-ranges').value);
              parts.forEach((part,n)=>result(part,`${file.name.replace(/\.pdf$/i,'')}-part-${n+1}.pdf`));
            } else {
              const output=$('pdf-compression').value==='scan' ? await (await import('./pdf-scan.js')).scanCompress(input, message => $('tool-status').textContent=message) : await compressPDF(input);
              result(output,`${file.name.replace(/\.pdf$/i,'')}-compressed.pdf`,output.length===input.length?'Already compact — original retained':`${Math.round((1-output.length/input.length)*100)}% smaller`);
            }
          }
        } catch(error) { failed++; const p=document.createElement('p');p.textContent=`${file.name}: ${error.message}`; $('tool-results').append(p); }
      }
    }
    $('tool-status').textContent = failed ? `Finished with ${failed} failed file(s). Download completed results below.` : 'Done. Download your results below. Originals are unchanged.';
  } catch(error) { $('tool-status').textContent=error.message; }
  finally { setBusy(false); }
};
async function resizeImage(file) {
  const width=Number($('image-width').value), height=Number($('image-height').value);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192) throw Error('Width and height must be whole numbers between 1 and 8192.');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>80000000) throw Error('Image is too large. Use images below 80 megapixels.');
    const factor=Math.min(width/bitmap.width,height/bitmap.height,1);
    const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*factor)); canvas.height=Math.max(1,Math.round(bitmap.height*factor));
    const ctx=canvas.getContext('2d');const type=$('image-format').value;
    if(type==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(r=>canvas.toBlob(r,type,Number($('image-quality').value)/100));
    if(!blob)throw Error('Could not encode this image.');
    const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
    result(blob,`${file.name.replace(/\.[^.]+$/,'')}-${canvas.width}x${canvas.height}.${ext}`,`${canvas.width} × ${canvas.height}`);
    canvas.width=canvas.height=1;
  } finally { bitmap.close(); }
}
window.addEventListener('beforeunload', e=>{if(busy||urls.length){e.preventDefault();e.returnValue='';}});
