/**
 * ESC/POS: a receipt as bytes a thermal printer understands.
 *
 * No vendor SDK - the command set every till printer has spoken since the
 * eighties is a handful of escape sequences, and the browser's own transports
 * (Bluetooth, Serial, USB) can carry them. This module is pure: it turns the
 * same `receiptDoc` model the screen and the shared image render into a byte
 * string, so the three copies can't drift apart.
 *
 * Layout is monospaced columns rather than pixels. A printer's line is 32
 * characters on 58mm paper and 48 on 80mm; a label and an amount are printed
 * as one line padded between them, which is how a till slip has always read.
 */

/** Bytes for the two paper widths a shop actually buys. */
export const PAPER_WIDTHS = [
  { columns: 32, label: '58 mm · 32 characters' },
  { columns: 48, label: '80 mm · 48 characters' },
];

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Code page 437 - the default character set of practically every ESC/POS
 * printer. Only the entries this app can actually produce are listed: the
 * typography it writes on purpose (its own minus sign, the middot it
 * separates with, curly quotes) and the accented letters a shop name, a
 * product, or a customer is likely to carry.
 *
 * Anything else becomes '?', which is the honest thing to print: a byte the
 * printer maps to a different glyph would be a wrong receipt, quietly.
 */
const CP437 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84,
  'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89,
  'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e,
  'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93,
  'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98,
  'Ö': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d,
  '₧': 0x9e, 'ƒ': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2,
  'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, 'ß': 0xe1, 'µ': 0xe6, '±': 0xf1, '÷': 0xf6,
  '°': 0xf8, '·': 0xfa, '²': 0xfd, ' ': 0x20,
};

/**
 * The app's own typography, spelled the way a till printer can print it.
 * Its minus sign (U+2212), the separator it uses between facts, curly
 * quotes, and the currency marks that have no CP437 byte at all.
 */
const TRANSLITERATE = {
  '−': '-', '–': '-', '—': '-', '‘': "'", '’': "'",
  '“': '"', '”': '"', '…': '...', '×': 'x', '€': 'EUR',
  // No '¥' here: CP437 has a byte for it (0x9d, above), and the mark is the
  // yuan's as much as the yen's - spelling it 'JPY' printed a Chinese shop's
  // CN¥12.50 as "CNJPY12.50", a different currency on the customer's slip.
  '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₽': 'RUB',
  '•': '*', '→': '->', '↑': '^', '↓': 'v',
};

/**
 * One byte per printable character, in code page 437.
 *
 * Composed accents are decomposed and re-composed first (NFC), so 'e' plus a
 * combining acute prints as é rather than as 'e?'.
 */
