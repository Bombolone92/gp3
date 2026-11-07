// A workbook has one view in the editor. Keep the primary XLSX window's
// geometry and chrome through drafts and native exports; sheet identity is
// stored separately from OOXML's order-dependent firstSheet index.
const SIGNED = ['xWindow', 'yWindow'];
const UNSIGNED = ['windowWidth', 'windowHeight', 'tabRatio'];
const FLAGS = ['showHorizontalScroll', 'showVerticalScroll', 'showSheetTabs'];

export const WORKBOOK_VIEW_ATTRIBUTES = [...SIGNED, ...UNSIGNED, ...FLAGS, 'firstSheet'];

export function normalizeWorkbookView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of SIGNED) {
    const n = Number(value[key]);
    if (value[key] != null && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) out[key] = n;
  }
  for (const key of UNSIGNED) {
    const n = Number(value[key]);
    if (value[key] != null && Number.isInteger(n) && n >= 0 && n <= 4294967295) out[key] = n;
  }
  for (const key of FLAGS) {
    const raw = value[key];
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') out[key] = true;
    else if (raw === false || raw === 0 || raw === '0' || raw === 'false') out[key] = false;
  }
  if (typeof value.firstSheetId === 'string' && value.firstSheetId) out.firstSheetId = value.firstSheetId;
  return Object.keys(out).length ? out : null;
}
