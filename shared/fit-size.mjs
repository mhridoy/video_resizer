// Planning helpers for "Fit to size": make every file in a folder fit under one size limit.
import { isVideo } from './options.mjs';

export const DEFAULT_LIMIT_MB = 24;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif']);
const DOC_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'docm', 'pptm', 'xlsm', 'odt', 'odp', 'ods']);
const SKIPPED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export const extensionOf = name => { const base = String(name).split(/[\\/]/).pop(); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''; };

export function fileKind(name) {
  const base = String(name).split(/[\\/]/).pop().toLowerCase();
  if (!base || SKIPPED_NAMES.has(base) || base.startsWith('._') || base.startsWith('~$')) return 'skip';
  const extension = extensionOf(base);
  if (isVideo(base)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (DOC_EXTENSIONS.has(extension)) return 'doc';
  return 'other';
}

export function limitBytes(megabytes) {
  const value = Number(megabytes);
  if (!Number.isFinite(value) || value < 1 || value > 2048) throw Error('Choose a size limit between 1 and 2048 MB.');
  return Math.floor(value * 1024 * 1024);
}

// Strip unsafe segments so outputs always stay inside the chosen destination.
export function safeRelativePath(name) {
  const segments = String(name).split(/[\\/]/).map(part => part.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()).filter(part => part && part !== '.' && part !== '..');
  return segments.length ? segments.join('/') : 'file';
}

export function replaceExtension(path, extension) {
  const slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.');
  return `${dot > slash + 1 ? path.slice(0, dot) : path}.${extension}`;
}

// Bitrate plan for one attempt. Each retry lowers the budget so the next encode lands below the limit.
export function videoPlan(durationSeconds, targetBytes, attempt = 0, { mute = false } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw Error('Could not read the video duration.');
  const margin = 0.9 * 0.85 ** attempt;
  const totalKbps = Math.floor(targetBytes * 8 * margin / durationSeconds / 1000);
  const audioKbps = mute || totalKbps < 120 ? 0 : totalKbps >= 1500 ? 128 : totalKbps >= 600 ? 96 : totalKbps >= 300 ? 64 : 32;
  const videoKbps = totalKbps - audioKbps;
  if (videoKbps < 60) throw Error(`This video is too long to fit under ${Math.round(targetBytes / 1024 ** 2)} MB with watchable quality.`);
  const maxEdge = videoKbps >= 4000 ? 1920 : videoKbps >= 1800 ? 1280 : videoKbps >= 800 ? 960 : videoKbps >= 350 ? 640 : 426;
  return { videoKbps, audioKbps, maxEdge };
}

export function videoArgs({ videoKbps, audioKbps, maxEdge }, encoder = 'libx264') {
  const filter = `scale=w='max(2,trunc(iw*sar*min(1,${maxEdge}/max(iw*sar,ih))/2)*2)':h='max(2,trunc(ih*min(1,${maxEdge}/max(iw*sar,ih))/2)*2)',setsar=1`;
  const rate = ['-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.3)}k`, '-bufsize', `${videoKbps * 2}k`];
  const codec = encoder === 'h264_videotoolbox' ? ['-c:v', encoder, ...rate, '-allow_sw', '1']
    : encoder === 'h264_nvenc' ? ['-c:v', encoder, '-preset', 'p4', '-rc', 'vbr', ...rate]
    : ['-c:v', 'libx264', '-preset', 'veryfast', ...rate];
  const audio = audioKbps ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2'] : ['-an'];
  return ['-map', '0:v:0', '-vf', filter, ...codec, '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', '-sn', '-dn'];
}

// Image attempts from gentle to aggressive: quality first, then dimensions.
export const IMAGE_STEPS = [
  { maxEdge: 8192, quality: 0.9 }, { maxEdge: 8192, quality: 0.8 }, { maxEdge: 6000, quality: 0.8 },
  { maxEdge: 4096, quality: 0.8 }, { maxEdge: 4096, quality: 0.7 }, { maxEdge: 3000, quality: 0.7 },
  { maxEdge: 2400, quality: 0.65 }, { maxEdge: 1920, quality: 0.6 }, { maxEdge: 1280, quality: 0.55 }, { maxEdge: 960, quality: 0.5 },
];

export function scaledSize(width, height, maxEdge) {
  const factor = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}