export function encodeCp437(text) {
  const out = [];
  for (const ch of String(text ?? '').normalize('NFC')) {
    const swap = TRANSLITERATE[ch];
    if (swap !== undefined) {
      for (const c of swap) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.codePointAt(0);
    if (code === 0x0a) { out.push(0x0a); continue; }
    if (code >= 0x20 && code <= 0x7e) { out.push(code); continue; }
    const mapped = CP437[ch];
    out.push(mapped === undefined ? 0x3f : mapped);
  }
  return out;
}

/**
 * How many columns a string actually takes on the paper.
 *
 * Not its length. encodeCp437 spells out the characters a till printer has
 * no byte for - '\u20ac' becomes 'EUR', '\u2026' becomes '...' - so a
 * \u20ac24.68 amount is six characters and eight columns wide. Padding
 * computed from the character count overran the line by exactly that
 * difference, and the printer wrapped the tail of every amount onto a row of
 * its own: a broken slip on every receipt a euro, rupee, won or lira shop
 * ever printed.
 */
export function printWidth(text) {
  return encodeCp437(text).length;
}

/**
 * A byte buffer with the handful of ESC/POS commands a receipt needs.
 *
 * Everything is stateless from the printer's point of view except alignment
 * and emphasis, which is why each helper sets what it needs and the document
 * builder below puts things back.
 */
export class EscposBuilder {
  constructor({ columns = 48 } = {}) {
    this.columns = columns;
    this.bytes = [];
  }

  raw(...values) {
    this.bytes.push(...values);
    return this;
  }

  /** ESC @ - forget whatever the last job left set. */
  init() {
    return this.raw(ESC, 0x40);
  }

  /** 0 left, 1 center, 2 right. */
  align(n) {
    return this.raw(ESC, 0x61, n);
  }

  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! - double width and height for the one line that carries the shop. */
  big(on) {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  text(value) {
    this.bytes.push(...encodeCp437(value));
    return this;
  }

  line(value = '') {
    return this.text(`${value}\n`);
  }

  /** Blank lines, and the space a cutter needs to reach the tear bar. */
  feed(n = 1) {
    return this.raw(ESC, 0x64, Math.max(0, Math.min(255, n)));
  }

  /**
   * A label on the left and an amount on the right, on one line.
   *
   * The label is the part that gives when the two don't fit: an amount cut
   * short is a wrong receipt, while a shortened product name is still
   * recognizably that product.
   */
  columnsLine(label, amount, { indent = 0 } = {}) {
    const right = String(amount ?? '');
    const rightWidth = printWidth(right);
    const room = this.columns - rightWidth - indent;
    const pad = ' '.repeat(indent);
    if (room <= 1) return this.line(`${pad}${right}`.slice(0, this.columns));
    const left = clip(String(label ?? ''), room - 1);
    const gap = this.columns - indent - printWidth(left) - rightWidth;
    return this.line(pad + left + ' '.repeat(Math.max(1, gap)) + right);
  }

  /**
   * A paragraph wrapped to the paper, on word boundaries where it can be.
   *
   * `scale` is the character width the printer is currently set to: `big()`
   * doubles it, so only half as many glyphs reach the tear bar. Wrapped to
   * the full column count, a 17-character shop name printed 34 columns wide
   * on 58mm paper and the printer broke it mid-word - the first line of
   * every receipt, on the narrower of the two papers a shop buys.
   */
  wrapped(value, { indent = 0, scale = 1 } = {}) {
    const width = Math.max(1, Math.floor((this.columns - indent * scale) / scale));
    for (const row of wrap(String(value ?? ''), width)) {
      this.line(' '.repeat(indent) + row);
    }
    return this;
  }

  rule(char = '-') {
    return this.line(char.repeat(this.columns));
  }

  /** GS V 66 - cut, after feeding the paper clear of the head. */
  cut() {
    return this.feed(3).raw(GS, 0x56, 66, 0);
  }

  build() {
    return new Uint8Array(this.bytes);
  }
}

/**
 * Shorten to fit `max` columns, saying so with a '~' rather than just
 * stopping. Measured in columns, so a name carrying a transliterated
 * character is cut where the paper actually runs out.
 */
function clip(text, max) {
  if (max <= 0) return '';
  if (printWidth(text) <= max) return text;
  let out = '';
  let width = 0;
  for (const ch of text) {
    const w = printWidth(ch);
    if (width + w > max - 1) break;   // one column reserved for the marker
    out += ch;
    width += w;
  }
  return `${out}~`;
}

/**
 * Greedy word wrap; a word longer than the line is broken rather than lost.
 * Widths are counted in printed columns, not characters.
 */
export function wrap(text, width) {
  /** As much of `row` as fits one line, by column. */
  const head = (row) => {
    let out = '';
    let w = 0;
    for (const ch of row) {
      const cw = printWidth(ch);
      if (w + cw > width) break;
      out += ch;
      w += cw;
    }
    // A single character wider than the whole line still has to make progress.
    return out || [...row][0] || '';
  };
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let row = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!row) {
        row = word;
      } else if (printWidth(row) + 1 + printWidth(word) <= width) {
        row += ` ${word}`;
      } else {
        out.push(row);
        row = word;
      }
      while (printWidth(row) > width) {
        const fits = head(row);
        out.push(fits);
        row = row.slice(fits.length);
      }
    }
    out.push(row);
  }
  // A trailing empty paragraph would print a blank line nobody asked for.
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out.length ? out : [''];
}

