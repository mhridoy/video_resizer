import './style.css';
import { icon, hydrateIcons } from './icons.js';
const $ = id => document.getElementById(id);
const tools = [
  { id: 'container', name: 'Container Load Pack', category: 'logistics', icon: 'container', description: 'Load photos, videos, invoices and weight tickets, each under 24 MB, named and grouped by container.', badge: 'Featured' },
  { id: 'video-compress', name: 'Compress video', category: 'video', icon: 'compress', description: 'Reduce file size with a balanced H.264 profile.' },
  { id: 'video', name: 'Resize video', category: 'video', icon: 'resize', description: 'Scale to 1080p, 720p or 480p while keeping proportions.' },
  { id: 'video-trim', name: 'Trim video', category: 'video', icon: 'scissors', description: 'Cut clips to a start and end time.' },
  { id: 'video-mute', name: 'Remove audio', category: 'video', icon: 'mute', description: 'Strip the audio track from videos.' },
  { id: 'image', name: 'Resize image', category: 'image', icon: 'image', description: 'Fit images within maximum dimensions.' },
  { id: 'image-compress', name: 'Compress image', category: 'image', icon: 'compress', description: 'Reduce JPG and WebP file size at the same dimensions.' },
  { id: 'image-convert', name: 'Convert image', category: 'image', icon: 'convert', description: 'Convert between JPG, PNG and WebP.' },
  { id: 'merge', name: 'Merge PDF', category: 'pdf', icon: 'merge', description: 'Combine several PDFs into one document.' },
  { id: 'compress', name: 'Compress PDF', category: 'pdf', icon: 'file', description: 'Lossless or image-based PDF compression.' },
  { id: 'split', name: 'Split PDF', category: 'pdf', icon: 'split', description: 'Extract page ranges or split every page.' },
  { id: 'rotate', name: 'Rotate PDF', category: 'pdf', icon: 'rotate', description: 'Rotate all or selected pages.' },
  { id: 'images-pdf', name: 'Images to PDF', category: 'pdf', icon: 'images-pdf', description: 'Create one PDF from a set of images.' }
];
const CATEGORY_TITLES = { all: 'All tools', logistics: 'Container pack', video: 'Video tools', image: 'Image tools', pdf: 'PDF tools' };
let category = 'all', activeTool, videoModule, toolkitModule, containerModule, navigationEpoch = 0;
const running = new Set();
const flash = message => { $('app-notice').textContent = message; $('app-notice').hidden = false; };
for (const kind of ['video', 'tool', 'container']) window.addEventListener(`${kind}-busy`, e => { if (e.detail) running.add(kind); else running.delete(kind); });
function renderTools() {
  const query = $('tool-search').value.trim().toLowerCase();
  const filtered = tools.filter(t => (category === 'all' || t.category === category) && `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(query));
  $('tool-grid').replaceChildren(...filtered.map(t => {
    const button = document.createElement('button'); button.className = `tool-card ${t.category}${t.badge ? ' featured' : ''}`; button.dataset.tool = t.id;
    button.innerHTML = `<div class="card-top"><span class="tool-icon">${icon(t.icon)}</span>${t.badge ? `<span class="tool-badge">${t.badge}</span>` : ''}</div><h3>${t.name}</h3><p>${t.description}</p><span class="card-arrow">${icon('arrow-up-right')}</span>`;
    button.onclick = () => navigate(t.id); return button;
  }));
  $('no-tools').hidden = filtered.length > 0;
  $('directory-title').textContent = CATEGORY_TITLES[category];
  $('tool-match-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'tool' : 'tools'}`;
  document.querySelectorAll('[data-category]').forEach(el => { const selected = el.dataset.category === category; el.classList.toggle('active', selected); if (el.classList.contains('filter-tab')) el.setAttribute('aria-pressed', selected); });
}
function setAddress(id) { if (!window.desktop) history.replaceState(null, '', id ? `#${id}` : location.pathname + location.search); }
async function navigate(id, { address = true } = {}) {
  if (running.size) { flash('Your files are processing. Finish or cancel this batch before switching tools.'); if (!window.desktop) setAddress(activeTool?.id); return; }
  const token = ++navigationEpoch;
  const selected = tools.find(t => t.id === id);
  $('app-notice').hidden = true;
  if (!selected) { document.title = 'Binary Beat — File preparation, done locally'; activeTool = undefined; $('home-panel').hidden = false; $('workspace-panel').hidden = true; if (address) setAddress(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  try {
    const video = selected.category === 'video', fit = selected.category === 'logistics';
    if (video) videoModule = await (videoModule || import('./main.js'));
    else if (fit) containerModule = await (containerModule || import('./container.js'));
    else toolkitModule = await (toolkitModule || import('./toolkit.js'));
    if (token !== navigationEpoch) return;
    if (video) { if (videoModule.activateVideoTool(selected.id) === false) return; }
    else if (fit) containerModule.activateContainerTool();
    else if (toolkitModule.activateTool(selected.id) === false) return;
    activeTool = selected;
    $('home-panel').hidden = true; $('workspace-panel').hidden = false;
    $('video-panel').hidden = !video; $('tools-panel').hidden = video || fit; $('container-panel').hidden = !fit;
    $('workspace-title').textContent = selected.name; $('workspace-description').textContent = selected.description;
    $('workspace-category').textContent = fit ? 'Logistics' : CATEGORY_TITLES[selected.category];
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
document.querySelectorAll('[data-open-tool]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.openTool)));
$('reset-search').onclick = () => { category = 'all'; $('tool-search').value = ''; renderTools(); };
document.addEventListener('keydown', e => { if (e.key === '/' && !$('home-panel').hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('tool-search').focus(); } });
window.addEventListener('hashchange', () => { if (!window.desktop) navigate(location.hash.slice(1), { address: false }); });
// Offer the right installer for the visitor's computer.
if (!window.desktop && /Mac/i.test(navigator.platform || navigator.userAgent)) {
  const link = $('download-windows'), mac = arch => { link.href = `https://github.com/mhridoy/video_resizer/releases/latest/download/Binary-Beat-macOS-${arch}.dmg`; };
  mac('arm64');
  navigator.userAgentData?.getHighEntropyValues?.(['architecture']).then(({ architecture }) => { if (architecture === 'x86') mac('x64'); }).catch(() => {});
}
if (window.desktop) { $('download-windows').hidden = true; $('mode').textContent = 'Desktop edition'; document.querySelector('.desktop-banner').hidden = true; }
document.querySelector('.skip-link').addEventListener('click', e => { e.preventDefault(); $('main-content').setAttribute('tabindex', '-1'); $('main-content').focus(); });
hydrateIcons(); renderTools();
if (!window.desktop && location.hash) navigate(location.hash.slice(1), { address: false });
