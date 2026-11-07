import { validateProRata, validateMFN, validateDividendEvents, validateBasis } from './financing.js';
/**
 * CSV import - the pure half. Parsing, header auto-matching, and dry-run
 * plan building live here with no I/O and no store access, so the preview
 * the user reviews is computed the same way the tests exercise it. The
 * store's importRecords() is the only thing that writes.
 *
 * Import is additive by design: it never wipes, and a stakeholder whose
 * name already exists is a skip, not a duplicate.
 */

import { parseNum, isEmail, NUM_MAX } from './util.js';
import { authorizedOverrun } from './captable.js';
import {
  deadline83b, DAYS_83B, MAX_VESTING_MONTHS, STAKEHOLDER_NAME_MAX, CLASS_NAME_MAX, EMAIL_MAX,
  PLAN_NAME_MAX, planAccepts, planRefusal, resolvePlan,
} from './captable.js';

/* ---------- Parsing (RFC 4180) ---------- */

/** Parse CSV text into rows of string cells. Handles quotes, embedded
 *  commas/newlines, doubled quotes, CRLF, and a UTF-8 BOM. Each row carries
 *  its 1-based source line as a non-enumerable `line` property - blank lines
 *  and multi-line quoted cells shift rows away from their array index, and
 *  error reports must point at the line the user sees in their spreadsheet. */
export function parseCSV(text, { maxRows = Infinity } = {}) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = sniffDelimiter(s);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let quoteLine = 1;
  let line = 1;
  let rowLine = 1;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    // A row of nothing but empty cells is a blank line, not data.
    if (row.some((c) => c.trim() !== '')) {
      Object.defineProperty(row, 'line', { value: rowLine });
      rows.push(row);
      // Data rows past the ceiling stop the parse here rather than after the whole file is in memory.
      if (rows.length - 1 > maxRows) {
        throw new Error(`That file has more than ${maxRows.toLocaleString('en-US')} rows. Import up to ${maxRows.toLocaleString('en-US')} at a time.`);
      }
    }
    row = [];
    line += 1;
    rowLine = line;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        cell += ch;
        // A line break inside a quoted cell still advances the source line.
        if (ch === '\n' || (ch === '\r' && s[i + 1] !== '\n')) line += 1;
      }
    } else if (ch === '"') {
      quoted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (s[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error(`Unclosed quoted field at line ${quoteLine}. Check the CSV and try again.`);
  if (cell !== '' || row.length) endRow();
  return rows;
}

/**
 * The cell separator the file uses, read off its header line: whichever of
 * comma, semicolon and tab appears most often outside quotes, comma on a tie.
 * Excel in most of Europe writes semicolon-separated "CSV" because the comma
 * is its decimal point there, and a tab-separated export is CSV in all but
 * name. Both used to load as one column per line: the header offered a
 * single "Name;Email;Type" column, nothing auto-matched, and mapping Name to
 * it imported holders called "Ada Chen;ada@x.co;Founder".
 */
function sniffDelimiter(s) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let lines = 0;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '\n') {
      /* Off the first line that carries a delimiter, within the first few:
         a one-cell title above the header says nothing about the file, and
         read off it alone a semicolon file parsed as one column per row. */
      if (Object.values(counts).some((n) => n > 0) || ++lines >= 5) break;
    } else if (ch === '\r') continue;
    else if (ch in counts) counts[ch] += 1;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

/* ---------- Field definitions and header matching ---------- */

export const STAKEHOLDER_FIELDS = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'fullname', 'stakeholder', 'holder', 'holdername', 'stakeholdername'] },
  { key: 'email', label: 'Email', aliases: ['email', 'emailaddress'] },
  { key: 'kind', label: 'Type', aliases: ['type', 'kind', 'role', 'category'] },
];

