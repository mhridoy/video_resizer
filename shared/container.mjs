// Shipping-container load documentation: container IDs, document categories, naming and email packs.
import { invoiceFilename } from './invoice-documents.mjs';
import { fileKind, extensionOf } from './fit-size.mjs';

export const CATEGORIES = [
  { id: 'photos', label: 'Load photos', folder: '01_Load_Photos', code: 'PHOTO' },
  { id: 'videos', label: 'Load videos', folder: '02_Load_Videos', code: 'VIDEO' },
  { id: 'closed', label: 'Closed container doors', code: 'CLOSED_DOORS' },
  { id: 'seals', label: 'Seal photos', code: 'SEAL' },
  { id: 'invoices', label: 'Invoices', folder: '03_Invoices', code: 'INVOICE' },
  { id: 'vat', label: 'VAT invoices (QR)', code: 'VAT' },
  { id: 'packing', label: 'Packing lists', code: 'PACKING_LIST' },
  { id: 'weight', label: 'Weight tickets', folder: '04_Weight_Tickets', code: 'WEIGHT' },
  { id: 'shipping', label: 'Shipping line documents', code: 'SHIPPING_DOC' },
  { id: 'documents', label: 'Other documents', folder: '05_Documents', code: 'DOC' },
];
export const categoryById = id => CATEGORIES.find(category => category.id === id) || CATEGORIES.at(-1);

const LETTER_VALUES = (() => {
  // ISO 6346 letter values skip multiples of 11.
  const values = {}; let value = 10;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (value % 11 === 0) value++; values[letter] = value++; }
  return values;
})();

export function checkDigit(code) {
  const text = String(code).toUpperCase();
  if (!/^[A-Z]{4}\d{6}$/.test(text)) return -1;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (i < 4 ? LETTER_VALUES[text[i]] : Number(text[i])) * 2 ** i;
  return sum % 11 % 10;
}

// Accepts "MSCU 123456-7", "mscu1234567" etc. Returns { id, valid } or null when it is not shaped like a container number.
export function parseContainer(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s\-_.\/]/g, '');
  const match = compact.match(/^([A-Z]{3}[UJZR])(\d{6})(\d)$/);
  if (!match) return null;
  const id = match[1] + match[2] + match[3];
  return { id, valid: checkDigit(match[1] + match[2]) === Number(match[3]) };
}

const CONTAINER_IN_TEXT = /(?:^|[^A-Z0-9])([A-Z]{3}[UJZR])[\s\-_.]?(\d{6})[\s\-_.]?(\d)(?![0-9])/gi;
// Finds a container number in a folder or file name. Prefers numbers whose check digit is valid.
export function detectContainer(path) {
  const found = [];
  for (const segment of String(path).split(/[\\/]/)) {
    for (const match of segment.matchAll(CONTAINER_IN_TEXT)) found.push(parseContainer(match[1] + match[2] + match[3]));
  }
  return found.find(item => item.valid) || found[0] || null;
}

const RULES = [
  ['weight', /weigh|weight|w[\s_-]?slip|scale|vgm|tare|gross|kanta|kata|bridge|ticket/i],
  ['invoice', /invoice|\binv[\s_\-.]?\d|\binv\b|commercial|proforma|\bpi[\s_-]?\d|bill(?![\s_-]*of[\s_-]*lading)|receipt|challan/i],
  ['documents', /packing|lading|\bb[\s_-]?l\b|\bbl[\s_-]?\d|booking|seal|\beir\b|certificate|\bcoo\b|customs|declaration|manifest/i],
];

// Suggests a category from the file name and type. Users can change it before processing.
export function categorize(path) {
  const name = String(path).split(/[\\/]/).pop();
  const kind = fileKind(name);
  if (kind !== 'video' && /pack(?:ing)?[\s_-]*list/i.test(name)) return 'packing';
  if (kind === 'image' && /\bseal\b/i.test(name.replace(/_/g, ' '))) return 'seals';
  for (const [id, pattern] of RULES) {
    // Photos of seals or bookings are still load photos; only scanned invoices/tickets change category.
    if (id === 'documents' && (kind === 'image' || kind === 'video')) continue;
    if (pattern.test(name) || pattern.test(path)) return id === 'invoice' ? 'invoices' : id;
  }
  if (kind === 'video') return 'videos';
  if (kind === 'image') return 'photos';
  return 'documents';
}

