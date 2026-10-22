// Pulls the few facts an email about a loaded container needs out of invoice and weight
// ticket text, and writes them as one line for the subject and a short block for the body.
// The text is OCR or PDF output: data only, never executed.

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function number(raw) {
  // 24,500.50 · 24.500,50 · 24 500 · 24.500 (a thousands dot when three digits follow)
  let text = String(raw).replace(/\s/g, '');
  if (/,\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const WEIGHT = /\b(NET|GROSS|G\.?\s?W\.?|N\.?\s?W\.?|TOTAL)?\s*(?:WEIGHT|WT\.?|WGT)?\s*(?:\(\s*(?:KGS?|MT|TONS?)\s*\))?\s*[:=-]?\s*(\d[\d.,\s]{0,12}\d|\d)\s*(KGS?|KILOS?|MT|M\.T\.|TONS?|TONNES?)\b/g;

function weights(text) {
  const found = [];
  for (const match of text.matchAll(WEIGHT)) {
    const value = number(match[2]);
    if (!value) continue;
    const unit = match[3];
    const mt = /^K/.test(unit) ? value / 1000 : value;
    if (mt < 0.05 || mt > 60) continue; // not a container load
    const label = (match[1] || '').replace(/[\s.]/g, '');
    found.push({ mt, basis: /^(NET|NW)$/.test(label) ? 'net' : /^(GROSS|GW)$/.test(label) ? 'gross' : '' });
  }
  return found;
}

export function extractShipmentFields(input) {
  const text = String(input || '').normalize('NFKC').toUpperCase();
  const lines = text.split(/\r?\n/);
  const fields = {};
  const po = text.match(/\b(?:P\.?\s?O\.?|PURCHASE\s+ORDER)\s*(?:NO\.?|NUMBER|NUM\.?|#)?\s*[:#=.-]?\s*([A-Z0-9][A-Z0-9\/-]{2,30})/);
  if (po && /\d/.test(po[1])) fields.po = po[1];
  for (const line of lines) {
    const match = line.match(/\b(?:FREIGHT\s+)?(?:FORWARDER|FORWARDING\s+AGENT|FWDR)\s*(?:NAME)?\s*[:=-]?\s*(.+)/);
    if (!match) continue;
    // Stop at the next label on the same line ("... LTD   PO NO 123").
    const name = clean(match[1].split(/\s{2,}|\b(?:P\.?O\.?|INVOICE|DATE|SEAL|CONTAINER|CNTR|WEIGHT|TEL|PHONE|ADDRESS)\b/)[0]).replace(/[^A-Z0-9 &.,'()-]/g, '').replace(/[ ,.-]+$/, '');
    if (name.length >= 3) { fields.forwarder = name.slice(0, 60); break; }
  }
  const all = weights(text);
  const pick = all.find(value => value.basis === 'net') || all.find(value => value.basis === 'gross') || all[0];
  if (pick) { fields.weightMt = Math.round(pick.mt * 1000) / 1000; fields.weightBasis = pick.basis; }
  return fields;
}

const mt = value => `${value.toFixed(3)} MT`;

/** One shipment → { subject, body }. Missing fields are left out rather than guessed. */
export function shipmentSummary({ container, weightMt, weightBasis, seal, po, forwarder, trailer }) {
  const parts = [
    container && `CNTR ${container}`,
    weightMt && `WT ${mt(weightMt)}${weightBasis ? ` ${weightBasis.toUpperCase()}` : ''}`,
    seal && `SEAL ${seal}`,
    po && `PO ${po}`,
    forwarder && `FWD ${forwarder}`,
  ].filter(Boolean);
  const body = [
    container && `Container: ${container}`,
    weightMt && `Weight: ${mt(weightMt)}${weightBasis ? ` (${weightBasis})` : ''}`,
    seal && `Seal: ${seal}`,
    po && `PO number: ${po}`,
    forwarder && `Forwarder: ${forwarder}`,
    trailer && `Trailer: ${trailer}`,
  ].filter(Boolean);
  return { subject: parts.join(' | '), body: body.join('\n') };
}
