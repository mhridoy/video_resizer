// Pulls the few facts an email about a loaded container needs out of invoice and weight
// ticket text, and writes them as one line for the subject and a short block for the body.
// The text is OCR or PDF output: data only, never executed.

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

// `tonnes`: the figure is in MT, where "22.198" is a decimal, not twenty-two thousand.
function number(raw, tonnes = false) {
  // 24,500.50 · 24.500,50 · 24 500 · 24.500 (a thousands dot when three digits follow)
  let text = String(raw).replace(/\s/g, '');
  if (/,\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(text) && !(tonnes && /^\d{1,2}\.\d{3}$/.test(text))) text = text.replace(/\./g, '');
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const WEIGHT = /\b(NET|GROSS|G\.?\s?W\.?|N\.?\s?W\.?|TOTAL)?\s*(?:WEIGHT|WT\.?|WGT)?\s*(?:\(\s*(?:KGS?|MT|TONS?)\s*\))?\s*[:=-]?\s*(\d[\d.,\s]{0,12}\d|\d)\s*(KGS?|KILOS?|MT|M\.T\.|TONS?|TONNES?)\b/g;

function weights(text) {
  const found = [];
  for (const match of text.matchAll(WEIGHT)) {
    const unit = match[3];
    const value = number(match[2], !/^K/.test(unit));
    if (!value) continue;
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
  // "Container Ref.: 2ND" on the invoice: which container of the order this is.
  const nth = text.match(/\bCONTAINER\s*REF(?:ERENCE)?\.?\s*[:.]?\s*(\d{1,3})\s*(ST|ND|RD|TH)\b/);
  if (nth) fields.sequence = `${Number(nth[1])}${nth[2]}`;
  // The invoice's goods table: "DESCRIPTION  QUANTITY (MT) …" then "Brass Honey Scrap  22.198 …".
  // Its quantity is the weight billed, so it is preferred over a ticket's printed figure.
  const table = text.match(/\bQUANTITY\s*\((MT|KGS?|TONS?)\)[\s\S]{0,120}?\n?\s*([A-Z][A-Z &\/.,()-]{2,60}?)\s+(\d[\d,]*\.\d{1,3}|\d[\d,]*)(?=\s)/);
  if (table) {
    const value = number(table[3], !/^K/.test(table[1]));
    const material = clean(table[2].replace(/\b(?:RATE|TOTAL|USD|SAR|AMOUNT|UNIT|PRICE)\b.*$/, ''));
    if (material.length >= 3 && !/\(/.test(material)) fields.material = material;
    const quantityMt = value && (/^K/.test(table[1]) ? value / 1000 : value);
    if (quantityMt >= 0.05 && quantityMt <= 60) { fields.weightMt = Math.round(quantityMt * 1000) / 1000; fields.weightBasis = 'net'; return fields; }
  }
  const all = weights(text);
  const pick = all.find(value => value.basis === 'net') || all.find(value => value.basis === 'gross') || all[0];
  if (pick) { fields.weightMt = Math.round(pick.mt * 1000) / 1000; fields.weightBasis = pick.basis; }
  return fields;
}

const mt = value => `${value.toFixed(3)} MT`;

// "BRASS HONEY SCRAP" → "Brass Honey": the way the team writes the material in a subject.
const titleCase = value => value.toLowerCase().replace(/\b([a-z])/g, char => char.toUpperCase()).replace(/\b(Cu|Ss|Ms|Pvc)\b/g, word => word.toUpperCase());
export const materialName = value => titleCase(clean(value).replace(/\s+SCRAPS?$/i, ''));
// "TLLU2949292" → "TLLU 2949292", as the team writes it.
const spacedContainer = id => /^[A-Z]{4}\d{7}$/.test(id) ? `${id.slice(0, 4)} ${id.slice(4)}` : id;

/**
 * One shipment → { subject, body }. The subject follows the team's own emails:
 * "Brass Honey, TLLU 2949292, PC-1276, 2ND CNTR, AKS". Missing fields are left out, never guessed.
 */
export function shipmentSummary({ container, weightMt, weightBasis, seal, po, forwarder, trailer, material, sequence }) {
  const parts = [
    material && materialName(material),
    container && spacedContainer(container),
    po,
    sequence && `${sequence} CNTR`,
    forwarder,
  ].filter(Boolean);
  const body = [
    material && `Material: ${materialName(material)}`,
    container && `Container: ${spacedContainer(container)}`,
    sequence && `Container of order: ${sequence}`,
    weightMt && `Weight: ${mt(weightMt)}${weightBasis ? ` (${weightBasis})` : ''}`,
    seal && `Seal: ${seal}`,
    po && `PO number: ${po}`,
    forwarder && `Forwarder: ${forwarder}`,
    trailer && `Trailer: ${trailer}`,
  ].filter(Boolean);
  return { subject: parts.join(', '), body: body.join('\n') };
}
