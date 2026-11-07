import { MAX_COL, MAX_ROW } from '../core/refs.js';

// Draft-only encoding. Keep the public workbook JSON and XLSX model unchanged.
// Each index remains explicit: a small malicious range cannot expand into
// millions of records. Repeated style/width records are stored once, by value.
export const DRAFT_ENCODING = 'line-dictionaries-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function pack(map) {
  if (!record(map)) return map;
  const groups = new Map();
  for (const [index, value] of Object.entries(map)) {
    if (!/^\d+$/.test(index) || !record(value)) return map;
    const key = JSON.stringify(value);
    if (!groups.has(key)) groups.set(key, [value, []]);
    groups.get(key)[1].push(Number(index));
  }
  const packed = [...groups.values()];
  return JSON.stringify(packed).length < JSON.stringify(map).length ? packed : map;
}

function unpack(value, max) {
  if (!Array.isArray(value)) return value;
  const result = {};
  for (const group of value) {
    if (!Array.isArray(group) || group.length !== 2 || !record(group[0]) || !Array.isArray(group[1])) throw new Error('Invalid draft dictionary');
    for (const index of group[1]) {
      if (!Number.isInteger(index) || index < 0 || index > max || Object.hasOwn(result, index)) throw new Error('Invalid draft index');
      result[index] = { ...group[0] };
    }
  }
  return result;
}

function transform(book, visit) {
  if (!record(book) || !Array.isArray(book.sheets)) throw new Error('Invalid draft workbook');
  return { ...book, sheets: book.sheets.map(sheet => {
    if (!record(sheet)) throw new Error('Invalid draft sheet');
    return { ...sheet,
      ...(sheet.colStyles ? { colStyles: visit(sheet.colStyles, MAX_COL) } : {}),
      ...(sheet.rowStyles ? { rowStyles: visit(sheet.rowStyles, MAX_ROW) } : {}),
      ...(record(sheet.nativeWidths) ? { nativeWidths: { ...sheet.nativeWidths,
        cols: visit(sheet.nativeWidths.cols, MAX_COL) } } : {}) };
  }) };
}

/** Null when no field benefits from dictionary encoding. */
export function packDraftWorkbook(book) {
  let changed = false;
  const result = transform(book, map => { const packed = pack(map); changed ||= packed !== map; return packed; });
  return changed ? result : null;
}

export const unpackDraftWorkbook = book => transform(book, unpack);
