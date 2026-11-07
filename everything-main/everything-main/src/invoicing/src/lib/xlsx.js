/**
 * Reading an Excel workbook, without a dependency.
 *
 * An .xlsx file is a ZIP of small XML parts, and the two hard pieces are
 * already in the platform: DecompressionStream inflates the entries, and the
 * XML that Excel and Google Sheets write is machine-generated and regular
 * enough for a purpose-built scanner. parseXlsx() reads the workbook's first
 * sheet into exactly the { header, rows } shape parseCsv() produces, so
 * everything downstream — column mapping, validation, previews — cannot tell
 * the two apart.
 *
 * Deliberately not a general reader: strings (shared, inline, and rich text),
 * numbers, and booleans come through; formula cells yield their cached
 * result. A number is rendered the way its cell displays it in the two
 * cases the imports depend on: a date-styled cell reads as the date it
 * shows (Excel stores 1 Sep 2025 as the serial 45901, and the invoice
 * wizard maps issue and due dates), and a percent-styled cell reads as the
 * percentage (0.2 shows as 20%, and a client sheet's tax-rate column is a
 * percentage). Everything else stays the stored number.
 */

import { parseCsv } from './csv.js';

/* ---------- ZIP ---------- */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
// The high byte is added, not shifted: (x << 24) flips the sign bit on a
// 4 GB-adjacent offset, and a negative offset reads nothing.
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

