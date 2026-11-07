import { externalWorkbookScope } from './external-workbooks.js';
import { formatValue, numFmtToStyle, styleToNumFmt } from './format.js';

const titles = ['title', 'xTitle', 'yTitle', 'y2Title'];
const keys = [...titles, ...Array.from({ length: 60 }, (_, i) => `name:${i}`)];
export function normalizeLinkedChartText(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entries = keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]).filter(([, entry]) => entry
    && typeof entry.source === 'string' && entry.source.length > 0 && entry.source.length <= 65536).map(([key, entry]) => [key, {
    source: entry.source,
    ...(typeof entry.format === 'string' && entry.format && entry.format.length <= 8192 ? { format: entry.format } : {}),
    ...(Number.isFinite(entry.value) && typeof entry.text === 'string' ? { value: entry.value, text: entry.text.slice(0, 32767) } : {}),
  }]).filter(([, entry]) => entry.format || entry.text != null);
  return entries.length ? Object.fromEntries(entries) : null;
}
function cell(wb, sheetId, ref) {
  const resolved = ref && wb.rangeFromText(sheetId, ref);
  if (!resolved) return null;
  const { sheetId: id, range: { r1: r, c1: c } } = resolved, sheet = wb.sheet(id);
  const external = sheet.externalCache && externalWorkbookScope(wb.externalWorkbooks, sheet.name);
  const source = external && typeof external.book.target === 'string'
    ? JSON.stringify([external.book.target, external.sheet?.name, r, c]) : null;
  const value = wb.getValue(id, r, c);
  return { source, value, text: wb.getDisplay(id, r, c, value), format: styleToNumFmt(wb.styleAt(id, r, c) || {}) };
}
function display(current, saved) {
  if (!current.source || !Number.isFinite(current.value) || saved?.source !== current.source) return current.text;
  if (saved.format) return formatValue(current.value, numFmtToStyle(saved.format));
  return saved.value === current.value ? saved.text : current.text;
}
/** Only supporting cells need retained formatting. Local styles and unresolved
 * references keep their normal behavior; saved strings never replace live data. */
export function linkedChartText(wb, sheetId, chart, key, ref, fallback) {
  if (!chart.linkedText?.[key]) return fallback;
  const current = cell(wb, sheetId, ref);
  return current?.source && Number.isFinite(current.value) ? display(current, chart.linkedText?.[key]) : fallback;
}
function references(chart) {
  return [...titles.filter(key => chart[`${key}Ref`]).map(key => [key, chart[`${key}Ref`]]),
    ...(chart.sourceRefs || []).flatMap((source, i) => source.nameRef ? [[`name:${i}`, source.nameRef]] : [])];
}
/** Called only for parser-owned native strings after workbook construction. A
 * string cache has no number-format code: bind its text to this value/source. */
export function bindImportedChartText(wb, sheetId, chart, texts) {
  for (const [key, ref] of references(chart)) {
    const current = cell(wb, sheetId, ref), text = texts[key];
    if (!current?.source || !Number.isFinite(current.value) || typeof text !== 'string') continue;
    const saved = chart.linkedText?.[key];
    chart.linkedText ||= {};
    chart.linkedText[key] = { source: current.source,
      ...(saved?.source === current.source && saved.format ? { format: saved.format } : {}), value: current.value, text: text.slice(0, 32767) };
  }
}
/** Bind copied text only after the destination's external sources exist. This
 * also handles relative workbook rebasing without renewing stale source text. */
export function preserveCopiedChartText(wb, sheetId, original, copy, copied) {
  const before = new Map(references(original));
  for (const [key, ref] of references(copied)) {
    const from = cell(wb, sheetId, before.get(key)), to = cell(copy, copy.activeSheetId, ref);
    if (!from || !to?.source || !Number.isFinite(from.value) || from.value !== to.value) continue;
    const saved = original.linkedText?.[key];
    const format = from.source ? saved?.source === from.source ? saved.format : null : from.format;
    copied.linkedText = { ...copied.linkedText, [key]: { source: to.source,
      ...(format ? { format } : {}), value: to.value, text: display(from, saved) } };
  }
}
