import { invoiceEvidence } from './invoice-documents.mjs';
import { parseContainer, safeIdentifier } from './container.mjs';

// A seal is written many ways: "SEAL NO 0098812", "SEAL NO ML 0098812", "SEAL: ML-US 1234567".
// Take the words after the label while they still read as one number: a short owner prefix,
// then the serial. Stop at the first ordinary word so neighbouring text is never absorbed.
function labelledSeals(text) {
  const found = [];
  for (const label of text.matchAll(/\bSEAL(?:\s*(?:NUMBER|NO\.?|ID|#))?[\s:=-]+/g)) {
    let value = '';
    for (const word of text.slice(label.index + label[0].length).split(/\s+/)) {
      const cleaned = safeIdentifier(word).replace(/-/g, '');
      const hasDigit = /\d/.test(cleaned);
      if (!cleaned || (!hasDigit && (/\d/.test(value) || cleaned.length > 4))) break;
      // The serial ends the number: "ML0098812 O82" must not absorb the OCR noise after it.
      if (hasDigit && /\d{4}/.test(value)) break;
      value += cleaned;
      if (value.length > 24) { value = ''; break; }
    }
    if (/\d{4}/.test(value)) found.push(value);
  }
  return found;
}

// A trailer or chassis is identified the way a vehicle is: by a plate or a fleet number
// painted on it, usually next to a label ("TRAILER NO", "TRUCK NO" on a weight ticket).
// Take the words after the label while they read as one plate: up to three letter words
// (a state or city, "DHAKA METRO TA"), then the digits.
const TRAILER_LABEL = /\b(?:TRAILER|CHASSIS|TRUCK|LORRY|VEHICLE|PRIME\s*MOVER|PLATE|LICEN[CS]E\s*PLATE)(?:\s*(?:NUMBER|NO\.?|ID|#))?[\s:=-]+/g;
function labelledTrailers(text) {
  const found = [];
  for (const label of text.matchAll(TRAILER_LABEL)) {
    const words = [];
    for (const word of text.slice(label.index + label[0].length).split(/\s+/).slice(0, 5)) {
      const cleaned = safeIdentifier(word);
      if (!cleaned || cleaned.length > 10 || (!/\d/.test(cleaned) && (/\d/.test(words.join('')) || words.length > 2 || cleaned.length > (words.length ? 5 : 10)))) break;
      words.push(cleaned);
    }
    const joined = words.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const value = parseContainer(joined)?.id || joined;
    if (/\d{3}/.test(value.replace(/-/g, '')) && value.length >= 4 && value.length <= 24) found.push(value);
  }
  return found;
}

// Words printed on container doors and documents next to numbers; never a seal prefix.
const NOT_SEAL = new Set(['MAX', 'GROSS', 'TARE', 'NET', 'KG', 'KGS', 'LB', 'LBS', 'CAP', 'CUM', 'CUFT', 'PAYLOAD', 'TEL', 'MOB', 'FAX', 'PO', 'BOX', 'INV', 'NO', 'DATE', 'TIME', 'VAT', 'CR']);
/**
 * Serials read off a close-up of a seal ("AKS 48936", "ML-0098812"). Only for text read from a
 * cropped seal region, where a short letter prefix and a serial can mean nothing else.
 */
export function sealsFromCloseUp(input) {
  const text = String(input || '').toUpperCase();
  const found = new Map();
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])([A-Z]{2,5})[\s\-_.:]{0,2}(\d{5,10})(?![0-9])/g)) {
    if (NOT_SEAL.has(match[1]) || parseContainer(match[1] + match[2])) continue;
    const id = match[1] + match[2];
    found.set(id, { id, explicit: false });
  }
  return [...found.values()];
}

// Exported chat and OCR text are data only. Nothing in them is executed.
export function detectShipmentText(input, { hasQrCode = false } = {}) {
  const text = String(input || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').toUpperCase();
  const containers = new Map();
  const trailers = new Map();
  for (const match of text.matchAll(/\b([A-Z]{3}[UJZR])[\s._-]*(\d{3})[\s._-]*(\d{3})[\s._-]*(\d)\b/g)) {
    const container = parseContainer(match.slice(1).join(''));
    // ISO 6346 category Z is a chassis or trailer, not a container.
    if (match[1][3] === 'Z') trailers.set(container.id, { id: container.id, valid: container.valid });
    else containers.set(container.id, container);
  }
  for (const value of labelledTrailers(text)) if (!containers.has(value.replace(/-/g, ''))) trailers.set(value, { id: value });
  // The category letter is always U, J, Z or R; OCR often reads a U as Y, V or O. Accept the
  // correction only when the check digit then matches.
  for (const match of text.matchAll(/\b([A-Z]{3})[YVO0][\s._-]*(\d{3})[\s._-]*(\d{3})[\s._-]*(\d)\b/g)) {
    const candidate = parseContainer(`${match[1]}U${match[2]}${match[3]}${match[4]}`);
    if (candidate?.valid && !containers.has(candidate.id)) containers.set(candidate.id, { ...candidate, corrected: true });
  }
  // OCR sometimes splits a vertical stroke into an extra I. Only accept a unique
  // correction when the printed seven digits pass the ISO check digit.
  for (const match of text.matchAll(/\b([A-Z]{5})[\s|._-]*(\d{7})\b/g)) {
    const candidates = new Map();
    for (let i = 0; i < 5; i++) if (match[1][i] === 'I') {
      const candidate = parseContainer(match[1].slice(0, i) + match[1].slice(i + 1) + match[2]);
      if (candidate?.valid && candidate.id[3] !== 'Z') candidates.set(candidate.id, { ...candidate, corrected: true });
    }
    if (candidates.size === 1) for (const value of candidates.values()) containers.set(value.id, value);
  }
  // Container doors also say GROSS / TARE / NET. Those words alone are not a ticket.
  const weight = /\b(?:WEIGH\s*BRIDGE|WEIGHING|WEIGHT\s*(?:TICKET|SLIP)|TICKET\s*(?:ID|NO)|[12]\s*(?:ST|ND)\s+WEIGHT)\b/.test(text)
    || (/\bNET\s+WEIGHT\b/.test(text) && /\b(?:DATE|CUSTOMER|OPERATOR)\b/.test(text) && !/\b(?:INVOICE|PROFORMA|PACKING\s+LIST)\b/.test(text));
  const billing = invoiceEvidence(input, hasQrCode);
  const invoice = !weight && /\b(?:INVOICE|PROFORMA)\b/.test(text);
  const shippingRules = [
    ['CONTAINER_PLACEMENT_ORDER', /CONTAINER\s+PLACEMENT\s+ORDER/],
    ['CONTAINER_RELEASE_ORDER', /(?:CONTAINER|EMPTY|EQUIPMENT)\s+RELEASE|RELEASE\s+ORDER/],
    ['TERMINAL_HANDLING', /TERMINAL\s+HANDLING|TERMINAL\s+COMPANY/],
    ['BOOKING_CONFIRMATION', /BOOKING\s+(?:CONFIRMATION|CONFIRMED|NOTE)/],
    ['BILL_OF_LADING', /BILL\s+OF\s+LADING|SEA\s*WAYBILL/],
    ['DELIVERY_ORDER', /DELIVERY\s+ORDER/],
    ['EIR', /EQUIPMENT\s+INTERCHANGE|\bEIR\b/],
    ['SHIPPING_INSTRUCTIONS', /SHIPPING\s+INSTRUCTIONS/],
  ];
  const documentType = shippingRules.find(([, pattern]) => pattern.test(text))?.[0] || '';
  const seals = new Map();
  for (const value of labelledSeals(text)) seals.set(value, { id: value, explicit: true });
  // Bolt seals often carry only a serial, without the word "seal". Require a long
  // letter prefix and serial, and never interpret container IDs or document IDs as seals.
  if (!weight && !invoice && !billing.category && !documentType && text.length < 500) for (const match of text.matchAll(/\b([A-Z]{3,6}\d{6,10})\b/g)) {
    if (!containers.has(match[1]) && !parseContainer(match[1]) && ![...trailers.keys()].some(id => id.replace(/-/g, '') === match[1])) seals.set(match[1], { id: match[1], explicit: false });
  }
  return { ...billing, containers: [...containers.values()], seals: [...seals.values()], trailers: [...trailers.values()], documentType, category: weight ? 'weight' : documentType ? 'shipping' : billing.category || (invoice ? 'invoices' : seals.size ? 'seals' : null) };
}

// Only share a unique ID within this import's source (one ZIP or selected folder).
// Conflicting shipments stay separate and visible for review; never choose a majority.
export function resolveShipmentGroup(records, transcript = '') {
  const chat = detectShipmentText(transcript);
  const containers = new Map(chat.containers.map(value => [value.id, value]));
  const seals = new Map();
  const addSeal = value => {
    const old = seals.get(value.id) || { ...value, count: 0 };
    seals.set(value.id, { ...old, count: old.count + 1, explicit: old.explicit || value.explicit });
  };
  chat.seals.filter(value => value.explicit).forEach(addSeal);
  for (const record of records) {
    for (const value of record.evidence.containers) containers.set(value.id, value);
    record.evidence.seals.forEach(addSeal);
  }
  // One photo read TLLU2949292, another TLLU2949297: when a single number passes the check
  // digit, failing readings that differ from it in a character or two are the same box misread.
  const near = (a, b) => a.length === b.length && [...a].filter((char, i) => char !== b[i]).length <= 2;
  const checked = [...containers.values()].filter(value => value.valid);
  if (checked.length === 1) for (const value of [...containers.values()]) if (!value.valid && near(value.id, checked[0].id)) containers.delete(value.id);
  const valid = [...containers.values()].filter(value => value.valid);
  const trustedSeals = [...seals.values()].filter(value => value.explicit || value.count >= 2);
  const container = containers.size === 1 && valid.length === 1 ? valid[0] : null;
  const seal = seals.size === 1 && (trustedSeals.length === 1 || container) ? [...seals.keys()][0] : '';
  const conflict = containers.size > 1 || seals.size > 1;
  const trailers = new Set([...chat.trailers, ...records.flatMap(record => record.evidence.trailers || [])].map(value => value.id));
  const trailer = trailers.size === 1 ? [...trailers][0] : '';
  return records.map(record => {
    const own = record.evidence;
    return { ...record,
      container: own.containers.length === 1 && !(container && !own.containers[0].valid && near(own.containers[0].id, container.id)) ? own.containers[0] : container,
      seal: own.seals.length === 1 ? own.seals[0].id : conflict ? '' : seal,
      trailer: own.trailers?.length === 1 ? own.trailers[0].id : trailer,
      review: conflict ? 'Multiple container or seal numbers: check this file.' : own.containers.some(value => !value.valid && !(container && near(value.id, container.id))) ? 'Container check digit does not match.' : own.containers.some(value => value.corrected) ? 'OCR spelling corrected using check digit: verify number.' : (own.seals.some(value => !value.explicit) || (seal && ![...seals.values()][0]?.explicit)) ? 'Seal read from photo: verify the serial.' : '',
    };
  });
}
