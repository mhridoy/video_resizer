import { MAX_AI_IMAGES, MAX_AI_BODY, validateAIResult } from '../shared/shipment-ai.mjs';

async function request(body, accessCode, signal) {
  signal?.throwIfAborted();
  if (window.desktop?.shipmentAI) {
    const cancel = () => { window.desktop.cancelShipmentAI().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try { return await window.desktop.shipmentAI(body, accessCode); }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  const response = await fetch('/api/shipment-analyze', {
    method: body ? 'POST' : 'GET', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(250_000)]),
    headers: body ? { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let result;
  try { result = await response.json(); } catch { throw Error('AI service unavailable. Configure the app server or choose local mode.'); }
  if (!response.ok) throw Error(result.error || 'AI service unavailable.');
  return result;
}

export const shipmentAIStatus = () => request(null, '', AbortSignal.timeout(10_000));

async function preview(item) {
  const file = item.kind === 'pdf' ? await (await import('./shipment-pdf.js')).shipmentPdfPreview(item.file) : item.file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    for (const edge of [1600, 1200, 900]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', .8);
      if (data.length <= 600_000) return { id: String(item.id), name: item.file.name.slice(0, 240), data };
    }
    throw Error('Could not prepare an AI preview.');
  } finally { bitmap.close(); canvas.width = canvas.height = 1; }
}

export async function analyzeShipment(items, { accessCode, signal, status, onResult }) {
  const service = await request(null, '', signal);
  if (!service.available) throw Error('Pro AI needs server setup. Configure AI Gateway and the app access code, or turn off Pro AI for local mode.');
  if (service.requiresAccessCode && !accessCode) throw Error('Enter the AI access code supplied by the app owner, then click Prepare files.');
  const photos = items.filter(item => ['image', 'pdf'].includes(item.kind) && !item.ai);
  let batch = [], bytes = 20, completed = 0;
  const flush = async () => {
    if (!batch.length) return;
    signal.throwIfAborted();
    status(`Pro AI: analyzing ${completed + 1}–${completed + batch.length} of ${photos.length} images / PDFs…`);
    const output = await request({ images: batch }, accessCode, signal);
    signal.throwIfAborted();
    for (const result of validateAIResult(output, batch.map(image => image.id))) onResult(result);
    completed += batch.length; batch = []; bytes = 20;
  };
  for (const item of photos) {
    signal.throwIfAborted();
    let image;
    try { image = await preview(item); }
    catch { throw Error(`Cannot analyze ${item.file.name}. Export it as JPG or an unlocked PDF, or use local mode.`); }
    const size = new TextEncoder().encode(JSON.stringify(image)).length + 1;
    if (batch.length >= MAX_AI_IMAGES || bytes + size > MAX_AI_BODY - 1024) await flush();
    batch.push(image); bytes += size;
  }
  await flush();
}
