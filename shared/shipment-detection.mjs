import { parseContainer, safeIdentifier } from './container.mjs';

// Exported chat and OCR text are data only. Nothing in them is executed.
export function detectShipmentText(input) {
  const text = String(input || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').toUpperCase();
  const containers = new Map();
  for (const match of text.matchAll(/\b([A-Z]{3}[UJZR])[\s._-]*(\d{3})[\s._-]*(\d{3})[\s._-]*(\d)\b/g)) {
    const container = parseContainer(match.slice(1).join(''));
    containers.set(container.id, container);
  }
  // OCR sometimes splits a vertical stroke into an extra I. Only accept a unique
  // correction when the printed seven digits pass the ISO check digit.
  for (const match of text.matchAll(/\b([A-Z]{5})[\s|._-]*(\d{7})\b/g)) {
    const candidates = new Map();
    for (let i = 0; i < 5; i++) if (match[1][i] === 'I') {
      const candidate = parseContainer(match[1].slice(0, i) + match[1].slice(i + 1) + match[2]);
      if (candidate?.valid) candidates.set(candidate.id, { ...candidate, corrected: true });
    }
    if (candidates.size === 1) for (const value of candidates.values()) containers.set(value.id, value);
  }
  // Container doors also say GROSS / TARE / NET. Those words alone are not a ticket.
  const weight = /\b(?:WEIGH\s*BRIDGE|WEIGHING|WEIGHT\s*(?:TICKET|SLIP)|TICKET\s*(?:ID|NO)|[12]\s*(?:ST|ND)\s+WEIGHT)\b/.test(text)
    || (/\bNET\s+WEIGHT\b/.test(text) && /\b(?:DATE|CUSTOMER|OPERATOR)\b/.test(text));
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
  for (const match of text.matchAll(/\bSEAL(?:\s*(?:NUMBER|NO\.?|ID|#))?[\s:=-]+([A-Z0-9-]{5,24})\b/g)) {
    if (/\d{4}/.test(match[1])) seals.set(safeIdentifier(match[1]), { id: safeIdentifier(match[1]), explicit: true });
  }
  // Bolt seals often carry only a serial, without the word "seal". Require a long
  // letter prefix and serial, and never interpret container IDs or document IDs as seals.
  if (!weight && !invoice && !documentType && text.length < 500) for (const match of text.matchAll(/\b([A-Z]{3,6}\d{6,10})\b/g)) {
    if (!containers.has(match[1]) && !parseContainer(match[1])) seals.set(match[1], { id: match[1], explicit: false });
  }
  return { containers: [...containers.values()], seals: [...seals.values()], documentType, category: weight ? 'weight' : documentType ? 'shipping' : invoice ? 'invoices' : seals.size ? 'seals' : null };
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
  const valid = [...containers.values()].filter(value => value.valid);
  const trustedSeals = [...seals.values()].filter(value => value.explicit || value.count >= 2);
  const container = containers.size === 1 && valid.length === 1 ? valid[0] : null;
  const seal = seals.size === 1 && (trustedSeals.length === 1 || container) ? [...seals.keys()][0] : '';
  const conflict = containers.size > 1 || seals.size > 1;
  return records.map(record => {
    const own = record.evidence;
    return { ...record,
      container: own.containers.length === 1 ? own.containers[0] : container,
      seal: own.seals.length === 1 ? own.seals[0].id : conflict ? '' : seal,
      review: conflict ? 'Multiple container or seal numbers: check this file.' : own.containers.some(value => !value.valid) ? 'Container check digit does not match.' : own.containers.some(value => value.corrected) ? 'OCR spelling corrected using check digit: verify number.' : (own.seals.some(value => !value.explicit) || (seal && ![...seals.values()][0]?.explicit)) ? 'Seal read from photo: verify the serial.' : '',
    };
  });
}
