// Reads a weighbridge ticket: the yard's printed 1st / 2nd / net weighings and the figure
// written by hand under them when bags are deducted or a truck head's weight is added
// ("NET WEIGHT : 22990 Kg  (-) 24 kg  = 22966 kg").
//
// OCR of a phone photo misreads a digit here and there, so nothing is taken on one reading:
// the printed weighings must agree with each other (net = 2nd − 1st, less a printed deduction),
// and a handwritten total must agree with the printed net and, where it was read, with the
// amount written beside it. What cannot be confirmed is reported, not guessed.
// Pure functions on OCR text, so they run the same in the browser and in tests.
import { parseContainer, checkDigit } from './container.mjs';

const FIRST = /(?:\b1|\bI|\b[|l])\s*[S8$]\s*T\s*W\s*E\s*[I1l]?\s*[GC]/g;
const SECOND = /\b2\s*N\s*D\s*W\s*E\s*[I1l]?\s*[GC]/g;
const NET = /(?:\bN|\b)E\s*T\s*W\s*E\s*[I1l]?\s*[GC]\s*H?\s*T?/g;
const DEDUCTION = /\bDEDUCTION\b/g;
const END = /\bDRI|DRIER|OPERATOR|PERATOR|FOREMAN|SIGN|R'S\b|\bMOB|SUPERINTENDENT|CASHIER/;
// The scanner's close reading of the ticket's right-hand column (see shipment-ocr.js).
const COLUMN_PASS = '--- TICKET COLUMN ---';

// Digits of the first figure after a label: "1STWEIGHT : 18370 Kg", ":14480", "1 37100" (a
// colon read as 1), "19960.00 kg". Returns the readings it could be, most likely first.
function figureAfter(text, index) {
  const window = text.slice(index, index + 40);
  const match = window.match(/^[^\d]{0,14}?([:;.]?\s*)(\d[\d,]{0,7})(?:\.\d{1,2})?/);
  if (!match) return [];
  const digits = match[2].replace(/,/g, '');
  const readings = [];
  if (digits.length >= 1 && digits.length <= 5) readings.push(Number(digits));
  // A colon read as "1" ("1 37100", "121540"): drop it.
  if (/^1\d{4,5}$/.test(digits)) readings.push(Number(digits.slice(1)));
  if (digits.length === 6 && !/^1/.test(digits)) readings.push(Number(digits.slice(0, 5)));
  return readings.filter(value => value > 0 && value < 80000);
}

function labelled(text, pattern) {
  const values = [];
  for (const match of text.matchAll(pattern)) {
    // Not the "1ST WEIGHT" inside "2ND WEIGHT" etc.: the label must end where the figure starts.
    values.push(...figureAfter(text, match.index + match[0].length).map((value, rank) => ({ value, rank, at: match.index })));
  }
  return values;
}

