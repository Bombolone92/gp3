/**
 * Mapping someone else's CSV onto this app's model.
 *
 * Everything here is pure and returns a plan rather than performing one: the
 * wizard shows that plan — how many rows will be created, how many are
 * duplicates, how many are unusable and why, with the row number — and only
 * then writes. Validation is element-level and as strict as validateBackup:
 * a junk date or a junk number is a refused row, never a stored NaN.
 */

import { round2 } from './util.js';
import { CURRENCIES } from './money.js';

/** The client columns this app can fill, and the headers that hint at them. */
export const CLIENT_FIELDS = [
  { key: 'name', label: 'Name', required: true, hints: ['name', 'client', 'customer', 'contact', 'full name', 'client name', 'customer name'] },
  { key: 'company', label: 'Company', hints: ['company', 'organisation', 'organization', 'business', 'company name'] },
  { key: 'email', label: 'Email', hints: ['email', 'e-mail', 'mail', 'email address'] },
  { key: 'phone', label: 'Phone', hints: ['phone', 'telephone', 'tel', 'mobile', 'phone number'] },
  { key: 'address', label: 'Address', hints: ['address', 'billing address', 'street', 'address line 1'] },
  { key: 'taxId', label: 'Tax ID', hints: ['tax id', 'taxid', 'vat', 'vat number', 'gst', 'abn', 'tax number'] },
  { key: 'currency', label: 'Currency', hints: ['currency', 'currency code'] },
  { key: 'paymentTermsDays', label: 'Payment terms (days)', hints: ['terms', 'payment terms', 'net', 'days'] },
  { key: 'taxRate', label: 'Tax rate (%)', hints: ['tax rate', 'rate', 'vat rate', 'tax %'] },
  { key: 'notes', label: 'Notes', hints: ['notes', 'note', 'memo', 'comments'] },
];

/** The invoice columns, for the opening-balances pass. */
export const INVOICE_FIELDS = [
  { key: 'number', label: 'Invoice number', required: true, hints: ['number', 'invoice number', 'invoice #', 'invoice no', 'ref', 'reference', 'invoice'] },
  { key: 'client', label: 'Client', required: true, hints: ['client', 'customer', 'name', 'company', 'bill to', 'client name'] },
  { key: 'email', label: 'Client email', hints: ['email', 'client email', 'customer email', 'e-mail'] },
  { key: 'issueDate', label: 'Issue date', required: true, hints: ['date', 'issue date', 'invoice date', 'issued'] },
  { key: 'dueDate', label: 'Due date', hints: ['due', 'due date', 'payment due'] },
  { key: 'currency', label: 'Currency', hints: ['currency', 'currency code'] },
  { key: 'total', label: 'Total', required: true, hints: ['total', 'amount', 'invoice total', 'gross', 'grand total'] },
  { key: 'paid', label: 'Amount paid', hints: ['paid', 'amount paid', 'payments', 'received'] },
  { key: 'description', label: 'Description', hints: ['description', 'item', 'details', 'memo', 'notes'] },
];

/**
 * The columns of a spreadsheet of work, for filling one document's lines in
 * the editor. The order matters, because guessMapping lets each field claim
 * a column in turn: `name` is listed before `details` so a file carrying
 * both "Timekeeper" and "Description" maps the person to the line and the
 * narrative to the description under it, while a file with only
 * "Description" maps it to the line itself; and `rate` is listed before
 * `unit` so "Price per unit" and "Rate per hour" are prices, not units.
 */
