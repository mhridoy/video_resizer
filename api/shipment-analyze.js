import { timingSafeEqual } from 'node:crypto';
import { generateText, Output, jsonSchema } from 'ai';
import { DEFAULT_VISION_MODEL, MAX_AI_IMAGES, MAX_AI_BODY, SHIPMENT_INSTRUCTIONS, shipmentSchema, validateAIResult } from '../shared/shipment-ai.mjs';

const sameSecret = (a, b) => { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  const configured = Boolean((process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) && process.env.SHIPMENT_AI_ACCESS_TOKEN);
  if (req.method === 'GET') return reply(200, { available: configured, requiresAccessCode: true, model: process.env.SHIPMENT_AI_MODEL || DEFAULT_VISION_MODEL });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return reply(405, { error: 'Method not allowed.' }); }
  if (!configured) return reply(503, { error: 'AI is not configured yet. The app owner must enable the AI service.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!sameSecret(token, process.env.SHIPMENT_AI_ACCESS_TOKEN)) return reply(401, { error: 'Enter a valid AI access code.' });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 240_000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    let body = req.body;
    if (body === undefined) {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_AI_BODY) return reply(413, { error: 'Send fewer preview images at a time.' }); chunks.push(chunk); }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      if (Buffer.byteLength(body) > MAX_AI_BODY) return reply(413, { error: 'Preview request is too large.' });
      try { body = JSON.parse(body.toString()); } catch { return reply(400, { error: 'Invalid JSON.' }); }
    }
    if (!body || Buffer.byteLength(JSON.stringify(body)) > MAX_AI_BODY || !Array.isArray(body.images) || !body.images.length || body.images.length > MAX_AI_IMAGES) return reply(400, { error: 'Invalid image batch.' });
    const ids = new Set(), content = [];
    for (const image of body.images) {
      if (!image || !/^\d{1,12}$/.test(image.id) || ids.has(image.id) || typeof image.name !== 'string' || image.name.length > 240 || typeof image.data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length > 650_000) return reply(400, { error: 'Invalid preview image.' });
      const bytes = Buffer.from(image.data.split(',')[1], 'base64');
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return reply(400, { error: 'Preview must be JPEG.' });
      ids.add(image.id);
      content.push({ type: 'text', text: JSON.stringify({ id: image.id, filename: image.name }) }, { type: 'image', image: bytes, mediaType: 'image/jpeg' });
    }
    // No tools, URL fetches, image storage, payload logging or raw transcript upload.
    const { output } = await generateText({
      model: process.env.SHIPMENT_AI_MODEL || DEFAULT_VISION_MODEL,
      instructions: SHIPMENT_INSTRUCTIONS,
      messages: [{ role: 'user', content }],
      output: Output.object({ schema: jsonSchema(shipmentSchema) }),
      maxOutputTokens: 6500, maxRetries: 1, abortSignal: controller.signal,
    });
    validateAIResult(output, [...ids]);
    return reply(200, output);
  } catch (error) {
    if (res.writableEnded || res.destroyed) return;
    // Do not expose provider error bodies, request content or credentials to clients.
    return reply(controller.signal.aborted ? 504 : 502, { error: controller.signal.aborted ? 'AI analysis timed out. Try again.' : 'AI analysis could not finish. Check service availability or credits and retry.' });
  } finally { clearTimeout(timer); }
}
