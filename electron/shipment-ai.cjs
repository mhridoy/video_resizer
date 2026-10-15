// Only the trusted main process chooses the service URL. Provider credentials are
// never installed in the desktop renderer or distributed with the application.
let active;
async function shipmentAI(body, accessCode) {
  if (active) throw new Error('Wait for the current AI request.');
  const url = new URL(process.env.BINARY_BEAT_AI_URL || 'https://video-resizer-eta.vercel.app/api/shipment-analyze');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The AI service must use HTTPS.');
  const payload = body ? JSON.stringify(body) : undefined;
  if (payload && Buffer.byteLength(payload) > 3_700_000) throw new Error('AI preview batch is too large.');
  if (typeof accessCode !== 'string' || accessCode.length > 4096) throw new Error('Invalid access code.');
  const controller = new AbortController(); active = controller;
  const timer = setTimeout(() => controller.abort(), 250_000);
  try {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', body: payload,
      headers: body ? { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` } : {},
      signal: controller.signal, redirect: 'error',
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('AI service is unavailable.'); }
    if (!response.ok) throw new Error(result.error || 'AI service is unavailable.');
    return result;
  } finally { clearTimeout(timer); if (active === controller) active = undefined; }
}
function cancelShipmentAI() { active?.abort(); }
module.exports = { shipmentAI, cancelShipmentAI };
