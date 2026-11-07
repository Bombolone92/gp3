import { normalizeNativeSparklineGroups } from './native-sparklines.js';
import { tokenize } from './formula/tokenizer.js';
import { cellName } from './cell.js';
import { parseRefText, shiftFormula, mapFormulaRefs, quoteSheet, MAX_ROW, MAX_COL } from './refs.js';

// Runtime provenance is deliberately absent from serialized clipboard data.
const owners = new WeakMap();
export function copyNativeSparklines(sheet, rows, cols) {
  const rr = new Map(rows.map((r, i) => [r, i])), cc = new Map(cols.map((c, i) => [c, i]));
  const groups = sheet.sparklineGroups.flatMap(group => {
    const sparklines = group.sparklines.flatMap(spark => {
      const p = parseRefText(spark.ref), r = rr.get(p.r1), c = cc.get(p.c1);
      return r == null || c == null ? [] : [{ ...spark, ref: cellName(r, c) }];
    });
    return sparklines.length ? [{ ...group, sparklines }] : [];
  });
  const snapshot = { groups: normalizeNativeSparklineGroups(groups), rows: [...rows], cols: [...cols], sheetName: sheet.name };
  owners.set(snapshot, sheet);
  return snapshot;
}

/** Validate app clipboard metadata without trusting arbitrary model objects. */
export function readCopiedNativeSparklines(value, height, width) {
  if (!value || !Array.isArray(value.rows) || !Array.isArray(value.cols) ||
      value.rows.length !== height || value.cols.length !== width ||
      typeof value.sheetName !== 'string' || !value.sheetName || value.sheetName.length > 31) return null;
  const valid = (items, max) => items.every((n, i) => Number.isInteger(n) && n >= 0 && n <= max && (i === 0 || n > items[i - 1]));
  if (!valid(value.rows, MAX_ROW) || !valid(value.cols, MAX_COL)) return null;
  try {
    const groups = normalizeNativeSparklineGroups(value.groups);
    if (groups.some(g => g.sparklines.some(s => { const p = parseRefText(s.ref); return p.r1 >= height || p.c1 >= width; }))) return null;
    return { groups, rows: [...value.rows], cols: [...value.cols], sheetName: value.sheetName };
  } catch { return null; }
}

export function mapPastedNativeSparklines(snapshot, sheet, height, width, r0, c0, repeat, transpose) {
  const value = readCopiedNativeSparklines(snapshot, height, width);
  if (!value) return null;
  const join = owners.get(snapshot) === sheet;
  const qualify = formula => {
    if (value.sheetName === sheet.name) return formula;
    try {
      const tokens = tokenize(formula);
      if (tokens.length === 1 && tokens[0].type === 'name' && !tokens[0].sheet) return `${quoteSheet(value.sheetName)}!${formula.trim()}`;
    } catch { /* retain unsupported reference expressions verbatim */ }
    return mapFormulaRefs(formula, ref => ref.sheet == null ? { ...ref, sheet: value.sheetName } : ref);
  };
  const groups = value.groups.map(group => {
    const sparklines = [];
    for (let ry = 0; ry < repeat.rows; ry++) for (let rx = 0; rx < repeat.cols; rx++) for (const spark of group.sparklines) {
      const p = parseRefText(spark.ref), r = r0 + ry * height + (transpose ? p.c1 : p.r1), c = c0 + rx * width + (transpose ? p.r1 : p.c1);
      if (r < 0 || c < 0 || r > MAX_ROW || c > MAX_COL) continue;
      sparklines.push({ ref: cellName(r, c), ...(spark.formula != null ? {
        formula: qualify(shiftFormula(spark.formula, r - value.rows[p.r1], c - value.cols[p.c1])),
      } : {}) });
    }
    return { ...group, ...(group.dateFormula != null ? { dateFormula: qualify(group.dateFormula) } : {}), sparklines };
  });
  return { groups, join };
}

const settings = ({ uid, sparklines, ...rest }) => JSON.stringify(rest);
/** Only destinations accepted by scalar/merge preflight can receive metadata. */
export function replacePastedNativeSparklines(current, mapped, entries) {
  if (!mapped || !current.length && !mapped.groups.length) return current;
  const targets = new Set(entries.map(e => cellName(e.r, e.c)));
  const next = current.map(group => ({ ...group, sparklines: group.sparklines.filter(s => !targets.has(s.ref)) }));
  for (const group of mapped.groups) {
    const sparklines = group.sparklines.filter(s => targets.has(s.ref));
    if (!sparklines.length) continue;
    const existing = mapped.join && next.find(g => g.uid === group.uid && settings(g) === settings(group));
    if (existing) existing.sparklines.push(...sparklines);
    else next.push({ ...group, uid: `{${crypto.randomUUID().toUpperCase()}}`, sparklines });
  }
  const result = next.filter(g => g.sparklines.length);
  return JSON.stringify(current) === JSON.stringify(result) ? current : result;
}