const tally = list => {
  const counts = new Map();
  for (const { value, rank } of list) counts.set(value, (counts.get(value) || 0) + (rank ? 0.5 : 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

/**
 * The printed weighings. Returns { first, second, net, deduction, confirmed } where confirmed
 * means the three figures agree (net = |2nd − 1st| − deduction), or null when no net is printed.
 */
export function printedWeights(input) {
  const text = String(input || '').normalize('NFKC').toUpperCase();
  const firsts = tally(labelled(text, FIRST)), seconds = tally(labelled(text, SECOND)), nets = tally(labelled(text, NET));
  const deductions = tally(labelled(text, DEDUCTION));
  if (!nets.length) return null;
  // Best-supported combination that adds up.
  let best = null;
  for (const [net, netVotes] of nets) {
    for (const [first, firstVotes] of firsts.length ? firsts : [[0, 0]]) {
      for (const [second, secondVotes] of seconds.length ? seconds : [[0, 0]]) {
        for (const [deduction, deductionVotes] of [[0, 0], ...deductions]) {
          if (!first || !second || Math.abs(second - first) - deduction !== net) continue;
          // A PDF can hold the truck head's ticket too: the load's own weighing comes first.
          const score = netVotes + firstVotes + secondVotes + deductionVotes + (net >= 1000 ? 10 : 0);
          if (!best || score > best.score) best = { first, second, net, deduction, score };
        }
      }
    }
  }
  if (best) return { first: best.first, second: best.second, net: best.net, deduction: best.deduction, confirmed: true };
  // Nothing adds up: the most often read net, if it was read the same way at least twice.
  const [net, votes] = nets[0];
  return { first: firsts[0]?.[0], second: seconds[0]?.[0], net, deduction: deductions[0]?.[0] || 0, confirmed: false, votes };
}

// The handwriting under the printed net, up to the signature line, from each reading.
function handwritingAfterNet(text) {
  const parts = [];
  for (const match of text.matchAll(NET)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 160);
    const figure = after.match(/^[^\d]{0,14}?\d[\d,]*(?:\.\d{1,2})?\s*(?:K\s*[GA9¢@]|X\s*[K¢@]?\s*[¢@G]?|X¢|KG)?/);
    let rest = figure ? after.slice(figure[0].length) : after;
    const end = rest.search(END);
    if (end >= 0) rest = rest.slice(0, end);
    parts.push(rest);
  }
  return parts;
}

/**
 * The figure written by hand under a ticket's net weight. `net` is the printed net.
 * Returns { final, adjustment, confirmed } when a total was read and agrees with the net,
 * { unread: true } when something is written there but could not be read, or null.
 */
export function handwrittenTotal(input, net) {
  const text = String(input || '').normalize('NFKC').toUpperCase();
  // Only the close reading of the column: the whole-page one also passes the operator's
  // signature on the left, which is not a figure.
  const column = text.includes(COLUMN_PASS) ? text.slice(text.indexOf(COLUMN_PASS)) : text;
  // Something written there: figures, an "=" or a "(+)" / "(-)". Stray letters are noise.
  if (!/=|\(\s*[+-]|\d.*\d/.test(handwritingAfterNet(column).join(' '))) return null;
  // Every reading may hold the total, the whole-page one included.
  const written = handwritingAfterNet(text).join(' ');
  // Handwritten digits are spaced unevenly ("= 22 75%" for 22758): joined, they count only
  // where the amount beside them confirms the total.
  const joined = written.replace(/([=~])\s*(\d[\d ]{2,8})/g, (all, sign, digits) => `${sign}${digits.replace(/ /g, '')}`);
  // Small amounts written beside a sign: "(-) 24 kg", "(+) 200", "& 200".
  // The amount follows its sign's bracket, however the sign itself was read ("¢)22", "&) 20").
  const amounts = new Set([...written.matchAll(/(?:\)|&|\(\s*[+-]|^|\s[+-])\s*(\d{1,3})(?![\d])/g)].map(match => Number(match[1])).filter(value => value > 0));
  const candidates = new Map();
  const add = (value, score) => {
    if (!(value > 0) || value === net || Math.abs(value - net) > Math.max(1000, net * 0.05)) return;
    candidates.set(value, (candidates.get(value) || 0) + score);
  };
  const netText = String(net);
  for (const match of written.matchAll(/(=|~|-|“|")?\s*(\d{3,6})(?![\d])/g)) {
    const digits = match[2], sign = match[1] ? 1 : 0;
    if (digits.length === netText.length) add(Number(digits), 2 + sign);
    // One digit too many ("199296" for 19996): drop each in turn.
    if (digits.length === netText.length + 1) for (let i = 0; i < digits.length; i++) add(Number(digits.slice(0, i) + digits.slice(i + 1)), 0.5 + sign / 2);
    // The leading digit misread or lost ("40900", "5660" for 20900, 24660): keep the net's own.
    for (let keep = 1; keep <= 2; keep++) {
      if (digits.length >= netText.length - keep && digits.length <= netText.length) {
        const tail = digits.slice(digits.length - (netText.length - keep));
        if (tail.length >= 3) add(Number(netText.slice(0, keep) + tail), 0.5 + sign / 2);
      }
    }
  }
  // A digit lost to a stray mark ("= 2016%" for 20168): any digit there, but only a total
  // the amount beside it confirms will be kept.
  for (const match of `${written} ${joined}`.matchAll(/[=~]\s*(\d{2,5})([^\d\s])/g)) {
    if (match[1].length !== netText.length - 1) continue;
    for (let digit = 0; digit <= 9; digit++) {
      const value = Number(match[1] + digit);
      if (amounts.has(Math.abs(value - net))) add(value, 0);
    }
  }
  for (const match of joined.matchAll(/[=~](\d{3,6})(?!\d)/g)) {
    const value = Number(match[1]);
    if (amounts.has(Math.abs(value - net))) add(value, 0);
  }
  let best = null;
  for (const [value, score] of candidates) {
    const confirmed = amounts.has(Math.abs(value - net));
    const total = score + (confirmed ? 3 : 0);
    if (!best || total > best.total) best = { value, total, confirmed };
  }
  // A total read exactly with its "=" is trusted; anything rebuilt from a misread needs the
  // amount beside it to agree.
  if (best && (best.confirmed || best.total >= 3)) return { final: best.value, adjustment: best.value - net, confirmed: best.confirmed };
  // The total itself unread, but a clearly signed amount was: "(-) 20", "(+) 590".
  const signed = [...new Set([...written.matchAll(/\(\s*([+-])\s*\)\s*=?\s*(\d{1,3})(?!\d)/g)].map(match => (match[1] === '+' ? 1 : -1) * Number(match[2])))];
  if (signed.length === 1) return { final: net + signed[0], adjustment: signed[0], confirmed: false };
  return { unread: true };
}

/** A truck head's own weighing: a ticket whose net is under a tonne, often marked "HEAD". */
export const isHeadTicket = (input, net) => net > 0 && net < 1000;

// Letters OCR reads for digits inside a number box.
const DIGIT_LOOKALIKE = { O: '0', D: '0', Q: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8', G: '6', T: '7', A: '4' };

/**
 * Container numbers on a ticket's "VECHILE NO." box, whose printed line often runs through
 * the digits: letters read for digits are mapped back, and one unreadable character is
 * recovered from the check digit. Only numbers that then pass ISO 6346 are returned.
 */
export function ticketContainers(input) {
  const text = String(input || '').normalize('NFKC').toUpperCase();
  const found = new Map();
  for (const match of text.matchAll(/(?<![A-Z])([A-Z]{3})([UJVY])[\s._|-]*([0-9A-Z°?|\/]{7})(?![0-9A-Z])/g)) {
    const owner = match[1] + 'U'.repeat(match[2] === 'J' ? 0 : 1) + (match[2] === 'J' ? 'J' : '');
    const raw = match[3];
    let unknown = -1, mapped = 0, ok = true;
    const chars = [...raw].map((char, i) => {
      if (/\d/.test(char)) return char;
      if (DIGIT_LOOKALIKE[char]) { mapped++; return DIGIT_LOOKALIKE[char]; }
      if (unknown >= 0) ok = false;
      unknown = i; return '?';
    });
    if (!ok || mapped > 2 || mapped + (unknown >= 0 ? 1 : 0) > 2 || mapped + (unknown >= 0 ? 1 : 0) === 0) continue;
    const solutions = [];
    for (let digit = 0; digit <= 9; digit++) {
      const value = chars.map((char, i) => i === unknown ? String(digit) : char).join('');
      const candidate = parseContainer(owner + value);
      if (candidate?.valid) solutions.push(candidate.id);
      if (unknown < 0) break;
    }
    if (unknown === 6) {
      const check = checkDigit(owner + chars.slice(0, 6).join(''));
      if (check >= 0) solutions.splice(0, solutions.length, owner + chars.slice(0, 6).join('') + check);
    }
    if (solutions.length === 1) found.set(solutions[0], { id: solutions[0], valid: true, corrected: true });
  }
  return [...found.values()];
}

/**
 * Everything a ticket says about the load. Returns null for text that is not a ticket.
 * { net, first, second, deduction, printedConfirmed, final, adjustment, handwritten,
 *   handwrittenUnread, head }: `final` is the load's weight in kg.
 */
export function readTicket(input) {
  const printed = printedWeights(input);
  if (!printed) return null;
  const head = isHeadTicket(input, printed.net);
  const result = { ...printed, printedConfirmed: printed.confirmed, final: printed.net, head };
  delete result.confirmed;
  if (head) return result;
  const written = handwrittenTotal(input, printed.net);
  if (written?.final) Object.assign(result, { final: written.final, adjustment: written.adjustment, handwritten: true, handwrittenConfirmed: written.confirmed });
  else if (written?.unread) result.handwrittenUnread = true;
  return result;
}