/** Does this byte buffer start like a ZIP archive (which an .xlsx is)? */
export function isZip(bytes) {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * A ZIP's entries never lie past this uncompressed size here: the parts of a
 * real workbook are kilobytes, and a crafted archive claiming gigabytes must
 * be refused before it is inflated, not after.
 */
const MAX_PART_BYTES = 50 * 1024 * 1024;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The archive's entries, by name, read lazily: { name -> () => Promise<text> }.
 * Walks the central directory (found from the end-of-central-directory
 * record, scanned backwards past any archive comment), because the local
 * headers alone cannot be trusted for sizes when bit 3 deferred them.
 */
function zipEntries(bytes) {
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error('central directory out of step');
    const method = u16(bytes, at + 10);
    const compSize = u32(bytes, at + 20);
    const uncompSize = u32(bytes, at + 24);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const localAt = u32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, async () => {
      if (uncompSize > MAX_PART_BYTES) throw new Error('part too large');
      if (u32(bytes, localAt) !== 0x04034b50) throw new Error('local header out of step');
      // The local header's own name/extra lengths, not the central copy:
      // writers pad the two differently.
      const dataAt = localAt + 30 + u16(bytes, localAt + 26) + u16(bytes, localAt + 28);
      const data = bytes.subarray(dataAt, dataAt + compSize);
      if (method === 0) return decoder.decode(data);
      if (method === 8) return decoder.decode(await inflate(data));
      throw new Error(`unsupported compression method ${method}`);
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ---------- XML ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/**
 * The text of one string container: every <t> run concatenated, so plain
 * strings and rich text read the same. Phonetic guides (<rPh>, Japanese
 * furigana) are annotations, not content, and are dropped first.
 */
function textOf(fragment) {
  // Every tag pattern here keeps its attribute run lazy: a greedy [^>]* eats
  // the slash of a self-closing tag, the "/>" branch then fails, and the
  // ">…</t>" branch runs on to the NEXT element's closing tag — an empty
  // run swallowed the run after it, and (below) a blank styled cell
  // swallowed its neighbour's value.
  const clean = fragment.replace(/<rPh\b[^>]*?(?:\/>|>[\s\S]*?<\/rPh>)/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXml(m[1] ?? '');
  return out;
}

/** 'BC12' -> 54: the column a cell reference names, zero-based. */
function colOf(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i) & ~32;   // fold case
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * A stored number, as a person would have typed it: Excel serializes float
 * noise ("1234.5599999999999" for a cell showing 1234.56), and ten decimal
 * places is finer than anything billable while still absorbing the noise.
 */
function cleanNumber(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(Math.round(n * 1e10) / 1e10);
}

/* ---------- Number formats ---------- */

/**
 * The kind of reading a cell style gives a number: 'date', 'datetime',
 * 'time', 'percent', or null for a plain number. Excel never writes its
 * built-in formats into styles.xml, so their ids are known here; custom
 * formats (ids from 164) are classified from their format code.
 */
const BUILTIN_KIND = {
  9: 'percent', 10: 'percent',
  14: 'date', 15: 'date', 16: 'date', 17: 'date',
  18: 'time', 19: 'time', 20: 'time', 21: 'time',
  22: 'datetime',
  // The East Asian locale formats: dates, but for the two clock times.
  27: 'date', 28: 'date', 29: 'date', 30: 'date', 31: 'date', 32: 'time', 33: 'time',
  34: 'date', 35: 'date', 36: 'date',
  45: 'time', 46: 'time', 47: 'time',
  50: 'date', 51: 'date', 52: 'date', 53: 'date', 54: 'date', 55: 'date', 56: 'date',
  57: 'date', 58: 'date',
};

/**
 * What a custom format code shows. Literal text ("hrs"), colour, locale and
 * condition brackets ([Red], [$-409], [>100]) and escaped or padded
 * characters (\-, _), *-) are not tokens and are dropped first; an
 * elapsed-time bracket ([h], [mm], [ss]) is a token and keeps its letter.
 * Then d and y are only ever date tokens, h and s only ever time tokens, and
 * an m is a minute beside h or s and a month otherwise.
 */
function formatKind(code) {
  const bare = String(code)
    .replace(/"[^"]*"/g, '')
    .replace(/\[(h+|m+|s+)\]/gi, '$1')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\\_*]./g, '');
  if (bare.includes('%')) return 'percent';
  const time = /[hs]/i.test(bare);
  const date = /[dy]/i.test(bare) || (!time && /m/i.test(bare));
  if (date && time) return 'datetime';
  if (date) return 'date';
  if (time) return 'time';
  return null;
}

/** The kind of every cell style, by the index a cell's s="…" refers to. */
function styleKinds(stylesXml) {
  if (!stylesXml) return [];
  const custom = new Map();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = m[0].match(/\bnumFmtId="(\d+)"/)?.[1];
    const code = m[0].match(/\bformatCode="([^"]*)"/)?.[1];
    if (id !== undefined && code !== undefined) custom.set(Number(id), formatKind(decodeXml(code)));
  }
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(m[0].match(/\bnumFmtId="(\d+)"/)?.[1] ?? 0);
    return custom.has(id) ? custom.get(id) : (BUILTIN_KIND[id] ?? null);
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
// Serial day 0 is 30 Dec 1899 (Excel counts a 29 Feb 1900 that never was);
// a workbook on the 1904 system starts 1,462 days later.
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/**
 * A stored number as its cell displays it — a date, a time, a percentage —
 * or, for a plain style, as cleanNumber reads it. A serial no calendar can
 * hold (negative, or past the year 9999) falls back to the number, which
 * the import then refuses by name instead of storing a fiction.
 */
function displayNumber(raw, kind, date1904) {
  if (!kind) return cleanNumber(raw);
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (kind === 'percent') return cleanNumber(n * 100);
  let days = Math.floor(n);
  // The seconds shown, rounded like Excel rounds them; a rounding that lands
  // on midnight belongs to the next day.
  let secs = Math.round((n - days) * 86_400);
  if (secs === 86_400) { secs = 0; days += 1; }
  const time = `${pad2(Math.floor(secs / 3600))}:${pad2(Math.floor(secs / 60) % 60)}`;
  if (kind === 'time') return time;
  const at = new Date(EPOCH_1900 + (days + (date1904 ? 1462 : 0)) * DAY_MS);
  const year = at.getUTCFullYear();
  if (n < 0 || !Number.isFinite(year) || year > 9999) return cleanNumber(raw);
  const date = `${year}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
  return kind === 'datetime' ? `${date} ${time}` : date;
}

/**
 * The path of the workbook's first visible sheet, resolved through its rels.
 * Excel opens on the first tab that is not hidden, and that is the sheet the
 * user means: a template's hidden "Lookups" tab listed first is not what
 * they see, and the wizard offers no way to pick another.
 */
function firstSheetPath(entriesText) {
  const { workbook, rels } = entriesText;
  const sheets = [...(workbook?.matchAll(/<sheet\b[^>]*>/g) ?? [])].map((m) => m[0]);
  const sheet = sheets.find((t) => !/\bstate="(?:hidden|veryHidden)"/.test(t)) || sheets[0];
  const rid = sheet?.match(/\br:id="([^"]+)"/)?.[1];
  const rel = rid && rels
    ? [...rels.matchAll(/<Relationship\b[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => tag.includes(`Id="${rid}"`))
    : null;
  const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/* ---------- The workbook ---------- */

/**
 * parseXlsx(bytes) -> { header, rows } — the first sheet, shaped exactly as
 * parseCsv shapes a file: the first non-empty row is the header, every other
 * row is padded or cut to its width, cells are trimmed strings, and rows
 * with nothing in them do not exist. Throws on anything that is not a
 * readable workbook; the caller owns the wording of that refusal.
 */
export async function parseXlsx(bytes) {
  const entries = zipEntries(bytes);
  const read = (name) => (entries.has(name) ? entries.get(name)() : Promise.resolve(''));
  if (!entries.has('xl/workbook.xml')) throw new Error('not a workbook');

  const workbookXml = await read('xl/workbook.xml');
  const sheetPath = firstSheetPath({
    workbook: workbookXml,
    rels: await read('xl/_rels/workbook.xml.rels'),
  });
  const sheetXml = await (entries.has(sheetPath) ? entries.get(sheetPath)() : read('xl/worksheets/sheet1.xml'));
  if (!sheetXml) throw new Error('no worksheet');
  // How a number shows depends on its cell's style, and a date serial on the
  // workbook's date system (Mac Excel wrote the 1904 one for years).
  const kinds = styleKinds(await read('xl/styles.xml'));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbookXml);

  const sst = [];
  for (const m of (await read('xl/sharedStrings.xml')).matchAll(/<si(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    sst.push(textOf(m[1] ?? ''));
  }

  const grid = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1] ?? '';
    const cells = [];
    let at = -1;   // a cell without its own reference follows its neighbour
    // Excel writes every blank cell that carries a border, fill or number
    // format as a self-closing <c r="B2" s="1"/>; see textOf on why the
    // attribute run must stay lazy.
    for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const inner = m[2] ?? '';
      const ref = attrs.match(/\br="([A-Za-z]+\d+)"/)?.[1];
      at = ref ? colOf(ref) : at + 1;
      const type = attrs.match(/\bt="(\w+)"/)?.[1] || '';
      let value;
      if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const raw = decodeXml(inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? '');
        // An empty <v> on a shared-string cell must not index as Number('')
        // — that is 0, which is a real string in the table.
        const style = attrs.match(/\bs="(\d+)"/)?.[1];
        value = type === 's' ? (raw === '' ? '' : sst[Number(raw)] ?? '')
          : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE')
          : type === 'str' || type === 'e' ? raw
          : raw === '' ? '' : displayNumber(raw, style === undefined ? null : kinds[Number(style)] ?? null, date1904);
      }
      if (at >= 0) cells[at] = String(value).trim();
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    // A row of nothing is not a record, exactly as parseCsv treats a blank
    // line — the header is the first row that says anything.
    if (cells.some((v) => v)) grid.push(cells);
  }

  const header = grid.shift() || [];
  const width = header.length;
  const rows = grid.map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });
  return { header, rows };
}

/* ---------- One reader for whatever was picked ---------- */

/**
 * readTabularFile(file) -> { header, rows } or { problem } — a picked File
 * as tabular data, whichever way it was saved: CSV or TSV text, or an .xlsx
 * workbook read directly. The formats that need a different export are
 * named for what they are instead of failing as unreadable text.
 */
export async function readTabularFile(file) {
  const name = String(file?.name || '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A Numbers document is a ZIP too, so its name is the only early tell.
  if (/\.numbers$/i.test(name)) {
    return { problem: 'That is a Numbers document. In Numbers, use File → Export To → Excel or CSV, then pick that file' };
  }
  if (isZip(bytes) || /\.xlsx$/i.test(name)) {
    try {
      return await parseXlsx(bytes);
    } catch {
      return { problem: 'That workbook could not be read. Export the sheet as CSV and pick that file instead' };
    }
  }
  // Legacy binary Office (.xls and friends) opens with D0 CF 11 E0.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    return { problem: 'That is an old-format Excel (.xls) file. Save it as .xlsx or CSV first' };
  }
  const lenient = new TextDecoder().decode(bytes);
  // A replacement character in the first position is binary data, not a
  // damaged CSV: refuse it as a format rather than mapping garbled columns.
  if (lenient.charCodeAt(0) === 0xfffd) {
    return { problem: 'That file is not a spreadsheet this app can read. Export it as CSV first' };
  }
  let text = lenient;
  if (lenient.includes('\ufffd')) {
    // Windows Excel's plain "CSV (Comma delimited)" writes the system code
    // page, not UTF-8, and Windows-1252 is what Western European exports
    // carry. Decoded as UTF-8 every accented byte became U+FFFD, so "Müller
    // GmbH" was imported and stored as "M\ufffdller GmbH" with the wizard
    // reporting success. Only a file that is not valid UTF-8 is re-read:
    // one that genuinely carries a replacement character is left alone.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  return parseCsv(text);
}
