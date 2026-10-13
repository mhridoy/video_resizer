// Shrinks one file below a byte limit. Shared by the container pack and any future batch tools.
import { replaceExtension, videoPlan, videoArgs, IMAGE_STEPS, scaledSize, extensionOf } from '../shared/fit-size.mjs';

const native = window.desktop;
const DOC_STEPS = [{ maxEdge: 2400, quality: 0.8 }, { maxEdge: 1800, quality: 0.7 }, { maxEdge: 1400, quality: 0.6 }, { maxEdge: 1000, quality: 0.5 }, { maxEdge: 800, quality: 0.42 }];
const PDF_STEPS = [{ dpi: 110, quality: 0.7 }, { dpi: 90, quality: 0.6 }, { dpi: 72, quality: 0.5 }, { dpi: 60, quality: 0.4 }];
const MAX_WEB_VIDEO = 1024 ** 3;
let ffmpeg, ffmpegReady = false, loadController;
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

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

async function fitImage(item, target, job) {
  const bitmap = await decode(item.file);
  try {
    if (bitmap.width * bitmap.height > 120_000_000) throw Error('Image is above 120 megapixels.');
    // Photos become JPG. Transparent graphics become WebP (or PNG where WebP export is unavailable).
    const alpha = extensionOf(item.path) !== 'jpg' && extensionOf(item.path) !== 'jpeg' && hasTransparency(bitmap);
    const type = !alpha ? 'image/jpeg' : await canEncodeWebp() ? 'image/webp' : 'image/png';
    const extension = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[type];
    for (const [index, step] of IMAGE_STEPS.entries()) {
      job.check();
      job.progress((index + 1) / IMAGE_STEPS.length * 100);
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
async function fitPdf(item, target, job) {
  const input = new Uint8Array(await item.file.arrayBuffer());
  const { compressPDF } = await import('../shared/pdf-tools.mjs');
  try {
    const structural = await compressPDF(input);
    if (structural.length <= target) return { blob: new Blob([structural], { type: 'application/pdf' }), path: item.path, note: 'Structural compression · text kept' };
  } catch (error) { if (/encrypt|password/i.test(error.message)) throw Error('This PDF is password protected.'); }
  const { scanCompress } = await import('./pdf-scan.js');
  for (const [index, step] of PDF_STEPS.entries()) {
    job.check();
    const output = await scanCompress(input, message => { job.status(`${item.path}: ${message}`); }, { ...step, maxEdge: 2400 });
    job.check();
    job.progress((index + 1) / PDF_STEPS.length * 100);
    if (output.length <= target && output !== input) return { blob: new Blob([output], { type: 'application/pdf' }), path: item.path, note: `Image pages · ${step.dpi} DPI · text not selectable` };
  }
  throw Error('Could not get this PDF under the limit. Try splitting it first.');
}

// ---------- Office documents ----------
async function fitDoc(item, target, job) {
  const { shrinkOfficeFile } = await import('../shared/office-zip.mjs');
  const input = new Uint8Array(await item.file.arrayBuffer());
  for (const [index, step] of DOC_STEPS.entries()) {
    job.check();
    const blob = await shrinkOfficeFile(input, async (name, bytes) => {
      job.check();
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
    job.progress((index + 1) / DOC_STEPS.length * 100);
    if (blob.size <= target) return { blob: new Blob([blob], { type: item.file.type || 'application/octet-stream' }), path: item.path, note: `Pictures re-encoded · max ${step.maxEdge}px` };
    await yieldToBrowser();
  }
  throw Error('Could not get this document under the limit. Its text or embedded videos are too large.');
}

// ---------- Video ----------
async function browserEngine(job) {
  if (ffmpeg && ffmpegReady) return ffmpeg;
  job.status('Loading the video engine (about 32 MB). This happens once per session.');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  job.check();
  const engine = new FFmpeg(), controller = new AbortController();
  ffmpeg = engine; ffmpegReady = false; loadController = controller;
  let wasmURL;
  try {
    const base = new URL('./ffmpeg/', document.baseURI);
    const get = async url => { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw Error('Could not download the video engine. Check your connection and retry.'); return response; };
    const manifest = await (await get(new URL('core.json', base))).json();
    const parts = await Promise.all(manifest.chunks.map(async name => (await get(new URL(name, base))).arrayBuffer()));
    job.check();
    wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
    await engine.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL });
    job.check();
    ffmpegReady = true; return engine;
  } catch (error) {
    controller.abort(); engine.terminate();
    if (ffmpeg === engine) { ffmpeg = undefined; ffmpegReady = false; }
    throw error;
  } finally { if (wasmURL) URL.revokeObjectURL(wasmURL); if (loadController === controller) loadController = undefined; }
}

async function fitVideoNative(item, target, job) {
  const stop = native.onFitProgress(value => job.progress(value));
  try {
    const data = await native.fitVideo(item.file, target, job.mute);
    return { blob: new Blob([data], { type: 'video/mp4' }), path: replaceExtension(item.path, 'mp4'), note: 'MP4 · native engine' };
  } finally { stop(); }
}

async function fitVideoBrowser(item, target, job) {
  if (item.file.size > MAX_WEB_VIDEO) throw Error('Over the 1 GB browser limit. Use the desktop app for this video.');
  const engine = await browserEngine(job);
  const inputName = `input.${extensionOf(item.path) || 'mp4'}`;
  let log = '', duration = 0, attempt = 0;
  const logger = ({ message }) => {
    log = (log + '\n' + message).slice(-4000);
    const match = message.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  };
  const listener = ({ time }) => { if (duration && Number.isFinite(time)) job.progress(Math.min(99, (attempt + time / 1e6 / duration) / (attempt + 1) * 100)); };
  engine.on('log', logger); engine.on('progress', listener);
  try {
    await engine.writeFile(inputName, new Uint8Array(await item.file.arrayBuffer()));
    job.check();
    await engine.exec(['-hide_banner', '-i', inputName]); // Reads the duration; "no output" is expected.
    for (; attempt < 4; attempt++) {
      job.check();
      const plan = videoPlan(duration, target, attempt, { mute: job.mute });
      job.status(`${item.path}: encoding at ${plan.videoKbps} kbps, up to ${plan.maxEdge}px${attempt ? ` (attempt ${attempt + 1})` : ''}…`);
      const code = await engine.exec(['-hide_banner', '-y', '-i', inputName, ...videoArgs(plan), 'output.mp4']);
      job.check();
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

/**
 * item: { file: File, path, kind }. job: { check(), progress(percent), status(text), mute }.
 * Resolves { blob, path, note, kept? }; files already under the limit are returned unchanged.
 */
export async function shrinkFile(item, target, job) {
  if (item.file.size <= target && !(item.kind === 'video' && job.mute)) return { blob: item.file, path: item.path, kept: true, note: 'Already within limit' };
  if (item.kind === 'image') return fitImage(item, target, job);
  if (item.kind === 'pdf') return fitPdf(item, target, job);
  if (item.kind === 'doc') return fitDoc(item, target, job);
  if (item.kind === 'video') return native ? fitVideoNative(item, target, job) : fitVideoBrowser(item, target, job);
  throw Error('This file type cannot be reduced. Export it as PDF first.');
}

export async function cancelShrink() {
  if (native) await native.cancelFit();
  loadController?.abort();
  if (ffmpeg) { ffmpeg.terminate(); ffmpeg = undefined; ffmpegReady = false; }
}
