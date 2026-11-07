/** Functions inserted lately, newest first, for the Formulas ribbon's Recently Used list. */
const KEY = 'spreadsheet:recent-functions';
const LIMIT = 10;
// Before anything has been inserted, the list offers the everyday functions.
const DEFAULTS = ['SUM', 'AVERAGE', 'IF', 'HYPERLINK', 'COUNT', 'MAX', 'SIN', 'SUMIF', 'PMT', 'STDEV'];

export function recentFunctionNames() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(list) && list.every(n => typeof n === 'string')) return list.slice(0, LIMIT);
  } catch { /* optional storage */ }
  return [...DEFAULTS];
}

export function rememberFunction(name) {
  const upper = String(name || '').toUpperCase();
  if (!upper) return;
  const next = [upper, ...recentFunctionNames().filter(n => n !== upper)].slice(0, LIMIT);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional storage */ }
}
