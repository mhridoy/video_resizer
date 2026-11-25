import { invoiceEvidence } from './invoice-documents.mjs';
import { parseContainer, safeIdentifier, checkDigit } from './container.mjs';

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
// Seal makers' prefixes seen on this team's loads. A one-letter OCR slip in a known prefix
// ("SUAMM" for SDAMM) is put right; anything else is kept as read.
export const KNOWN_SEAL_PREFIXES = ['SADMM', 'SDAMM', 'AKS', 'ML', 'B'];
const DIGIT_LOOKALIKE = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', B: '8', A: '4', G: '6', T: '7' };
const oneSlip = (a, b) => a.length === b.length && [...a].filter((char, i) => char !== b[i]).length <= 1;

/** Normalised serials in text read off a seal close-up, one entry per reading (for voting). */
export function sealCandidates(input, known = KNOWN_SEAL_PREFIXES) {
  const found = [];
  // "AKS 48936": a short prefix printed apart from its serial belongs to it.
  const text = String(input || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\b([A-Z]{1,5}) (?=\d{4})/g, '$1');
  for (const token of text.split(' ')) {
    if (token.length < 6 || token.length > 15) continue;
    for (let cut = Math.min(5, token.length - 5); cut >= 1; cut--) {
      const prefix = token.slice(0, cut);
      if (!/^[A-Z]+$/.test(prefix)) continue;
      const digits = [...token.slice(cut)].map(char => DIGIT_LOOKALIKE[char] ?? char).join('');
      // Mostly real digits: "GLOBAL" must not become G-10841.
      if (!/^\d{5,10}$/.test(digits) || (token.slice(cut).match(/\d/g) || []).length < digits.length * 0.6) continue;
      if (NOT_SEAL.has(prefix) || parseContainer(prefix + digits)) break;
      const fixed = known.find(value => value === prefix) || known.find(value => value.length >= 3 && oneSlip(value, prefix)) || prefix;
      found.push(fixed + digits);
      break;
    }
  }
  return found;
}

/**
 * Serials read off a close-up of a seal ("AKS 48936", "ML-0098812"). Only for text read from a
 * cropped seal region, where a short letter prefix and a serial can mean nothing else.
 * Returns every distinct reading with its vote count; the import settles the serial across all
 * of a container's seal photos.
 */
export function sealsFromCloseUp(input, known = KNOWN_SEAL_PREFIXES) {
  const votes = new Map();
  for (const id of sealCandidates(input, known)) votes.set(id, (votes.get(id) || 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, explicit: false, votes: count, known: known.includes(id.match(/^[A-Z]+/)?.[0]) }));
}