export const LINE_ITEM_FIELDS = [
  { key: 'name', label: 'Line description', required: true, hints: ['description', 'item', 'task', 'timekeeper', 'person', 'staff', 'employee', 'resource', 'service', 'activity', 'name', 'line item'] },
  { key: 'details', label: 'Work description', hints: ['details', 'work description', 'narrative', 'description', 'work', 'memo', 'notes', 'comment', 'comments'] },
  { key: 'qty', label: 'Quantity', hints: ['qty', 'quantity', 'hours', 'units', 'time', 'days', 'count'] },
  { key: 'rate', label: 'Rate', hints: ['rate', 'price', 'unit price', 'unit cost', 'hourly rate', 'cost', 'amount'] },
  { key: 'unit', label: 'Unit', hints: ['unit', 'uom'] },
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/**
 * A first guess at which column feeds which field: an exact header match
 * first, then a hint appearing inside the header ("Customer e-mail address").
 * Each column is used at most once, and the guess is only ever a starting
 * point — the wizard shows it as a set of pickers to correct.
 */
export function guessMapping(header, fields) {
  const mapping = {};
  const taken = new Set();
  const columns = header.map((h, i) => ({ i, key: norm(h) }));
  for (const pass of ['exact', 'contains']) {
    for (const field of fields) {
      if (mapping[field.key] !== undefined) continue;
      const hit = columns.find(({ i, key }) => {
        if (taken.has(i) || !key) return false;
        return pass === 'exact'
          ? field.hints.includes(key) || key === norm(field.label)
          : field.hints.some((h) => key.includes(h));
      });
      if (hit) {
        mapping[field.key] = hit.i;
        taken.add(hit.i);
      }
    }
  }
  return mapping;
}

/** The value of one mapped field in one row, trimmed; '' when unmapped. */
export function cell(row, mapping, key) {
  const at = mapping[key];
  return at === undefined || at === null || at < 0 ? '' : String(row[at] ?? '').trim();
}

/**
 * A number as written by a human or by another app: "1.234,56", "$1,234.56",
 * "(120.00)" for a negative, "1 234,56". Returns null when it is not a
 * number at all, which is a refused row rather than a silent zero.
 */
export function parseNumber(value) {
  let s = String(value ?? '').trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  // Scientific notation is a spreadsheet's way of saying the cell overflowed
  // ("1E+21"); stripping the letter read it as 121. Refused, like any other
  // cell that is not an amount.
  if (/\d\s*[eE]\s*[+-]?\d/.test(s)) return null;
  // A clock time or a duration ("8:30", "12:00 PM") is not an amount either:
  // stripping the colon with the other symbols read a timesheet's 8:30 as
  // 830 hours, silently, on every row.
  if (s.includes(':')) return null;
  // The typographic minus (U+2212) is how Intl writes a negative in Swedish,
  // Finnish, Norwegian and Baltic locales, so it is what their spreadsheet
  // exports carry. Read as the sign it is — stripped with the currency
  // symbols below, a credit note's "\u22121 200,00" imported as +1200 to bill.
  s = s.replace(/\u2212/g, '-');
  // Strip currency symbols, codes, and spaces used as thousand separators.
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  // One sign, in front: a second one, or one in the middle ("1-2"), is not
  // a number this app can bill.
  if (s.startsWith('-')) { sign *= -1; s = s.slice(1); }
  if (s.includes('-')) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator; the other groups.
    if (lastComma > lastDot) s = s.replaceAll('.', '').replace(',', '.');
    else s = s.replaceAll(',', '');
  } else if (lastComma >= 0) {
    // A lone comma groups thousands when the digits fall in threes the whole
    // way ("1,234", "12,345,678"); anywhere else it is a decimal separator,
    // which is how most of Europe writes "1234,56".
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replaceAll(',', '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(sign * n);
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A date as written by another app: ISO first, then the two ambiguous
 * orders, then whatever the platform can parse. `dayFirst` decides between
 * 03/04/2026 readings; the wizard asks once and applies it to the file.
 * Returns null rather than an invalid date, and never invents one.
 */
export function parseDate(value, { dayFirst = false } = {}) {
  // A time of day says nothing about the date and is dropped up front: with
  // it on, "08/04/2026 10:00" fell past the day-first reading below to the
  // platform's parser, which reads month first whatever the file's
  // convention — every row with a day of twelve or under was quietly swapped.
  const s = String(value ?? '').trim()
    .replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?(\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?$/, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // A value over 12 can only be the day, whatever the file's convention.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : (dayFirst ? [a, b] : [b, a]);
    return valid(year, month, day);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(s)) {
    return valid(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;

  function valid(year, month, day) {
    if (!(year >= 1900 && year <= 2999) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
}

const CODES = new Set(CURRENCIES.map((c) => c.code));

/** A currency code the app knows, or '' to fall back to the account default. */
export function parseCurrency(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return CODES.has(code) ? code : '';
}

/**
 * prepareClients(rows, mapping, existing) -> {
 *   create: [{ row, data }],           // what will be added
 *   duplicates: [{ row, data, match }],// already here, matched on email then name
 *   errors: [{ row, why }],            // unusable, with the file's own row number
 * }
 *
 * Nothing is written by this function: it is the dry run the wizard shows.
 */
export function prepareClients(rows, mapping, existing = []) {
  const byEmail = new Map();
  const byName = new Map();
  for (const c of existing) {
    if (c.email) byEmail.set(String(c.email).trim().toLowerCase(), c);
    // Both labels, as the invoice import indexes them: a row naming a
    // client's company used to be created beside them as a second client.
    for (const label of [c.name, c.company]) {
      const key = String(label || '').trim().toLowerCase();
      if (key) byName.set(key, c);
    }
  }
  const create = [];
  const duplicates = [];
  const errors = [];
  // Rows inside one file can collide with each other too, not only with what
  // is already here — a list exported twice and concatenated is a real file.
  const seenEmail = new Map();
  const seenName = new Map();

  rows.forEach((row, i) => {
    const at = i + 2;                     // 1-based, and the header is row 1
    const name = cell(row, mapping, 'name');
    const company = cell(row, mapping, 'company');
    if (!name && !company) {
      // A wholly empty row is a trailing newline, not a mistake worth naming.
      if (row.some((v) => String(v ?? '').trim())) errors.push({ row: at, why: 'no name or company' });
      return;
    }
    const email = cell(row, mapping, 'email');
    const terms = cell(row, mapping, 'paymentTermsDays');
    const taxRate = cell(row, mapping, 'taxRate');
    if (terms && parseNumber(terms) === null) {
      errors.push({ row: at, why: `payment terms “${terms}” is not a number` });
      return;
    }
    if (taxRate && parseNumber(taxRate) === null) {
      errors.push({ row: at, why: `tax rate “${taxRate}” is not a number` });
      return;
    }
    const data = {
      // A row with only a company borrows it for the name (a client must
      // have one, and the paper falls back the same way), and keeps it as
      // the company too — that is what the file said.
      name: name || company,
      company,
      email,
      phone: cell(row, mapping, 'phone'),
      address: cell(row, mapping, 'address'),
      taxId: cell(row, mapping, 'taxId'),
      currency: parseCurrency(cell(row, mapping, 'currency')),
      paymentTermsDays: terms ? String(Math.max(0, Math.round(parseNumber(terms)))) : '',
      taxRate: taxRate ? String(Math.min(100, Math.max(0, parseNumber(taxRate)))) : '',
      notes: cell(row, mapping, 'notes'),
    };
    const emailKey = email.toLowerCase();
    const nameKey = String(data.name).toLowerCase();
    const match = (emailKey && (byEmail.get(emailKey) || seenEmail.get(emailKey)))
      || byName.get(nameKey) || seenName.get(nameKey);
    if (match) {
      duplicates.push({ row: at, data, match });
      return;
    }
    if (emailKey) seenEmail.set(emailKey, data);
    seenName.set(nameKey, data);
    create.push({ row: at, data });
  });

  return { create, duplicates, errors };
}

/**
 * prepareInvoices(rows, mapping, options) -> {
 *   create: [{ row, doc, paid, clientKey, newClient }],
 *   errors: [{ row, why }],
 *   newClients: [name, ...],   // clients this pass would create
 *   clashes: [number, ...],    // numbers already in the account
 * }
 *
 * Each row becomes one single-line invoice marked sent, so Outstanding,
 * aging, and statements are right from day one; any amount already paid
 * becomes one payment on it.
 */
export function prepareInvoices(rows, mapping, {
  clients = [], docs = [], currency: fallbackCurrency = 'USD', dayFirst = false, termsDays = 14,
} = {}) {
  const byEmail = new Map();
  const byName = new Map();
  for (const c of clients) {
    if (c.email) byEmail.set(String(c.email).trim().toLowerCase(), c);
    for (const label of [c.name, c.company]) {
      const key = String(label || '').trim().toLowerCase();
      if (key) byName.set(key, c);
    }
  }
  const existingNumbers = new Set(docs.map((d) => String(d.number || '').toLowerCase()));
  const create = [];
  const errors = [];
  const newClients = new Map();
  const newByEmail = new Map(); // email -> the newClients key it landed on
  const clashes = [];

  rows.forEach((row, i) => {
    const at = i + 2;
    const number = cell(row, mapping, 'number');
    const who = cell(row, mapping, 'client');
    const email = cell(row, mapping, 'email');
    const totalRaw = cell(row, mapping, 'total');
    const issueRaw = cell(row, mapping, 'issueDate');
    if (!number && !who && !totalRaw && !issueRaw) {
      if (row.some((v) => String(v ?? '').trim())) errors.push({ row: at, why: 'nothing to import in this row' });
      return;
    }
    if (!number) { errors.push({ row: at, why: 'no invoice number' }); return; }
    const total = parseNumber(totalRaw);
    if (total === null) { errors.push({ row: at, why: `total “${totalRaw}” is not a number` }); return; }
    // A credit note reads as a negative total, and a zero is a column mapped
    // to the wrong place: neither is an invoice this app can bill, and both
    // used to come back as the puzzling "paid 0 is more than the total -120".
    if (!(total > 0)) { errors.push({ row: at, why: `total “${totalRaw}” is not an amount to bill` }); return; }
    const issueDate = parseDate(issueRaw, { dayFirst });
    if (!issueDate) { errors.push({ row: at, why: `issue date “${issueRaw}” is not a date` }); return; }
    const dueRaw = cell(row, mapping, 'dueDate');
    const dueDate = dueRaw ? parseDate(dueRaw, { dayFirst }) : '';
    if (dueRaw && !dueDate) { errors.push({ row: at, why: `due date “${dueRaw}” is not a date` }); return; }
    const paidRaw = cell(row, mapping, 'paid');
    const paid = paidRaw ? parseNumber(paidRaw) : 0;
    if (paidRaw && paid === null) { errors.push({ row: at, why: `amount paid “${paidRaw}” is not a number` }); return; }
    // A negative amount paid is a refund column mapped onto this one; it was
    // quietly floored to zero, importing the row as if nothing had been paid.
    if (paid < 0) { errors.push({ row: at, why: `amount paid “${paidRaw}” is less than nothing` }); return; }
    if (paid > total + 0.005) {
      errors.push({ row: at, why: `paid ${paid} is more than the total ${total}` });
      return;
    }
    const key = email.toLowerCase();
    const match = (key && byEmail.get(key)) || byName.get(who.toLowerCase());
    // The rows of one file match each other the way they match the account:
    // by email first. Three spellings of one company on one address used to
    // become three clients, with the invoices split across them.
    const pending = !match && key ? newByEmail.get(key) : null;
    // Client is a required field, and the other required ones refuse a row
    // rather than importing a blank. Without a name there is nobody to create
    // and nobody to match, so the invoice would land with no client at all:
    // absent from that client's page, absent from their statement, and reading
    // "No client" in every list. An email that finds someone on file is
    // enough, because that is who the invoice is for — and so is one that
    // finds the client an earlier row of this same file creates.
    if (!match && !pending && !who) {
      errors.push({ row: at, why: 'no client' });
      return;
    }
    if (!match && !pending && who) {
      newClients.set(who.toLowerCase(), { name: who, email });
      if (key) newByEmail.set(key, who.toLowerCase());
    }
    // Against the account *and* the rest of the file: an export concatenated
    // twice, or a spreadsheet with one line per payment, repeats a number, and
    // "3 invoices to add" with no warning is how two INV-100s get created.
    if (existingNumbers.has(number.toLowerCase())) clashes.push(number);
    else existingNumbers.add(number.toLowerCase());

    create.push({
      row: at,
      clientId: match?.id || '',
      newClient: match ? null : (pending || (who ? who.toLowerCase() : '')),
      paid: Math.max(0, paid || 0),
      doc: {
        kind: 'invoice',
        number,
        issueDate,
        dueDate: dueDate || '',
        currency: parseCurrency(cell(row, mapping, 'currency')) || fallbackCurrency,
        items: [{
          name: cell(row, mapping, 'description') || `Opening balance ${number}`,
          qty: 1,
          rate: total,
        }],
        taxes: [],
        discountType: 'none',
        discountValue: 0,
        status: 'sent',
        payments: [],
      },
    });
  });

  return { create, errors, newClients: [...newClients.values()], clashes, termsDays };
}

/**
 * prepareLineItems(rows, mapping) -> {
 *   items: [{ row, data }],   // editor-shaped lines: name, qty, rate, unit?, details?
 *   errors: [{ row, why }],   // unusable, with the file's own row number
 * }
 *
 * A blank quantity bills 1, and a blank rate stays blank so the editor (and
 * the price list behind it) can fill it — a spreadsheet of timekeepers and
 * hours does not have to repeat the rates the account already knows. A
 * negative quantity is a credit line and passes; a rate is money per unit
 * and a negative one is a mis-mapped column, refused like any junk number.
 */
export function prepareLineItems(rows, mapping) {
  const items = [];
  const errors = [];
  rows.forEach((row, i) => {
    const at = i + 2;   // the file's own row number, header included
    const name = cell(row, mapping, 'name');
    if (!name) {
      if (row.some((v) => String(v ?? '').trim())) errors.push({ row: at, why: 'no description' });
      return;
    }
    const qtyRaw = cell(row, mapping, 'qty');
    const qty = qtyRaw === '' ? 1 : parseNumber(qtyRaw);
    if (qty === null) { errors.push({ row: at, why: `quantity “${qtyRaw}” is not a number` }); return; }
    const rateRaw = cell(row, mapping, 'rate');
    const rate = rateRaw === '' ? '' : parseNumber(rateRaw);
    if (rate === null) { errors.push({ row: at, why: `rate “${rateRaw}” is not a number` }); return; }
    if (rate !== '' && rate < 0) { errors.push({ row: at, why: `rate “${rateRaw}” is less than nothing` }); return; }
    // Bounded like the editor's own unit box; display only, never interpreted.
    const unit = cell(row, mapping, 'unit').slice(0, 24);
    const details = cell(row, mapping, 'details');
    items.push({
      row: at,
      data: {
        name,
        qty,
        rate,
        ...(unit ? { unit } : {}),
        ...(details ? { details } : {}),
      },
    });
  });
  return { items, errors };
}

/** One line for the confirm step: what this import will actually do. */
export function importSummary(plan, kind) {
  const parts = [];
  if (kind === 'clients') {
    parts.push(`${plan.create.length} client${plan.create.length === 1 ? '' : 's'} to add`);
    if (plan.duplicates.length) parts.push(`${plan.duplicates.length} already here`);
  } else {
    parts.push(`${plan.create.length} invoice${plan.create.length === 1 ? '' : 's'} to add`);
    if (plan.newClients.length) parts.push(`${plan.newClients.length} new client${plan.newClients.length === 1 ? '' : 's'}`);
    if (plan.clashes.length) parts.push(`${plan.clashes.length} number${plan.clashes.length === 1 ? '' : 's'} already used`);
  }
  if (plan.errors.length) parts.push(`${plan.errors.length} row${plan.errors.length === 1 ? '' : 's'} skipped`);
  return parts.join(' · ');
}