export const SECURITY_FIELDS = [
  { key: 'stakeholder', label: 'Stakeholder', required: true, aliases: ['stakeholder', 'holder', 'name', 'holdername', 'stakeholdername'] },
  { key: 'kind', label: 'Security type', required: true, aliases: ['type', 'kind', 'securitytype', 'instrument'] },
  { key: 'className', label: 'Share class', aliases: ['class', 'shareclass', 'series'] },
  { key: 'quantity', label: 'Quantity', aliases: ['quantity', 'shares', 'sharecount', 'count', 'options', 'numberofshares'] },
  { key: 'price', label: 'Price per share', aliases: ['price', 'pricepershare', 'pps', 'issueprice', 'shareprice'] },
  { key: 'strike', label: 'Strike price', aliases: ['strike', 'strikeprice', 'exerciseprice'] },
  /* No currency in these two labels: the amounts are in whatever the company
     records its money in, and the template a user downloads should not name
     dollars at them. */
  { key: 'principal', label: 'Principal', aliases: ['principal', 'investment', 'amount', 'principalamount'] },
  { key: 'cap', label: 'Valuation cap', aliases: ['cap', 'valuationcap'] },
  { key: 'discount', label: 'Discount (%)', aliases: ['discount', 'discountpct', 'discountpercent'] },
  { key: 'interestRate', label: 'Interest (%)', aliases: ['interest', 'interestrate'] },
  { key: 'safeType', label: 'SAFE cap type', aliases: ['safetype', 'captype'] },
  /* Required, like every date the forms take. An undated option grant never
     vests - months elapsed from no date read as none - and sits "active" for
     good, off the coming-up list and the needs-attention list alike, while
     an undated certificate has no day to be read as of. */
  { key: 'date', label: 'Date', required: true, aliases: ['date', 'issuedate', 'grantdate', 'signingdate', 'issued'] },
  { key: 'vestingMonths', label: 'Vesting (months)', aliases: ['vesting', 'vestingmonths'] },
  { key: 'cliffMonths', label: 'Cliff (months)', aliases: ['cliff', 'cliffmonths'] },
  { key: 'vestingStart', label: 'Vesting start', aliases: ['vestingstart', 'vestingstartdate'] },
  { key: 'expires', label: 'Expires', aliases: ['expires', 'expiration', 'expirationdate', 'expiry'] },
  { key: 'maturityDate', label: 'Maturity date', aliases: ['maturity', 'maturitydate'] },
  /* The day a restricted stock holder filed their 83(b) election. Without a
     column for it, every reverse-vesting certificate a spreadsheet brought in
     from years back landed on the needs-attention list as "no 83(b) election
     on file" the moment it was imported - one row per founder, each to be
     cleared by hand through a sheet that asks for exactly this date. */
  { key: 'filed83b', label: '83(b) filed', aliases: ['83b', 'filed83b', '83bfiled', '83bfiledon', '83bdate', '83belection', 'section83b', 'electionfiled', '83bfilingdate'] },
  /* The equity incentive plan an option grant or RSU award is granted under,
     by name; "none" for an award outside every plan. Blank takes the one plan
     that could hold the award - see resolvePlan - and a row two plans could
     hold is refused rather than drawn from a reserve nobody chose. */
  { key: 'plan', label: 'Plan', aliases: ['plan', 'equityplan', 'incentiveplan', 'optionplan', 'stockplan', 'planname', 'equityincentiveplan'] },
  /* Negotiated terms travel as JSON in their own columns - the shape the
     "Export financing terms" report writes - and are validated as strictly as
     a form entry: a clause the app cannot calculate fails the row rather
     than importing without it. See docs/financing-conventions.md. */
  { key: 'proRata', label: 'Pro-rata rights JSON', aliases: ['proratarightsjson', 'prorata', 'proratarights'] },
  { key: 'mfn', label: 'MFN JSON', aliases: ['mfnjson', 'mfn'] },
  { key: 'dividendEvents', label: 'Dividend events JSON', aliases: ['dividendeventsjson', 'dividendevents'] },
  { key: 'economicBasis', label: 'Economic basis JSON', aliases: ['economicbasisjson', 'economicbasis'] },
];

/* What a plan cell may say to mean "outside every plan". */
const NO_PLAN = /^(none|no plan|outside|outside any plan|n\/a|-)$/i;

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Propose a column for each field by header name: exact alias match wins.
 * Returns { fieldKey: columnIndex | null }; the user can override any of it.
 *
 * A field's own label is the last alias tried, so the templates this file
 * hands out - which are headed with exactly those labels - always match
 * themselves. Without it a column could go quietly unmapped and take its
 * field's default instead of the value in the file.
 */
export function autoMatch(headers, fields) {
  /* Each heading in two spellings: as written, and without a unit in
     trailing parentheses - "Price per share (USD)", "Vesting (months)" - so
     a column headed with its currency, as the app's own exports are, still
     finds its field. */
  const normalized = headers.map((h) => [
    normalizeHeader(h),
    normalizeHeader(String(h ?? '').replace(/\s*\([^()]*\)\s*$/, '')),
  ]);
  const mapping = {};
  const taken = new Set();
  for (const f of fields) {
    let found = null;
    for (const alias of [...f.aliases, normalizeHeader(f.label)]) {
      const i = normalized.findIndex((h, idx) => h.includes(alias) && !taken.has(idx));
      if (i !== -1) { found = i; break; }
    }
    mapping[f.key] = found;
    if (found !== null) taken.add(found);
  }
  return mapping;
}

/**
 * The row the column headings are on: the first row with more than one
 * filled cell, when any row has more than one. A spreadsheet often opens
 * with a title in a single cell - the app's own exports do - and taken as
 * the header it left every picker offering that one title, with three
 * required fields to map onto it and no way forward but editing the file.
 */
export function headerRowIndex(rows) {
  const filled = (row) => row.filter((c) => String(c ?? '').trim() !== '').length;
  const at = rows.findIndex((row) => filled(row) > 1);
  return at < 0 ? 0 : at;
}

/* ---------- Value coercion ---------- */

const cellAt = (row, index) => (index === null || index === undefined ? '' : String(row[index] ?? '').trim());

/**
 * A deadline has to fall after the record it belongs to. The security form
 * refuses an expiration on or before the grant date and a maturity on or
 * before the issue date; the import accepted both, and a mistyped year - or
 * a column mapped one across - wrote grants that read as expired and notes
 * that read as matured the moment they landed, straight onto the
 * needs-attention list. Empty is fine: neither field is required.
 */
const afterIssue = (deadline, issued) => !deadline || !issued || deadline > issued;

/**
 * Parse a number the way people type them: commas, $, %, spaces. Null for an
 * empty cell, NaN for one that is not a number - the same reading parseNum
 * gives typed input, so a hex literal or a decimal-comma figure fails the
 * row instead of landing as a share count nobody meant.
 */
function toNumber(value) {
  if (!String(value ?? '').trim()) return null;
  // Past NUM_MAX reads as the figure it is, so the planner can say which
  // column holds it and why it is refused, rather than as unreadable.
  return parseNum(value, { max: Infinity }) ?? NaN;
}

