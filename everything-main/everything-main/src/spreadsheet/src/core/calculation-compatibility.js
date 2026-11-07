const uint = value => Number.isInteger(value) && value > 0 && value <= 0xffffffff;

/** New app workbooks retain their existing Unicode character semantics (calculation
 * compatibility Version 2). Versions are cumulative; preserve future version/warning numbers
 * rather than downgrading their declaration when editing a workbook.
 * https://support.microsoft.com/en-gb/excel/compatibility-versions
 */
export function normalizeCalculationCompatibility(raw, fallback = 2) {
  const version = uint(raw?.version) ? raw.version : fallback;
  const warn = raw?.warnBelowVersion;
  return { version, ...(uint(warn) && warn <= version ? { warnBelowVersion: warn } : {}) };
}