/**
 * The standard drawer pulse: ESC p, connector 0, 50ms on, 250ms off.
 *
 * The drawer is wired to the printer's own port, so opening it is a print
 * job with no paper - which is why "no sale" goes through here too.
 */
export function drawerKickBytes({ connector = 0 } = {}) {
  return new Uint8Array([ESC, 0x70, connector ? 1 : 0, 25, 250]);
}

/**
 * A receiptDoc (lib/receipt-doc.js) as ESC/POS bytes.
 *
 * The same model the screen and the shared image render, so a paper slip can
 * never say something its own on-screen copy doesn't.
 */
export function escposReceipt(doc, { columns = 48, kick = false } = {}) {
  const b = new EscposBuilder({ columns });
  b.init().align(1);

  b.bold(true).big(true).wrapped(doc.storeName, { scale: 2 }).big(false).bold(false);
  if (doc.address) b.wrapped(doc.address);
  for (const reg of doc.registrations || []) b.wrapped(reg);
  if (doc.voided) b.feed(1).bold(true).line('*** VOID ***').bold(false);
  if (doc.kind) b.feed(1).bold(true).line(`*** ${doc.kind} ***`).bold(false);
  b.feed(1);
  for (const meta of doc.meta || []) b.wrapped(meta);

  b.align(0).rule();
  for (const item of doc.items || []) {
    // The quantity leads the line, as it does on screen; the name gives way
    // to the amount when the paper is narrow.
    b.columnsLine(`${item.qty} ${item.name}`, item.amount);
    for (const sub of item.subs || []) b.wrapped(sub.text, { indent: 2 });
  }

  b.rule();
  for (const total of doc.totals || []) {
    if (total.strong) b.bold(true);
    b.columnsLine(total.label, total.value);
    if (total.strong) b.bold(false);
  }

  if ((doc.payments || []).length) {
    b.rule();
    for (const pay of doc.payments) {
      if (pay.strong) b.bold(true);
      b.columnsLine(pay.label, pay.value);
      if (pay.strong) b.bold(false);
    }
  }

  if (doc.note) {
    b.rule().wrapped(doc.note);
  }
  if (doc.reward || doc.loyalty) {
    b.rule().align(1);
    if (doc.reward) b.wrapped(doc.reward);
    if (doc.loyalty) b.bold(true).wrapped(doc.loyalty).bold(false);
    b.align(0);
  }
  if (doc.footer) {
    b.rule().align(1).wrapped(doc.footer).align(0);
  }

  b.cut();
  // The drawer opens after the slip is out, so the cashier isn't holding a
  // half-printed receipt over an open till.
  if (kick) b.raw(...drawerKickBytes());
  return b.build();
}

/**
 * The Z-report as bytes: the same day close the on-screen slip shows, in the
 * same order, so the two can be laid side by side.
 *
 * `rows` is a flat list of { label, value, section, strong } - the caller
 * (ui/zreport.js) already has the day's figures formatted.
 */
export function escposReport(head, rows, { columns = 48 } = {}) {
  const b = new EscposBuilder({ columns });
  b.init().align(1);
  b.bold(true).big(true).wrapped(head.storeName, { scale: 2 }).big(false).bold(false);
  if (head.address) b.wrapped(head.address);
  b.feed(1).bold(true).line(`*** ${head.kind} ***`).bold(false);
  for (const meta of head.meta || []) b.wrapped(meta);
  b.align(0);

  for (const row of rows) {
    if (row.section) {
      b.rule().bold(true).line(row.section.toUpperCase()).bold(false);
      continue;
    }
    if (row.strong) b.bold(true);
    b.columnsLine(row.label, row.value);
    if (row.strong) b.bold(false);
  }

  if (head.footer) b.rule().align(1).wrapped(head.footer).align(0);
  b.cut();
  return b.build();
}
