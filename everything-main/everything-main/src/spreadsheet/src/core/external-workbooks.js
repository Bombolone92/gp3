import { normalizeExternalVisibility } from './external-visibility.js';
import { LOCALES } from './format.js';
import { fixedArraySize } from './fixed-arrays.js';
import { rebaseWorkbookTarget } from './workbook-location.js';
import { mapFormulaRefs, parseRefText, quoteSheet, sheetKey } from './refs.js';
import { tokenize, isWorkbookNameScope, isExternalFormulaToken } from './formula/tokenizer.js';
import { fromFileFormula } from './xlfn.js';

const fail = reason => { throw new Error(`Invalid external workbook cache: ${reason}`); };

/** A native cell's last result is separate from the supporting-cell cache.
 * It belongs only to the exact formula saved with it, never to a later edit. */
export function savedExternalResult(cell) {
  const result = cell?.externalResult;
  if (!result || typeof cell.f !== 'string' || typeof result.formula !== 'string') return null;
  if (result.formula !== cell.f) {
    // Reference serializers may add optional sheet-name quotes.
    if (result.formula.length > 8192 || cell.f.length > 8192) return null;
    try {
      if (mapFormulaRefs(result.formula, ref => ref) !== mapFormulaRefs(cell.f, ref => ref)) return null;
    } catch { return null; }
  }
  const valid = value => value == null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string' && value.length <= 32767
    || typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.error === 'string' && value.error.length <= 64;
  const clone = value => value && typeof value === 'object' ? { error: value.error } : value ?? null;
  if (!valid(result.value)) return null;
  const out = { formula: cell.f, value: clone(result.value) };
  if (result.context != null) {
    const context = result.context;
    if (typeof context !== 'object' || Array.isArray(context)) return null;
    for (const [key, value] of Object.entries(context)) {
      if (key === 'r' || key === 'c') {
        if (!Number.isInteger(value) || value < 0 || value >= (key === 'r' ? 1048576 : 16384)) return null;
      } else if (key === 'sources') {
        if (!Array.isArray(value) || value.length > 1048576) return null;
        let size = 0;
        if (value.some(source => typeof source !== 'string' || !source || source.length > 32767 || (size += source.length) > 64 * 1024 * 1024)) return null;
      } else if (key === 'locale') {
        if (!LOCALES.some(([locale]) => locale === value)) return null;
      } else if (key === 'compatibilityVersion') {
        if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) return null;
      } else if (key === 'count' || key === 'index') {
        if (!Number.isSafeInteger(value) || value < 1) return null;
      } else if (key === 'sheetName') {
        if (typeof value !== 'string' || value.length > 32767) return null;
      } else if (!['order', 'names', 'inputs'].includes(key) || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return null;
    }
    out.context = { ...context, ...(context.sources ? { sources: [...context.sources] } : {}) };
  }
  if (result.array != null) {
    const size = fixedArraySize(result.array), cells = result.array.cells;
    if (!size || !cells || typeof cells !== 'object' || Array.isArray(cells)) return null;
    const entries = Object.entries(cells);
    if (entries.length > 1048576) return null;
    const values = {};
    let text = 0;
    for (const [key, value] of entries) {
      if (!/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key) || key === '0,0' || !valid(value)) return null;
      const [r, c] = key.split(',').map(Number);
      if (r >= size.rows || c >= size.cols || (text += typeof value === 'string' ? value.length : 0) > 64 * 1024 * 1024) return null;
      values[key] = clone(value);
    }
    out.array = { ...size, cells: values };
  }
  return out;
}

/** Sparse native output cells exposed in the evaluator's normal range shape. */
export function savedExternalRange(result) {
  if (!result.array) return result.value;
  const { rows, cols, cells } = result.array, values = [];
  values.length = rows;
  values[0] = []; values[0].length = cols; values[0][0] = result.value;
  for (const [key, value] of Object.entries(cells)) {
    const [r, c] = key.split(',').map(Number);
    if (!values[r]) values[r] = [];
    values[r][c] = value;
  }
  return { range: true, values };
}