/**
 * 'YYYY-MM-DD' passthrough; 'M/D/YYYY' and 'M-D-YYYY' converted. '' for an
 * empty cell, null for anything unreadable.
 *
 * The day is checked against the month it claims rather than just parsed:
 * appending a time makes V8 roll a nonexistent date forward instead of
 * rejecting it (`new Date('2024-02-30T00:00:00')` is March 1), so a "2/30"
 * typed for "2/3" would import as a date that renders as March 1 while
 * sorting as February 30 - every lexical comparison in the app disagreeing
 * with every calculation from then on.
 */
const SLASHED_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/**
 * How a file writes its slashed dates: 'month' first (the US reading, and
 * the default), 'day' first, or 'mixed'. Read off every date cell in the
 * file at once, because one cell cannot say: "05/06/2023" is May or June.
 * Any first component past twelve makes the file day-first; a second past
 * twelve as well means the file disagrees with itself, and none of its
 * slashed dates can be trusted. Before this the reading was always month
 * first, so a European file imported every row with a day of twelve or
 * under on the wrong date and refused the rest as unreadable, with nothing
 * to say the accepted ones were wrong.
 */
export function slashedDateOrder(cells) {
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of cells) {
    const m = SLASHED_DATE.exec(String(cell ?? '').trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  return dayFirst && monthFirst ? 'mixed' : dayFirst ? 'day' : 'month';
}

export function toISODate(value, order = 'month') {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const slashed = dashed ? null : SLASHED_DATE.exec(s);
  if (!dashed && !slashed) return null;
  // A slashed date in a file that mixes the two orders reads as nothing.
  if (slashed && order === 'mixed') return null;
  const [year, month, day] = dashed
    ? [Number(dashed[1]), Number(dashed[2]), Number(dashed[3])]
    : order === 'day'
      ? [Number(slashed[3]), Number(slashed[2]), Number(slashed[1])]
      : [Number(slashed[3]), Number(slashed[1]), Number(slashed[2])];
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00`);
  // A rolled-over date reports a different day than the one asked for; an
  // unparseable one reports NaN, which fails these comparisons too.
  return d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day
    ? iso
    : null;
}

/**
 * 'pre' or 'post' from however the cell puts it: "Pre-money", "post", "YC
 * pre-money SAFE". Blank is post-money, the form's own default. Null for a
 * cell that says neither, or both: the cap type decides what the cap divides,
 * and a cell this column cannot read used to import as post-money whatever it
 * said - "Standard pre-money SAFE" included, since only a cell starting with
 * "pre" counted - while the stakeholder-type column fails a row it cannot read.
 */
function safeTypeFrom(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'post';
  const pre = /\bpre\b|\bpre-?money\b/.test(s);
  const post = /\bpost\b|\bpost-?money\b/.test(s);
  if (pre === post) return null;
  return pre ? 'pre' : 'post';
}

const STAKEHOLDER_KIND_ALIASES = {
  founder: 'founder', founders: 'founder', cofounder: 'founder',
  investor: 'investor', angel: 'investor', vc: 'investor', fund: 'investor',
  employee: 'employee', staff: 'employee',
  advisor: 'advisor', adviser: 'advisor', consultant: 'advisor', contractor: 'advisor',
  entity: 'entity', company: 'entity', companyfund: 'entity', trust: 'entity',
};

const SECURITY_KIND_ALIASES = {
  shares: 'shares', share: 'shares', stock: 'shares', certificate: 'shares', common: 'shares', preferred: 'shares',
  option: 'option', options: 'option', optiongrant: 'option', iso: 'option', nso: 'option',
  optionsiso: 'option', optionsnso: 'option',
  rsu: 'rsu', rsus: 'rsu', restrictedstockunit: 'rsu', restrictedstockunits: 'rsu',
  warrant: 'warrant', warrants: 'warrant',
  safe: 'safe',
  note: 'note', convertiblenote: 'note', cn: 'note',
};

/**
 * Alias lookup that stops at the table's own keys. A plain `table[key]` walks
 * the prototype chain, so a type column reading "constructor" resolves to a
 * function and sails past the unknown-type check - only to be dropped as
 * unwritable at commit time, aborting the whole import over one bad cell.
 */
const aliasFor = (table, key) => (key && Object.hasOwn(table, key) ? table[key] : null);

/* ---------- Dry-run plans ---------- */

/**
 * Stakeholders: rows → { creates, skips, errors }. A name already on the
 * cap table (or earlier in the file) is a skip - additive, never a twin.
 */
export function buildStakeholderPlan(rows, mapping, { stakeholders = [] } = {}) {
  const creates = [];
  const skips = [];
  const errors = [];
  const seen = new Set(stakeholders.map((h) => h.name.trim().toLowerCase()));
  /* Names an earlier row of this file is creating: a second row for one of
     them is a duplicate inside the file, and was reported as a holder already
     on the cap table - a person the user was looking for and could not find. */
  const inFile = new Set();
  rows.forEach((row, i) => {
    // parseCSV stamps the true source line; i + 2 covers plain-array callers.
    const line = row.line ?? i + 2;
    /* Cut to what the record keeps before it is compared or created: a name
       distinct only past the cut was imported twice as two holders stored
       under one name, and the securities file's rows for it then failed to
       find a holder under the full-length cell. Trimmed again after the cut,
       as the sanitizer trims what it stores: a cut that landed just past a
       space left this plan holding a name one trailing space longer than the
       record, so the second import of the file promised the holder again
       and the securities file could not find them. */
    const name = cellAt(row, mapping.name).slice(0, STAKEHOLDER_NAME_MAX).trim();
    if (!name) return errors.push({ line, message: 'Missing a name' });
    if (seen.has(name.toLowerCase())) {
      return skips.push({
        line, name, reason: inFile.has(name.toLowerCase()) ? 'Earlier in this file' : 'Already on the cap table',
      });
    }
    const rawKind = normalizeHeader(cellAt(row, mapping.kind));
    const kind = aliasFor(STAKEHOLDER_KIND_ALIASES, rawKind) || (rawKind ? null : 'employee');
    if (!kind) {
      return errors.push({ line, message: `Unknown stakeholder type "${cellAt(row, mapping.kind)}"` });
    }
    /* Held to what the stakeholder form's email field takes. The cell was
       written as it came, so a column mapped one across put phone numbers
       or names into every holder's email, and from there into the holder
       list, the search index, and the Form 3921 export. Blank is fine: the
       field is optional. */
    const email = cellAt(row, mapping.email);
    if (email && !isEmail(email)) {
      return errors.push({ line, message: `"${email}" isn’t an email address` });
    }
    /* The record keeps as much of an address as the form's box takes. Past
       that the sanitizer cut it, and what it kept was no address at all -
       with nothing in this preview to say so. */
    if (email.length > EMAIL_MAX) {
      return errors.push({ line, message: `"${email}" is longer than the ${EMAIL_MAX} characters an email address can have here` });
    }
    /* Reserved only once the row is actually going to create the person. A
       row that fails validation creates nobody, so the name it carried is
       still free - and a later good row for the same name was being told the
       person was "already on the cap table" when nothing had added them. */
    seen.add(name.toLowerCase());
    inFile.add(name.toLowerCase());
    creates.push({ name, email, kind });
  });
  return { creates, skips, errors };
}

/**
 * Securities: rows → { creates, newClasses, errors }. Creates carry
 * `stakeholderName` / `className` for the store to resolve at commit;
 * unknown class names are collected so the preview can offer to create
 * them, while an unknown stakeholder is a row error - import holders first.
 * So is a name more than one stakeholder answers to: a row that names two
 * people names neither, and issuing to one of them is a guess. A share-class
 * name two classes answer to is the same kind of guess.
 */
export function buildSecurityPlan(rows, mapping, { classes = [], stakeholders = [], securities = [], plans = [], splits = [] } = {}) {
  const creates = [];
  const errors = [];
  const plansByName = new Map();
  for (const p of plans) {
    const key = p.name.trim().toLowerCase();
    plansByName.set(key, [...(plansByName.get(key) || []), p]);
  }
  /* Rows that describe a security already on the cap table - same holder,
     kind, class, amount and date. Securities are not unique the way holders
     are (two identical grants on one day are two grants), so these are
     created rather than skipped; but a file imported twice doubled the cap
     table with nothing in the preview to say so, where the stakeholder plan
     names every holder it skips. Counted, so the preview can say it. */
  const holderIds = new Map();
  for (const h of stakeholders) {
    const key = h.name.trim().toLowerCase();
    holderIds.set(key, [...(holderIds.get(key) || []), h.id]);
  }
  const classIds = new Map();
  for (const c of classes) {
    const key = c.name.trim().toLowerCase();
    classIds.set(key, [...(classIds.get(key) || []), c.id]);
  }
  const repeats = (input) => securities.some((s) => s.kind === input.kind
    && (holderIds.get(input.stakeholderName.toLowerCase()) || []).includes(s.stakeholderId)
    && (!input.className || (classIds.get(input.className.toLowerCase()) || []).includes(s.classId))
    && (s.grantDate || s.date || '') === input.date
    && (input.kind === 'safe' || input.kind === 'note'
      ? Number(s.principal) === input.principal
      : Number(s.quantity) === input.quantity));
  let repeated = 0;
  const newClasses = new Set();
  // Offered once, in the first spelling seen: "Ordinary", "ordinary" and
  // "ORDINARY" are one class to the import, and were three offers.
  const newClassKeys = new Set();
  /* Counted, not just tested for existence: a name two people share picks out
     neither of them, and the file has no other way to say which one is meant.
     Resolved to whichever record came last, the shares landed on an arbitrary
     person and nothing in the preview said so. */
  const holderCounts = new Map();
  for (const h of stakeholders) {
    const key = h.name.trim().toLowerCase();
    holderCounts.set(key, (holderCounts.get(key) || 0) + 1);
  }
  /* Counted for the same reason holders are: two classes can carry one name -
     the class form allows it, and a "Series A" reissued on new terms arrives
     that way - but the file names the class and nothing else. Resolved to
     whichever was stored last, the shares landed in a class with a
     preference, participation and ratchet nobody chose. */
  const classCounts = new Map();
  for (const c of classes) {
    const key = c.name.trim().toLowerCase();
    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  }

  // Which way round the file's slashed dates read - see slashedDateOrder.
  const DATE_KEYS = ['date', 'vestingStart', 'filed83b', 'expires', 'maturityDate'];
  const order = slashedDateOrder(rows.flatMap((row) => DATE_KEYS.map((k) => cellAt(row, mapping[k]))));

  rows.forEach((row, i) => {
    const line = row.line ?? i + 2;
    const fail = (message) => { errors.push({ line, message }); };

    // Cut and trimmed like the stakeholder plan cuts the name it stores - see there.
    const holderName = cellAt(row, mapping.stakeholder).slice(0, STAKEHOLDER_NAME_MAX).trim();
    if (!holderName) return fail('Missing the stakeholder name');
    const holders = holderCounts.get(holderName.toLowerCase()) || 0;
    if (!holders) {
      return fail(`Unknown stakeholder "${holderName}" - import stakeholders first`);
    }
    if (holders > 1) {
      return fail(`${holders} stakeholders are named "${holderName}" - rename one so this row names a single holder`);
    }

    const kindRaw = cellAt(row, mapping.kind);
    const kind = aliasFor(SECURITY_KIND_ALIASES, normalizeHeader(kindRaw));
    if (!kind) return fail(`Unknown security type "${kindRaw}" (use shares, option, RSU, warrant, SAFE, or note)`);

    const date = toISODate(cellAt(row, mapping.date), order);
    if (date === null) {
      return fail(order === 'mixed' && SLASHED_DATE.test(cellAt(row, mapping.date))
        ? `Ambiguous date "${cellAt(row, mapping.date)}": this file mixes day-first and month-first dates (use YYYY-MM-DD)`
        : `Unreadable date "${cellAt(row, mapping.date)}" (use YYYY-MM-DD)`);
    }
    if (!date) return fail('Missing the date it was issued, granted, or signed');

    const input = { kind, stakeholderName: holderName, date };

    // A time-based award may credit service from a date other than grant.
    const awardStart = (months) => {
      const raw = cellAt(row, mapping.vestingStart);
      if (!raw) return true;
      const start = toISODate(raw, order);
      if (start === null) {
        fail(`Unreadable vesting start "${raw}"`);
        return false;
      }
      if (start && !(months > 0)) {
        fail('A vesting start needs a vesting period: fill in the vesting months or leave the start blank');
        return false;
      }
      if (start) input.vestingStart = start;
      return true;
    };

    /**
     * Columns a kind has no field for are refused rather than read past, when
     * what they hold would change the record's meaning. A warrant, SAFE, or
     * note carrying a vesting schedule imported as exercisable (or
     * convertible) in full from day one, an option row whose exercise price
     * sat in the Price column - one "Price" column serving every kind is how
     * spreadsheets are laid out - imported with a strike of nothing, and an
     * RSU row carrying a strike is an option under the wrong type, and a
     * certificate whose price sat in the Strike column imported at a price of
     * nothing. Each was dropped without a word in the preview. Blank and
     * zero pass: zero is what a spreadsheet writes in a cell that does not
     * apply.
     */
    const filled = (key) => {
      const raw = cellAt(row, mapping[key]);
      if (!raw) return false;
      const v = toNumber(raw);
      return Number.isNaN(v) || v !== 0;
    };
    if (kind === 'warrant' || kind === 'safe' || kind === 'note') {
      if (filled('vestingMonths') || filled('cliffMonths') || cellAt(row, mapping.vestingStart)) {
        const noun = kind === 'warrant' ? 'A warrant' : kind === 'safe' ? 'A SAFE' : 'A note';
        return fail(`${noun} has no vesting schedule: leave the vesting columns blank`);
      }
    }
    /* An 83(b) election is filed on restricted stock - shares that reverse-
       vest - and on nothing else. An award's own certificate carries its
       election once it is exercised early; the award row has nowhere for one. */
    if (kind !== 'shares' && cellAt(row, mapping.filed83b)) {
      return fail('An 83(b) election is filed on restricted stock, not on this kind of security: leave the 83(b) column blank');
    }
    if ((kind === 'option' || kind === 'warrant') && filled('price') && !filled('strike')) {
      return fail(`${kind === 'option' ? 'Options take their' : 'A warrant takes its'} exercise price from the `
        + 'Strike price column, and this row has a price but no strike');
    }
    if (kind === 'rsu' && filled('strike')) {
      return fail('An RSU has no strike: leave the strike column blank, or import the row as an option');
    }
    /* And a certificate has none either. A share price that landed in the
       Strike column - the mirror of the option row above - imported the
       certificate at a price of nothing, and the money the round raised with
       it, without a word in the preview. */
    if (kind === 'shares' && filled('strike')) {
      return fail('Shares have no strike: put the issue price in the Price per share column and leave '
        + 'the strike column blank, or import the row as an option or a warrant');
    }
    /* And the mirror of the option row's price-without-strike: "Amount" and
       "Investment" are aliases of the principal column, so a lawyer's sheet
       of certificates with their check sizes mapped its money there, the
       price column stayed blank, and every certificate imported at a price
       of nothing - no capital raised, no liquidation preference - with the
       preview saying the rows would be created. */
    if (kind === 'shares' && filled('principal') && !filled('price')) {
      return fail('Shares take their price from the Price per share column, and this row has an amount but no price');
    }
    /* The two deadline columns are the same slip in the other direction: a
       kind has one deadline or none, and a date in the other column was
       dropped without a word. A note whose maturity sat under Expires
       imported as a note that never matures, an option or warrant whose term
       sat under Maturity date as one that never expires - off the coming-up
       list and the needs-attention list alike - and a SAFE carrying a
       maturity or an interest rate is a note under the wrong type. Shares and
       RSU awards have neither deadline. */
    const expiresCell = cellAt(row, mapping.expires);
    const maturityCell = cellAt(row, mapping.maturityDate);
    if (kind === 'note' && expiresCell) {
      return fail('A note matures rather than expires: put the date in the Maturity date column and leave Expires blank');
    }
    if ((kind === 'option' || kind === 'warrant') && maturityCell) {
      return fail(`${kind === 'option' ? 'An option grant' : 'A warrant'} expires rather than matures: `
        + 'put the date in the Expires column and leave Maturity date blank');
    }
    if (kind === 'safe' && (maturityCell || filled('interestRate'))) {
      return fail('A SAFE has no maturity date and accrues no interest: leave those columns blank, or import the row as a note');
    }
    if ((kind === 'shares' || kind === 'rsu') && (expiresCell || maturityCell)) {
      return fail(`${kind === 'shares' ? 'Shares have' : 'An RSU award has'} no expiration or maturity date: leave those columns blank`);
    }

    if (kind === 'shares' || kind === 'option' || kind === 'rsu' || kind === 'warrant') {
      const quantity = toNumber(cellAt(row, mapping.quantity));
      if (quantity === null) return fail('Missing the quantity');
      // A count must survive the import exactly as written.
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return fail(`Quantity "${cellAt(row, mapping.quantity)}" must be a positive number of whole shares`);
      }
      // The record clamps a count past NUM_MAX; refused here, not clamped there. The guard
      // read the double's own ceiling, so 1,000,000,000,000,001 was previewed as created and stored short.
      if (quantity > NUM_MAX) {
        return fail(`Quantity "${cellAt(row, mapping.quantity)}" is more than a share count can hold`);
      }
      input.quantity = quantity;
    }

    if (kind === 'shares' || kind === 'warrant' || kind === 'rsu') {
      const className = cellAt(row, mapping.className).slice(0, CLASS_NAME_MAX).trim();
      const noun = kind === 'shares' ? 'certificate' : kind === 'warrant' ? 'warrant' : 'RSU award';
      // An RSU is a promise of shares in a particular class, so the class is
      // as required here as it is on a certificate.
      if (!className) return fail(`A ${noun} needs a share class`);
      const named = classCounts.get(className.toLowerCase()) || 0;
      if (named > 1) {
        return fail(`${named} share classes are named "${className}" - rename one so this row names a single class`);
      }
      input.className = className;
      if (!named && !newClassKeys.has(className.toLowerCase())) {
        newClassKeys.add(className.toLowerCase());
        newClasses.add(className);
      }
    }

    const num = (key, label, { max = Infinity, whole = false } = {}) => {
      const v = toNumber(cellAt(row, mapping[key]));
      if (v === null) return 0;
      if (whole && !Number.isInteger(v)) {
        fail(`${label} must be a whole number`);
        return null;
      }
      // NUM_MAX is where the record itself clamps a figure - refused here rather than clamped there.
      if (Number.isNaN(v) || v < 0 || v > Math.min(max, NUM_MAX)) {
        fail(`${label} "${cellAt(row, mapping[key])}" isn’t usable`);
        return null;
      }
      return v;
    };

    /**
     * The cliff, whole months, and never past the end of the schedule. The
     * form refuses a cliff that outlasts the vesting period - it would mean
     * the grant vests in full before its own cliff is reached - and the import
     * clamped it to the schedule's length without a word, so "60" in the cliff
     * column of a 48-month grant landed as 48. Null when the row fails.
     */
    const cliffWithin = (months) => {
      const cliff = num('cliffMonths', 'Cliff months', { whole: true });
      if (cliff === null) return null;
      if (months > 0 && Math.round(cliff) > Math.round(months)) {
        fail(`Cliff of ${Math.round(cliff)} months outlasts the ${Math.round(months)}-month vesting period`);
        return null;
      }
      return Math.round(cliff);
    };

    if (kind === 'shares') {
      const price = num('price', 'Price per share');
      if (price === null) return;
      input.pricePerShare = price;
      const months = num('vestingMonths', 'Vesting months', { whole: true, max: MAX_VESTING_MONTHS });
      if (months === null) return;
      /* Read whether or not the row vests. The column used to be read only
         once vesting months were given, so a founder row carrying a hire
         date and a blank vesting period imported a fully vested certificate
         with nothing in the preview to say the start had been dropped - the
         same silence the option rows used to keep about theirs. A start
         only means anything against a schedule, so without one it is
         refused rather than read past. */
      const start = toISODate(cellAt(row, mapping.vestingStart), order);
      if (start === null) return fail(`Unreadable vesting start "${cellAt(row, mapping.vestingStart)}"`);
      if (months > 0) {
        input.vestingMonths = Math.round(months);
        const cliff = cliffWithin(months);
        if (cliff === null) return;
        input.cliffMonths = cliff;
        input.vestingStart = start || date;
      } else if (start) {
        return fail('A vesting start needs a vesting period: fill in the vesting months or leave the start blank');
      }
      /* The election, held to the same window the certificate's own sheet
         holds it to: filed on or after issuance and inside the thirty days.
         The window is statutory and never extends, so a date outside it is a
         typo or a late election, and either way not a filing the record
         should report as made. A plain certificate has no election to file. */
      const filedRaw = cellAt(row, mapping.filed83b);
      if (filedRaw) {
        const filed = toISODate(filedRaw, order);
        if (filed === null) return fail(`Unreadable 83(b) filing date "${filedRaw}" (use YYYY-MM-DD)`);
        if (!(months > 0)) {
          return fail('An 83(b) election only applies to shares that vest: fill in the vesting months or leave the 83(b) column blank');
        }
        if (filed < date) return fail(`83(b) filed ${filed}, before the shares were issued on ${date}`);
        const deadline = deadline83b({ date });
        if (filed > deadline) {
          return fail(`83(b) filed ${filed}, after the ${DAYS_83B}-day window that closed on ${deadline}`);
        }
        input.filed83b = filed;
      }
    } else if (kind === 'option') {
      const strike = num('strike', 'Strike price');
      if (strike === null) return;
      input.strike = strike;
      input.grantDate = date;
      const months = num('vestingMonths', 'Vesting months', { whole: true, max: MAX_VESTING_MONTHS });
      if (months === null) return;
      if (!awardStart(months)) return;
      input.vestingMonths = Math.round(months);
      const cliff = cliffWithin(months);
      if (cliff === null) return;
      input.cliffMonths = Math.min(Math.round(months), cliff);
      const expires = toISODate(cellAt(row, mapping.expires), order);
      if (expires === null) return fail(`Unreadable expiration "${cellAt(row, mapping.expires)}"`);
      if (!afterIssue(expires, date)) {
        return fail(`Expiration "${expires}" is not after the grant date ${date}`);
      }
      if (expires) input.expires = expires;
      // "ISO" / "NSO" typed in the security-type column carries through.
      if (normalizeHeader(kindRaw).includes('iso') && !normalizeHeader(kindRaw).includes('nso')) {
        input.optionType = 'iso';
      }
    } else if (kind === 'rsu') {
      // No strike and no expiry: an award vests, then settles into shares.
      input.grantDate = date;
      const months = num('vestingMonths', 'Vesting months', { whole: true, max: MAX_VESTING_MONTHS });
      if (months === null) return;
      if (!awardStart(months)) return;
      input.vestingMonths = Math.round(months);
      const cliff = cliffWithin(months);
      if (cliff === null) return;
      input.cliffMonths = Math.min(Math.round(months), cliff);
    } else if (kind === 'warrant') {
      const strike = num('strike', 'Strike price');
      if (strike === null) return;
      input.strike = strike;
      const expires = toISODate(cellAt(row, mapping.expires), order);
      if (expires === null) return fail(`Unreadable expiration "${cellAt(row, mapping.expires)}"`);
      if (!afterIssue(expires, date)) {
        return fail(`Expiration "${expires}" is not after the issue date ${date}`);
      }
      if (expires) input.expires = expires;
    } else {
      const principal = toNumber(cellAt(row, mapping.principal));
      if (principal === null || principal <= 0) {
        return fail(`A ${kind === 'safe' ? 'SAFE' : 'note'} needs a positive principal`);
      }
      // Unreadable, or past what the record holds: the cap and discount
      // columns are refused the same way, and this one was clamped in silence.
      if (Number.isNaN(principal) || principal > NUM_MAX) {
        return fail(`Principal "${cellAt(row, mapping.principal)}" isn’t usable`);
      }
      input.principal = principal;
      const cap = num('cap', 'Valuation cap');
      if (cap === null) return;
      input.valuationCap = cap;
      const discount = num('discount', 'Discount', { max: 99 });
      if (discount === null) return;
      input.discount = discount;
      if (kind === 'safe') {
        const safeType = safeTypeFrom(cellAt(row, mapping.safeType));
        if (!safeType) {
          return fail(`Unknown SAFE cap type "${cellAt(row, mapping.safeType)}" (use pre or post)`);
        }
        input.safeType = safeType;
      }
      if (kind === 'note') {
        const interest = num('interestRate', 'Interest rate', { max: 50 });
        if (interest === null) return;
        input.interestRate = interest;
        const maturity = toISODate(cellAt(row, mapping.maturityDate), order);
        if (maturity === null) return fail(`Unreadable maturity date "${cellAt(row, mapping.maturityDate)}"`);
        if (!afterIssue(maturity, date)) {
          return fail(`Maturity "${maturity}" is not after the issue date ${date}`);
        }
        if (maturity) input.maturityDate = maturity;
      }
    }

    /* Which plan the award draws from. A named plan has to be on file and
       able to hold the award; a blank cell takes the one plan that could,
       and refuses the guess when several could. A certificate, warrant, SAFE
       or note is granted under no plan, so a cell on such a row is a column
       mapped one across. */
    const planCell = cellAt(row, mapping.plan);
    if (kind === 'option' || kind === 'rsu') {
      const noun = kind === 'rsu' ? 'RSU award' : 'option grant';
      if (planCell && NO_PLAN.test(planCell)) {
        input.outsidePlan = true;
      } else if (planCell) {
        const named = plansByName.get(planCell.slice(0, PLAN_NAME_MAX).trim().toLowerCase()) || [];
        if (!named.length) {
          return fail(`Unknown plan "${planCell}" - adopt it under Share classes first, or write "none" for an award outside any plan`);
        }
        if (named.length > 1) return fail(`${named.length} plans are named "${planCell}" - rename one so this row names a single plan`);
        if (!planAccepts(named[0], kind, date)) return fail(planRefusal(named[0], kind, date).replace(/\.$/, ''));
        input.planId = named[0].id;
      } else if (plans.length) {
        const { planId, candidates } = resolvePlan({ kind, date, grantDate: date }, plans);
        if (planId) {
          const inferred = plans.find((p) => p.id === planId);
          if (!planAccepts(inferred, kind, date)) return fail(planRefusal(inferred, kind, date).replace(/\.$/, ''));
          input.planId = planId;
        }
        else if (candidates.length > 1) {
          return fail(`${candidates.length} plans could hold this ${noun} (${candidates.map((p) => p.name).join(', ')}): `
            + 'name one in a Plan column, or write "none" for an award outside any plan');
        } else {
          return fail(`No plan on file can hold an ${noun} dated ${date}: write "none" in a Plan column to import it outside any plan`);
        }
      }
    } else if (planCell) {
      const noun = kind === 'shares' ? 'Shares are' : kind === 'warrant' ? 'A warrant is' : kind === 'safe' ? 'A SAFE is' : 'A note is';
      return fail(`${noun} not granted under an equity plan: leave the Plan column blank`);
    }

    try {
      for (const [key, validate] of Object.entries({ proRata: validateProRata, mfn: validateMFN, dividendEvents: validateDividendEvents, economicBasis: validateBasis })) {
        const raw = cellAt(row, mapping[key]);
        if (!raw) continue;
        if (key === 'mfn' && kind !== 'safe' && kind !== 'note') return fail('MFN terms require a SAFE or note');
        if ((key === 'economicBasis' || key === 'dividendEvents') && kind !== 'shares') return fail('Dividend terms require a share certificate');
        input[key] = validate(JSON.parse(raw));
        /* The same rule the security sheet follows: an election is derived
           from a source on file, never typed in. A row that carries one would
           otherwise land elected terms nothing has checked. */
        if (key === 'mfn' && input.mfn.elections.length) return fail('MFN elections cannot be imported: record the clause, then elect from the security sheet');
      }
    } catch (err) { return fail(`Invalid financing terms: ${err.message}`); }
    if (repeats(input)) repeated += 1;
    creates.push(input);
  });

  /* Every figure typed into the app is in today's units, a row dated before
     a recorded split included - the issue and edit sheets say so beside the
     date, and the preview says it here: a historical spreadsheet imported
     after a 2-for-1 landed at half the intended shares without a word. */
  const latest = [...splits].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const presplit = latest ? creates.filter((c) => c.date && c.date < latest.date).length : 0;
  return { creates, newClasses: [...newClasses], errors, repeated, presplit: presplit ? { rows: presplit, split: latest } : null };
}

/* ---------- Templates ---------- */

/* Every holder the securities template names, in the order that template
   introduces them. The two files are handed out side by side and the wizard
   says to import this one first, so a name here that is missing there fails a
   row of the user's very first import against the app's own examples. */
export const STAKEHOLDER_TEMPLATE = [
  ['Name', 'Email', 'Type'],
  ['Ada Chen', 'ada@example.com', 'Founder'],
  ['Nova Ventures', '', 'Investor'],
  ['Sam Rivera', 'sam@example.com', 'Employee'],
  ['Priya Nair', 'priya@example.com', 'Employee'],
];

export const SECURITY_TEMPLATE = [
  ['Stakeholder', 'Type', 'Share class', 'Quantity', 'Price per share', 'Strike price',
    'Principal', 'Valuation cap', 'Discount', 'Interest rate', 'SAFE cap type', 'Date',
    'Vesting months', 'Cliff months', 'Vesting start', 'Expires', 'Maturity date', '83(b) filed', 'Plan',
    'Pro-rata rights JSON', 'MFN JSON', 'Dividend events JSON', 'Economic basis JSON'],
  // Founder restricted stock, with the election that keeps it off the needs-attention list.
  ['Ada Chen', 'Shares', 'Common Stock', '4000000', '0.0001', '', '', '', '', '', '', '2023-05-20', '48', '12', '', '', '', '2023-06-02', '', '', '', '', ''],
  // A blank plan takes the company's one plan; a name picks one of several; "none" is outside every plan.
  ['Sam Rivera', 'Option', '', '120000', '', '0.09', '', '', '', '', '', '2024-07-01', '48', '12', '', '2034-07-01', '', '', '', '', '', '', ''],
  ['Priya Nair', 'RSU', 'Common Stock', '20000', '', '', '', '', '', '', '', '2026-01-15', '48', '12', '', '', '', '', '', '', '', '', ''],
  ['Nova Ventures', 'SAFE', '', '', '', '', '250000', '8000000', '20', '', 'post', '2025-11-05', '', '', '', '', '', '', '', '', '', '', ''],
  ['Nova Ventures', 'Note', '', '', '', '', '150000', '10000000', '15', '8', '', '2026-02-01', '', '', '', '', '2027-08-01', '', '', '', '', '', ''],
];

/**
 * The classes a planned import would take past their authorized count, one
 * `{ name, issued, authorized, over }` each, from the certificates the plan
 * creates - summed per class, against the class as it stands. A class the
 * file names that is not on file yet has no count to run past, and a name
 * that matches two classes was refused by the planner already.
 */
export function authorizedOverruns(db, creates) {
  const byName = new Map();
  for (const c of creates) {
    if (c.kind !== 'shares' || !c.className) continue;
    const key = c.className.toLowerCase();
    byName.set(key, (byName.get(key) || 0) + Math.max(0, Math.round(Number(c.quantity) || 0)));
  }
  const out = [];
  for (const [key, quantity] of byName) {
    const named = (db.classes || []).filter((c) => c.name.toLowerCase() === key);
    if (named.length !== 1) continue;
    const hit = authorizedOverrun(db, named[0].id, quantity);
    if (hit && hit.over > 0) out.push(hit);
  }
  return out;
}
