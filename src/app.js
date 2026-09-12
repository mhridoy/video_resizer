import './style.css';
import { icon, hydrateIcons } from './icons.js';
const $ = id => document.getElementById(id);
const tools = [
  { id: 'video-compress', name: 'Compress video', category: 'video', icon: 'compress', description: 'Less file size. More room for everything else.', badge: 'POPULAR' },
  { id: 'video', name: 'Resize video', category: 'video', icon: 'resize', description: 'Find the perfect size for every screen.' },
  { id: 'merge', name: 'Merge PDF', category: 'pdf', icon: 'merge', description: 'Bring your PDFs together in one tidy document.' },
  { id: 'compress', name: 'Compress PDF', category: 'pdf', icon: 'file', description: 'Lighter documents. Easier sharing.' },
  { id: 'image', name: 'Resize image', category: 'image', icon: 'image', description: 'Picture-perfect dimensions, in a single batch.' },
  { id: 'image-compress', name: 'Compress image', category: 'image', icon: 'compress', description: 'Make your JPGs and WebPs a little lighter.' },
  { id: 'image-convert', name: 'Convert image', category: 'image', icon: 'convert', description: 'JPG, PNG or WebP. A fresh format in seconds.' },
  { id: 'split', name: 'Split PDF', category: 'pdf', icon: 'split', description: 'Take the pages you need. Leave the rest.' },
  { id: 'video-trim', name: 'Trim video', category: 'video', icon: 'scissors', description: 'Keep the best part. Cut your clips to length.', badge: 'NEW' },
  { id: 'video-mute', name: 'Mute video', category: 'video', icon: 'mute', description: 'Let the picture do the talking. Remove audio.' },
  { id: 'rotate', name: 'Rotate PDF', category: 'pdf', icon: 'rotate', description: 'Turn those sideways pages the right way up.', badge: 'NEW' },
  { id: 'images-pdf', name: 'Images to PDF', category: 'pdf', icon: 'images-pdf', description: 'Turn your pictures into a share-ready PDF.', badge: 'NEW' }
];
let category = 'all', activeTool, videoModule, toolkitModule, navigationEpoch = 0;
const running = new Set();
const flash = message => { $('app-notice').textContent = message; $('app-notice').hidden = false; };
for (const kind of ['video', 'tool']) window.addEventListener(`${kind}-busy`, e => { if (e.detail) running.add(kind); else running.delete(kind); });
function renderTools() {
  const query = $('tool-search').value.trim().toLowerCase();
  const filtered = tools.filter(t => (category === 'all' || t.category === category) && `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(query));
  $('tool-grid').replaceChildren(...filtered.map(t => {
    const button = document.createElement('button'); button.className = `tool-card ${t.category}${t.id === 'video-compress' ? ' featured' : ''}`; button.dataset.tool = t.id;
    button.innerHTML = `<div class="card-top"><span class="tool-icon">${icon(t.icon)}</span>${t.badge ? `<span class="tool-badge ${t.badge === 'NEW' ? 'new' : ''}">${t.badge}</span>` : ''}</div><h3>${t.name}</h3><p>${t.description}</p><span class="card-arrow">${icon('arrow-up-right')}</span>`;
    button.onclick = () => navigate(t.id); return button;
  }));
  $('no-tools').hidden = filtered.length > 0;
  $('directory-title').textContent = category === 'all' ? 'A tool for every to-do' : `${category === 'pdf' ? 'PDF' : category[0].toUpperCase() + category.slice(1)} tools, made simple`;
  $('tool-match-count').textContent = query ? `${filtered.length} matching tool${filtered.length === 1 ? '' : 's'}` : `${filtered.length} handy tools, zero hassle`;
  document.querySelectorAll('[data-category]').forEach(el => { const selected = el.dataset.category === category; el.classList.toggle('active', selected); if (el.classList.contains('filter-tab')) el.setAttribute('aria-pressed', selected); });
}
function setAddress(id) { if (!window.desktop) history.replaceState(null, '', id ? `#${id}` : location.pathname + location.search); }
async function navigate(id, { address = true } = {}) {
  if (running.size) { flash('Your files are processing. Finish or cancel this batch before switching tools.'); if (!window.desktop) setAddress(activeTool?.id); return; }
  const token = ++navigationEpoch;
  const selected = tools.find(t => t.id === id);
  $('app-notice').hidden = true;
  if (!selected) { document.title = 'Binary Beat — A little less file hassle'; activeTool = undefined; $('home-panel').hidden = false; $('workspace-panel').hidden = true; if (address) setAddress(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  try {
    const video = selected.category === 'video';
    if (video) videoModule = await (videoModule || import('./main.js'));
    else toolkitModule = await (toolkitModule || import('./toolkit.js'));
    if (token !== navigationEpoch) return;
    if (video) { if (videoModule.activateVideoTool(selected.id) === false) return; }
    else if (toolkitModule.activateTool(selected.id) === false) return;
    activeTool = selected;
    $('home-panel').hidden = true; $('workspace-panel').hidden = false;
    $('video-panel').hidden = !video; $('tools-panel').hidden = video;
    $('workspace-title').textContent = selected.name; $('workspace-description').textContent = selected.description;
    $('workspace-category').textContent = `${selected.category.toUpperCase()} TOOLS`;
    $('workspace-icon').className = `tool-icon ${selected.category}`; $('workspace-icon').innerHTML = icon(selected.icon);
    document.title = `${selected.name} — Binary Beat`;
    if (address) setAddress(selected.id);
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('workspace-title').setAttribute('tabindex', '-1'); $('workspace-title').focus({ preventScroll: true });
  } catch (error) { flash(`Could not open this tool. Please refresh and try again. ${error.message}`); }
}
document.querySelectorAll('[data-home]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); navigate(); }));
document.querySelectorAll('[data-category]').forEach(el => el.onclick = () => { if (running.size) { flash('Finish or cancel the current batch before switching tools.'); return; } category = el.dataset.category; $('tool-search').value = ''; navigate(); renderTools(); });
$('tool-search').oninput = renderTools;
$('reset-search').onclick = () => { category = 'all'; $('tool-search').value = ''; renderTools(); };
document.addEventListener('keydown', e => { if (e.key === '/' && !$('home-panel').hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('tool-search').focus(); } });
window.addEventListener('hashchange', () => { if (!window.desktop) navigate(location.hash.slice(1), { address: false }); });
if (window.desktop) { $('download-windows').hidden = true; $('mode').textContent = 'Desktop edition'; document.querySelector('.desktop-banner').hidden = true; }
document.querySelector('.skip-link').addEventListener('click', e => { e.preventDefault(); $('main-content').setAttribute('tabindex', '-1'); $('main-content').focus(); });
hydrateIcons(); renderTools();
if (!window.desktop && location.hash) navigate(location.hash.slice(1), { address: false });