/** Renumbering workbook links changes their spelling, not the formula's result. */
export function reindexExternalCell(cell, map) {
  if (cell?.f == null) return cell;
  const f = map(cell.f), result = savedExternalResult(cell);
  return { ...cell, f, ...(result ? { externalResult: { ...result, formula: f } } : {}) };
}
/** External links are ordered: [1] addresses the first supporting workbook.
 * A missing sheet cache differs from a cached empty sheet. No network reads are
 * implied by this data; it is the supporting-cell cache stored in the file. */
export function normalizeExternalWorkbooks(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.books) || value.books.length > 1024) fail('books');
  let cells = 0, textSize = 0, visibilityEntries = 0;
  const text = (v, max = 32767) => {
    if (typeof v !== 'string' || v.length > max || (textSize += v.length) > 64 * 1024 * 1024) fail('text limit');
    return v;
  };
  return { version: 1, books: value.books.map(book => {
    if (!book || typeof book !== 'object') fail('book');
    if (book.relationships != null && (!Array.isArray(book.relationships) || book.relationships.length > 1024)) fail('relationships');
    const ids = new Set();
    const relationships = (book.relationships || []).map(r => {
      if (!r || typeof r !== 'object') fail('relationship');
      const id = text(r.id), type = text(r.type), target = text(r.target);
      if (!id || ids.has(id) || !type.trim() || !target.trim()) fail('relationship');
      ids.add(id); return { id, type, target };
    });
    const extra = relationships.length ? { relationships } : {};
    if (book.kind === 'dde' || book.kind === 'ole') {
      if (book.kind === 'dde' && relationships.length) fail('DDE relationships');
      const xml = text(book.xml, 16 * 1024 * 1024);
      if (!xml.trim()) fail('missing link XML');
      const target = book.kind === 'ole' ? text(book.target) : null;
      if (target != null && !target.trim()) fail('missing target');
      return { kind: book.kind, xml, ...extra, ...(target == null ? {} : { target }), sheets: [], names: [] };
    }
    if (book.kind != null) fail('link kind');
    const target = text(book.target); if (!target.trim()) fail('missing target');
    if (!Array.isArray(book.sheets) || book.sheets.length > 65536) fail('sheets');
    const seen = new Set();
    const sheets = book.sheets.map(sheet => {
      if (!sheet || typeof sheet !== 'object') fail('sheet');
      const name = text(sheet.name); if (!name || seen.has(sheetKey(name))) fail('sheet name'); seen.add(sheetKey(name));
      let values = null;
      if (sheet.cells != null) {
        if (typeof sheet.cells !== 'object' || Array.isArray(sheet.cells)) fail('cells');
        values = {};
        for (const [key, v] of Object.entries(sheet.cells)) {
          if (++cells > 1048576 || !/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key)) fail('cell limit or coordinate');
          const [r, c] = key.split(',').map(Number); if (r >= 1048576 || c >= 16384) fail('cell bounds');
          if (v == null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) values[key] = v;
          else if (typeof v === 'string') values[key] = text(v);
          else if (typeof v === 'object' && Object.keys(v).length === 1 && typeof v.error === 'string') values[key] = { error: text(v.error, 64) };
          else fail('cell value');
        }
      }
      const visibility = normalizeExternalVisibility(sheet.visibility);
      if (visibility && (visibilityEntries += Object.values(visibility).reduce((n, entries) => n + entries.length, 0)) > 4 * 1048576) fail('visibility limit');
      return { name, cells: values, ...(visibility ? { visibility } : {}), ...(sheet.refreshError === true ? { refreshError: true } : {}) };
    });
    if (book.names != null && (!Array.isArray(book.names) || book.names.length > 65536)) fail('names');
    const nameKeys = new Set();
    const names = (book.names || []).map(n => {
      if (!n || typeof n !== 'object') fail('name');
      const name = text(n.name), key = JSON.stringify([n.sheet ?? null, sheetKey(name)]);
      if (!name || nameKeys.has(key)) fail('duplicate or empty name');
      nameKeys.add(key);
      if (n.sheet != null && (!Number.isInteger(n.sheet) || n.sheet < 0 || n.sheet >= sheets.length)) fail('name scope');
      return { name, ref: text(n.ref), ...(n.sheet == null ? {} : { sheet: n.sheet }) };
    });
    return { target, sheets, names, ...extra, ...(book.xml == null ? {} : { xml: text(book.xml, 16 * 1024 * 1024) }) };
  }) };
}