/** Whether a photo's readings settle its serial on their own: two readings agree and lead. */
export const confirmedSeal = readings => readings.length > 0 && readings[0].votes >= 2 && !(readings[1]?.votes >= readings[0].votes);

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
  // The check digit is printed in a box on the door, and the box's edges make OCR misread it
  // ("TGBU 248128 7"), drop it, or add a digit ("ESDU70743840"). The other ten characters
  // decide the check digit, so recover it, but mark the result for confirmation.
  for (const match of text.matchAll(/\b([A-Z]{3}[UJRYVO])[\s._|-]*((?:\d[\s._|-]?){6,8})(?![\d])/g)) {
    const owner = match[1].slice(0, 3) + 'U'.repeat(/[YVO]/.test(match[1][3]) ? 1 : 0) + (/[YVO]/.test(match[1][3]) ? '' : match[1][3]);
    const digits = match[2].replace(/\D/g, '');
    const candidates = new Map();
    if (digits.length === 7 && parseContainer(owner + digits)?.valid) continue; // read correctly; handled above
    // Seven digits run together are printed that way (a document): a wrong check digit there is
    // a wrong number, not a misread box, so it is left for review.
    if (digits.length === 7 && !/\d[\s._|-]+\d$/.test(match[2].trim())) continue;
    const serials = digits.length === 6 ? [digits] : digits.length === 7 ? [digits.slice(0, 6)]
      : [...new Set([...digits].map((_, i) => (digits.slice(0, i) + digits.slice(i + 1)).slice(0, 7)))].filter(value => parseContainer(owner + value)?.valid).map(value => value.slice(0, 6));
    for (const serial of serials) {
      const check = checkDigit(owner + serial);
      if (check >= 0) candidates.set(owner + serial + check, { id: owner + serial + check, valid: true, corrected: true });
    }
    if (candidates.size !== 1) continue;
    const [value] = candidates.values();
    if (value.id[3] === 'Z') continue;
    // The misread original is the same box; keep only the recovered number.
    if (digits.length === 7) containers.delete(match[1] + digits);
    if (!containers.has(value.id)) containers.set(value.id, value);
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
  // The yard's own ticket forms: "SCRAP EVALUATION", "VECHILE NO." (sic), "DRIVER'S SIGN".
  const ticketForm = [/SCRAP\s*EVALUATION/, /VECHILE\s*NO/, /DRIVER'?S\s*SIGN/, /FOREMAN\s*SIGN/, /\b[12]\s*(?:ST|ND)\s*WE/, /NET\s*WE/].filter(pattern => pattern.test(text)).length >= 2;
  const weight = ticketForm || /\b(?:WEIGH\s*BRIDGE|WEIGHING|WEIGHT\s*(?:TICKET|SLIP)|TICKET\s*(?:ID|NO)|[12]\s*(?:ST|ND)\s+WEIGHT)\b/.test(text)
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
    seals.set(value.id, { ...old, count: old.count + (value.votes || 1), explicit: old.explicit || value.explicit, known: old.known || value.known });
  };
  chat.seals.filter(value => value.explicit).forEach(addSeal);
  for (const record of records) {
    for (const value of record.evidence.containers) containers.set(value.id, value);
    record.evidence.seals.forEach(addSeal);
  }
  // One photo read TLLU2949292, another TLLU2949297: when a single number passes the check
  // digit, failing readings that differ from it in a character or two are the same box misread.
  const near = (a, b) => a.length === b.length && [...a].filter((char, i) => char !== b[i]).length <= 2;
  // A number printed in a document or read cleanly outranks one whose check digit was recovered.
  const strong = [...containers.values()].filter(value => value.valid && !value.corrected);
  const checked = strong.length ? strong : [...containers.values()].filter(value => value.valid);
  const anchor = new Set(checked.map(value => value.id)).size === 1 ? checked[0] : null;
  if (anchor) for (const value of [...containers.values()]) if (value.id !== anchor.id && near(value.id, anchor.id)) containers.delete(value.id);
  const valid = [...containers.values()].filter(value => value.valid);
  const container = containers.size === 1 && valid.length === 1 ? valid[0] : null;
  // Seal photos are read many times over; the readings vote. Readings a few characters away
  // from the leader are the same engraving misread, not a second seal.
  const score = value => value.count + (value.explicit ? 2 : 0);
  const ranked = [...seals.values()].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const sameSeal = (a, b) => a.length === b.length && [...a].filter((char, i) => char !== b[i]).length <= 3;
  const top = ranked[0];
  const rival = top && ranked.slice(1).find(value => !sameSeal(value.id, top.id) && score(value) >= 2);
  const tied = top && ranked[1] && score(ranked[1]) === score(top);
  const seal = top && !rival && !tied && (top.explicit || score(top) >= 2 || (ranked.length === 1 && (top.known || container))) ? top.id : '';
  const conflict = containers.size > 1 || Boolean(rival && score(top) >= 2);
  const trailers = new Set([...chat.trailers, ...records.flatMap(record => record.evidence.trailers || [])].map(value => value.id));
  const trailer = trailers.size === 1 ? [...trailers][0] : '';
  return records.map(record => {
    const own = record.evidence;
    return { ...record,
      container: own.containers.length === 1 && !(container && own.containers[0].id !== container.id && near(own.containers[0].id, container.id)) ? own.containers[0] : container,
      seal: own.seals.length === 1 && own.seals[0].explicit ? own.seals[0].id : conflict ? '' : seal,
      trailer: own.trailers?.length === 1 ? own.trailers[0].id : trailer,
      review: conflict ? 'Multiple container or seal numbers: check this file.' : own.containers.some(value => !value.valid && !(container && near(value.id, container.id))) ? 'Container check digit does not match.' : own.containers.some(value => value.corrected) ? 'OCR spelling corrected using check digit: verify number.' : (seal && !top.explicit) ? 'Seal read from photo: verify the serial.' : '',
    };
  });
}