// All outputs live directly in the selected folder / ZIP root.
export function standardPath(container, categoryId, index, count, extension, originalName, rename = true, seal = '', stage = '', documentType = '', invoiceNumber = '', hasQrCode = false) {
  const invoiceName = rename && invoiceFilename(categoryId, invoiceNumber, hasQrCode, index, extension);
  if (invoiceName) return invoiceName;
  const category = categoryById(categoryId);
  const root = container || 'Unassigned';
  const width = Math.max(2, String(count).length);
  const prefix = seal ? `${root}_SEAL-${safeIdentifier(seal)}` : root;
  const code = categoryId === 'shipping' && SHIPPING_DOCUMENTS.some(type => type.id === documentType) ? documentType : stage !== '' && categoryId === 'photos' ? `LOADING_${stage}PCT` : category.code;
  return rename ? `${prefix}_${code}_${String(index).padStart(width, '0')}.${extension}` : originalName.split(/[\\/]/).pop();
}

export const SHIPPING_DOCUMENTS = [
  { id: 'SHIPPING_DOC', label: 'Shipping document (review type)' },
  { id: 'BOOKING_CONFIRMATION', label: 'Booking confirmation' },
  { id: 'CONTAINER_RELEASE_ORDER', label: 'Container release order' },
  { id: 'CONTAINER_PLACEMENT_ORDER', label: 'Container placement order' },
  { id: 'TERMINAL_HANDLING', label: 'Terminal handling document' },
  { id: 'DELIVERY_ORDER', label: 'Delivery order' },
  { id: 'BILL_OF_LADING', label: 'Bill of lading' },
  { id: 'EIR', label: 'Equipment interchange receipt' },
  { id: 'SHIPPING_INSTRUCTIONS', label: 'Shipping instructions' },
];

export const safeIdentifier = value => String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);

export function uniqueOutputName(name, used) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let result = name, number = 2;
  while (used.has(result.toLowerCase())) result = `${stem}_${number++}${ext}`;
  used.add(result.toLowerCase());
  return result;
}

// Splits files into email-sized parts. ZIP stores entries uncompressed, so size = data + headers.
// Shares one email's budget across its attachments: files smaller than an equal share keep
// their size and hand the surplus to the rest, so invoices and tickets stay readable while
// the heavy video absorbs the squeeze. (Max-min fair allocation.)
export function allocateBudget(sizes, budget, weights = []) {
  if (!Number.isFinite(budget) || budget <= 0) throw Error('Invalid email size limit.');
  const targets = new Array(sizes.length).fill(0);
  let remaining = budget;
  let left = sizes.map((size, index) => ({ index, size, weight: weights[index] > 0 ? weights[index] : 1 }));
  while (left.length) {
    const unit = remaining / left.reduce((sum, file) => sum + file.weight, 0);
    const fitting = left.filter(file => file.size <= unit * file.weight);
    if (!fitting.length) { for (const file of left) targets[file.index] = Math.floor(unit * file.weight); break; }
    for (const file of fitting) { targets[file.index] = file.size; remaining -= file.size; }
    left = left.filter(file => file.size > unit * file.weight);
  }
  return targets;
}

// A video needs far more bytes than a photo to stay watchable, so it draws a larger share.
export const SHARE_WEIGHT = { video: 6, image: 1, pdf: 1, doc: 1, other: 1 };
// Below this a photo stops being worth sending, so a very large set is split across emails.
export const MIN_SHARE = 220 * 1024;
export const filesPerEmail = budget => Math.max(1, Math.floor(budget / MIN_SHARE));

// First fit keeps the original order inside each part while using as few emails as possible.
export function packParts(files, limit, overhead = file => 76 + 2 * new TextEncoder().encode(file.name).length) {
  const parts = [];
  for (const file of files) {
    const cost = file.size + overhead(file);
    const part = parts.find(candidate => candidate.used + cost <= limit);
    if (part) { part.files.push(file); part.used += cost; } else parts.push({ files: [file], used: cost });
  }
  return parts.map(part => part.files);
}

const csvCell = value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
export function manifestCsv(rows) {
  const header = ['Container', 'Seal', 'Category', 'File', 'Original file', 'Original size (bytes)', 'Final size (bytes)', 'Processing'];
  return '﻿' + [header, ...rows.map(row => [row.container, row.seal || '', categoryById(row.category).label, row.path, row.original, row.originalSize, row.size, row.note])]
    .map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export { extensionOf };

// Entries to ignore when importing a ZIP: macOS resource forks, hidden files, and the
// transcript WhatsApp puts beside the media in a chat export.
export function importableFromZip(name) {
  if (!name || name.endsWith('/')) return false;
  const segments = String(name).split('/');
  if (segments.some(part => part.startsWith('.') || part === '__MACOSX')) return false;
  return !isChatTranscript(name);
}

export const isChatTranscript = name => /^(?:_chat|WhatsApp Chat(?: with| -)?.*)\.txt$/i.test(String(name).split('/').pop());