export function externalWorkbookScope(value, name) {
  const match = /^\[([1-9]\d*)\]([\s\S]*)$/.exec(name || '');
  if (!match) return null;
  const index = Number(match[1]) - 1, book = value?.books[index];
  if (!book) return null;
  if (!match[2]) return { index, book, sheet: null };
  const sheet = book.sheets.find(s => sheetKey(s.name) === sheetKey(match[2]));
  return sheet ? { index, book, sheet } : null;
}

export function externalWorkbookSheet(value, name) {
  const resolved = externalWorkbookScope(value, name);
  return resolved?.sheet ? resolved : null;
}

/** Definitions belong to the supporting workbook's namespace. Qualify their
 * sheet references when exposing them to the destination evaluator. */
export function externalNamedEntries(value, scope) {
  const resolved = externalWorkbookScope(value, scope);
  if (!resolved) return new Map();
  const { book, index, sheet } = resolved, sheetIndex = sheet ? book.sheets.indexOf(sheet) : -1;
  const entries = new Map();
  const qualify = name => isWorkbookNameScope(name) ? `[${index + 1}]`
    : name && name !== '#REF!' && !name.startsWith('[') ? `[${index + 1}]${name}` : name;
  const names = book.names || [];
  const definitions = [...names.filter(n => n.sheet == null), ...names.filter(n => n.sheet === sheetIndex)];
  const defined = new Set(definitions.map(n => n.name.toUpperCase()));
  for (const entry of definitions) {
    let relative = false;
    const ref = mapFormulaRefs(fromFileFormula(entry.ref.replace(/^=/,''), defined), ref => {
      if ((ref.kind !== 'cols' && (!ref.absR1 || !ref.absR2)) || (ref.kind !== 'rows' && (!ref.absC1 || !ref.absC2))) relative = true;
      return { ...ref, sheet: qualify(ref.sheet || sheet?.name || '#REF!') };
    }, token => `${quoteSheet(qualify(token.sheet))}!${token.value}`);
    entries.set(entry.name.toLowerCase(), { name: entry.name, ref, ...(relative ? { relative: true } : {}) });
  }
  return entries;
}

/** The workbook index prefixes the whole native 3D span, not its last sheet. */
export function externalWorkbookSpan(value, first, last) {
  const start = externalWorkbookSheet(value, first);
  if (!start) return null;
  const qualified = /^\[([1-9]\d*)\]([\s\S]+)$/.exec(last || '');
  if (qualified && Number(qualified[1]) !== start.index + 1) return null;
  const endName = qualified ? qualified[2] : last;
  const a = start.book.sheets.indexOf(start.sheet), b = start.book.sheets.findIndex(s => sheetKey(s.name) === sheetKey(endName));
  if (b < 0) return null;
  return { index: start.index, sheets: start.book.sheets.slice(Math.min(a,b), Math.max(a,b) + 1) };
}

/** Native formulas can retain a valid link even when its source cache is
 * unavailable; the worksheet's last calculated result remains separate. */
export function externalFormulaHasLinks(formula, value) {
  let tokens; try { tokens = tokenize(formula); } catch { return false; }
  let found = false;
  for (const token of tokens) {
    if (!isExternalFormulaToken(token)) continue;
    const match = /^\[([1-9]\d*)\]/.exec(token.sheet);
    if (!match || !value?.books[Number(match[1]) - 1]) return false;
    found = true;
  }
  return found;
}

/** Only admit formulas whose external references have supporting cell caches.
 * Unknown filename aliases and unavailable named links retain the legacy cached
 * formula-result path until they can be resolved without inventing a source. */
export function externalFormulaHasCaches(formula, value) {
  let tokens; try { tokens = tokenize(formula); } catch { return false; }
  let found = false;
  for (const token of tokens) {
    if (!isExternalFormulaToken(token)) continue;
    found = true;
    const match = externalWorkbookScope(value, token.sheet);
    if (!match) return false;
    if (token.type === 'name') {
      if (!externalNamedEntries(value, token.sheet).has(token.value.toLowerCase())
        || match.book.sheets.some(s => s.cells == null || s.refreshError)) return false;
      continue;
    }
    if (token.type !== 'ref' || !match.sheet || match.sheet.cells == null || match.sheet.refreshError
      || !parseRefText(token.text, token.sheet)) return false;
    if (token.sheetEnd) {
      const span = externalWorkbookSpan(value, token.sheet, token.sheetEnd);
      if (!span || span.sheets.some(sheet => sheet.cells == null || sheet.refreshError)) return false;
    }
  }
  return found;
}

