/** A supporting sheet's last known visibility, distinct from its cached values.
 * Keep filtering separate: SUBTOTAL 9 includes manually hidden rows, while 109
 * excludes them; both exclude filtered rows. Missing metadata means unknown. */
export function normalizeExternalVisibility(raw) {
  if (raw == null) return undefined;
  const fail = () => { throw new Error('Invalid external workbook cache: visibility'); };
  if (typeof raw !== 'object' || Array.isArray(raw)) fail();
  const result = {};
  for (const [key, limit] of [['hiddenRows', 1048576], ['filteredRows', 1048576], ['hiddenCols', 16384]]) {
    const values = raw[key] ?? [];
    if (!Array.isArray(values) || values.length > limit || values.some(n => !Number.isInteger(n) || n < 0 || n >= limit)) fail();
    const unique = [...new Set(values)].sort((a, b) => a - b);
    if (unique.length) result[key] = unique;
  }
  return Object.keys(result).length ? result : undefined;
}
