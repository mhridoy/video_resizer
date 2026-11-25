// Pulls the few facts an email about a loaded container needs out of invoice and weight
// ticket text, and writes them as one line for the subject and a short block for the body.
// The text is OCR or PDF output: data only, never executed.
import { readTicket } from './weight-ticket.mjs';

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

// A weighbridge ticket prints the first and second weighings too, and a container door its
// maximum, tare and payload. None of them is the load's weight.
const NOT_LOAD = /(?:\b1\s*ST|\b2\s*ND|\bFIRST|\bSECOND|\bMAX\.?|\bTARE|\bPAYLOAD|\bCAP\.?)[\s.:]*(?:GROSS|WEIGHT|WT\.?)?[\s.:]*$/;

function weights(text) {
  const found = [];
  let handwritten = false;
  for (const match of text.matchAll(WEIGHT)) {
    if (NOT_LOAD.test(text.slice(Math.max(0, match.index - 14), match.index + match[0].indexOf(match[2])))) continue;
    const unit = match[3];
    let value = number(match[2], !/^K/.test(unit));
    if (!value) continue;
    // The bags' weight is often written off by hand under the net weight:
    // "NET WEIGHT : 24830 Kg  23 bags x2 = (-) 46  = 24784". Take the corrected figure.
    if (/^K/.test(unit) && /NET/.test(match[1] || '')) {
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 160);
      const written = [...after.matchAll(/=\s*(\d{4,6})(?!\d)/g)].map(m => Number(m[1])).find(kg => kg < value && kg > value * 0.95);
      if (written) { value = written; handwritten = true; }
    }
    const mt = /^K/.test(unit) ? value / 1000 : value;
    if (mt < 0.05 || mt > 60) continue; // not a container load
    const label = (match[1] || '').replace(/[\s.]/g, '');
    found.push({ mt, basis: /^(NET|NW)$/.test(label) ? 'net' : /^(GROSS|GW)$/.test(label) ? 'gross' : '', handwritten });
    handwritten = false;
  }
  return found;
}

export function extractShipmentFields(input) {
  const text = String(input || '').normalize('NFKC').toUpperCase();
  const lines = text.split(/\r?\n/);
  const fields = {};
  // "P.O. Number: AP26/V00129/016" — never the "P.O BOX-1735" of an address beside it.
  for (const po of text.matchAll(/\b(?:P\.?\s?O\.?|PURCHASE\s+ORDER)(?!\s*BOX)\s*(?:NO\.?|NUMBER|NUM\.?|#)?\s*[:#=.-]?\s*([A-Z0-9][A-Z0-9\/-]{2,30})/g)) {
    if (/\d/.test(po[1]) && !/^BOX/.test(po[1])) { fields.po = po[1]; break; }
  }
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
  // The quantity has decimals ("20.900"); a grade in the name ("Aluminum 6061 Scrap") does not.
  const table = text.match(/\bQUANTITY\s*\((MT|KGS?|TONS?)\)[\s\S]{0,120}?\n?\s*([A-Z][A-Z0-9 &\/.,()-]{2,60}?)\s+(\d{1,3}(?:,\d{3})*\.\d{1,3}|\d{4,6}(?=\s+KG))(?=\s)/);
  // The goods' name follows the table header and, on this team's invoices, ends in "Scrap";
  // read it on its own, as some layouts put LME columns before the quantity.
  const goods = text.match(/\bTOTAL\s*\((?:SAR|USD)\)\s+(?!TOTAL)([A-Z][A-Z0-9 &\/.-]{2,60}?\bSCRAPS?)\b/);
  if (goods) fields.material = clean(goods[1]);
  if (table) {
    const value = number(table[3], !/^K/.test(table[1]));
    // On one line the rest of the header ("RATE (SAR) TOTAL (USD) …") comes first: keep what follows it.
    const material = clean(table[2].split(/\)\s*/).pop().replace(/\b(?:RATE|TOTAL|USD|SAR|AMOUNT|UNIT|PRICE)\b.*$/, ''));
    if (!fields.material && material.length >= 3 && !/\(/.test(material)) fields.material = material;
    const quantityMt = value && (/^K/.test(table[1]) ? value / 1000 : value);
    if (quantityMt >= 0.05 && quantityMt <= 60) { fields.weightMt = Math.round(quantityMt * 1000) / 1000; fields.weightBasis = 'net'; return fields; }
  }
  // A weighbridge ticket: its weighings must add up, and a total written by hand under the
  // net (bags deducted, a truck head added) is the load's weight.
  const ticket = readTicket(text);
  if (ticket && (ticket.printedConfirmed || (ticket.first && ticket.second))) {
    fields.weightMt = Math.round(ticket.final) / 1000;
    fields.weightBasis = 'net';
    fields.ticket = ticket;
    if (ticket.handwritten) fields.weightHandwritten = true;
    // Read by hand but not cross-checked, or written there and not read at all: ask.
    if ((ticket.handwritten && !ticket.handwrittenConfirmed) || ticket.handwrittenUnread || !ticket.printedConfirmed) fields.weightCheck = true;
    if (ticket.head) fields.headTicket = true;
    return fields;
  }
  const all = weights(text);
  const pick = all.find(value => value.basis === 'net') || all.find(value => value.basis === 'gross') || all[0];
  if (pick) { fields.weightMt = Math.round(pick.mt * 1000) / 1000; fields.weightBasis = pick.basis; if (pick.handwritten) fields.weightHandwritten = true; }
  return fields;
}

const mt = value => `${value.toFixed(3)} MT`;

// "BRASS HONEY SCRAP" → "Brass Honey": the way the team writes the material in a subject.
const titleCase = value => value.toLowerCase().replace(/\b([a-z])/g, char => char.toUpperCase()).replace(/\b(Cu|Ss|Ms|Pvc)\b/g, word => word.toUpperCase());
// The team's shorthand: "Aluminum 6061" → "Alu 6061", "Copper Birch Cliff" → "CU Birch Cliff".
export const materialName = value => titleCase(clean(value).replace(/\s+SCRAPS?$/i, ''))
  .replace(/^A?LUMIN(?:I|)UM\b/i, 'Alu').replace(/^Copper\b/i, 'CU');
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