/** Appending links keeps destination IDs stable. Rewrite incoming references in
 * one pass so [1] -> [2] cannot subsequently become [3]. */
export function offsetExternalWorkbookRefs(formula, offset) {
  if (!offset || !formula.includes('[')) return formula;
  return mapExternalWorkbookRefs(formula, n => n + offset);
}

export function mapExternalWorkbookRefs(formula, mapIndex) {
  const rename = name => typeof name === 'string' ? name.replace(/^\[([1-9]\d*)\]/, (_, n) => `[${mapIndex(Number(n))}]`) : name;
  return mapFormulaRefs(formula, ref => ({ ...ref, sheet: rename(ref.sheet),
    ...(ref.sheetEnd ? { sheetEnd: rename(ref.sheetEnd) } : {}) }), token => {
    const sheet = rename(token.sheet);
    return sheet === token.sheet ? null : `${quoteSheet(sheet)}!${token.value}`;
  });
}

/** Keep existing IDs stable when a second workbook contributes supporting data. */
export function appendExternalWorkbooks(current, incoming) {
  return incoming ? normalizeExternalWorkbooks({ version: 1, books: [
    ...(current?.books || []), ...incoming.books.map(book => book.names?.length
      ? { ...book, names: book.names.map(n => ({ ...n, ref: offsetExternalWorkbookRefs(n.ref, current?.books.length || 0) })) } : book),
  ] }) : current;
}

/** Resolve every external relationship in the source package's namespace.
 * sourceWorkbook may itself be relative to a destination, as in sheet copy,
 * or an absolute URI when producing a portable clipboard snapshot. */
export function rebaseExternalWorkbooks(value, sourceWorkbook) {
  if (!value || !sourceWorkbook) return value;
  return { ...value, books: value.books.map(book => book.kind === 'dde' ? book : {
    ...book, target: rebaseWorkbookTarget(book.target, sourceWorkbook),
    ...(book.relationships ? { relationships: book.relationships.map(r => ({ ...r, target: rebaseWorkbookTarget(r.target, sourceWorkbook) })) } : {}),
  }) };
}

/** Keep supporting books reachable from copied formulas, including references
 * inside their defined names. Dynamic INDIRECT and unknown named expressions
 * require the full namespace: their eventual dependencies cannot be enumerated. */
export function selectExternalWorkbooks(value, formulas) {
  const identity = formula => formula;
  if (!value?.books?.length) return { externalWorkbooks: null, mapFormula: identity };
  const needed = new Set(), queue = [];
  let dynamic = false;
  const scan = formula => {
    let tokens; try { tokens = tokenize(formula); } catch { dynamic = true; return; }
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'name' && !token.sheet && (token.value === 'INDIRECT' || tokens[i + 1]?.type !== 'lparen')) dynamic = true;
      for (const sheet of [token.sheet, token.sheetEnd]) {
        const match = /^\[([1-9]\d*)\]/.exec(sheet || '');
        if (!match) continue;
        const index = Number(match[1]);
        if (!value.books[index - 1]) { dynamic = true; continue; }
        if (!needed.has(index)) { needed.add(index); queue.push(index); }
      }
    }
  };
  for (const formula of formulas) scan(formula);
  for (let cursor = 0; cursor < queue.length && !dynamic; cursor++) {
    for (const name of value.books[queue[cursor] - 1].names || []) scan(name.ref);
  }
  if (dynamic || needed.size === value.books.length) return { externalWorkbooks: value, mapFormula: identity };
  if (!needed.size) return { externalWorkbooks: null, mapFormula: identity };
  const indexes = [...needed].sort((a,b) => a-b), mapping = new Map(indexes.map((index,i) => [index,i+1]));
  const mapFormula = formula => mapExternalWorkbookRefs(formula, index => mapping.get(index) ?? index);
  return { mapFormula, externalWorkbooks: { version: 1, books: indexes.map(index => {
    const book = value.books[index - 1];
    return { ...book, names: (book.names || []).map(name => ({ ...name, ref: mapFormula(name.ref) })) };
  }) } };
}
