// Invoice numbers are document references, never container IDs, tax IDs or dates.
export function safeInvoiceNumber(value) {
  return String(value || '').normalize('NFKC').replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 1776)).trim()
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
}
export function invoiceEvidence(input, hasQrCode = false) {
  const text = String(input || '').normalize('NFKC').replace(/[٠-٩]/g, n => String(n.charCodeAt(0)-1632)).replace(/[۰-۹]/g, n => String(n.charCodeAt(0)-1776));
  const packing = /\bpack(?:ing)?[\s_-]*list\b/i.test(text);
  const invoice = /\b(?:invoice|proforma|inv\.?)(?:\b|_)/i.test(text) || /فاتورة/.test(text);
  const numbers = [];
  for (const pattern of [
    /\b(?:invoice|inv\.?)\s*(?:(?:reference|ref\.?)\s*)?(?:no\.?|number|num\.?|#|id)\s*[:#=.-]?\s*([A-Z0-9][A-Z0-9\/_-]{0,79})/gi,
    /رقم\s*الفاتورة\s*[:#=.-]?\s*([A-Z0-9][A-Z0-9\/_-]{0,79})/gi,
    /\b(?:invoice|inv\.?)\s*[:#]\s*([A-Z0-9][A-Z0-9\/_-]{0,79})/gi,
    /\b(?:invoice|inv)[ _]+([A-Z]*\d[A-Z0-9\/_-]{0,79})(?![A-Z0-9])/gi,
  ]) for (const match of text.matchAll(pattern)) {
    if (/\d/.test(match[1]) && !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(match[1])) numbers.push(safeInvoiceNumber(match[1]));
  }
  const unique = [...new Set(numbers)];
  return { invoiceNumber: unique.length === 1 ? unique[0] : '', invoiceConflict: unique.length > 1,
    hasQrCode: Boolean(hasQrCode), category: packing ? 'packing' : invoice ? hasQrCode ? 'vat' : 'invoices' : null };
}
export function invoiceFilename(category, invoiceNumber, hasQrCode, index, extension) {
  if (!['invoices','vat','packing'].includes(category)) return null;
  const prefix = category === 'packing' ? 'Packing List Inv' : category === 'vat' || hasQrCode ? 'VAT' : 'Inv';
  const number = safeInvoiceNumber(invoiceNumber) || `Number unknown ${String(index).padStart(2, '0')}`;
  return `${prefix} ${number}.${extension}`;
}
