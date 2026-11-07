import { copyNativeSparklines } from './native-sparkline-paste.js';
import { nativeSparklineColorValues } from './native-sparkline-data.js';
import { effectiveColorPalette } from './font-color.js';
import { tokenize } from './formula/tokenizer.js';
import { mapFormulaRefs, parseRefText, refToText, shiftFormula, quoteSheet, resolveRelativeName } from './refs.js';

/** Prepare a block import for the normal native-sparkline paste transaction.
 * Unlike clipboard copying to another sheet, the imported sheet's local data
 * travels with the block. Names do not travel with a partial-sheet import, so
 * resolve local range names in their original anchor context before copying.
 */
export function importedNativeSparklines(wb, sheetId, range, target, r0, c0, targetPalette) {
  const source = wb.sheet(sheetId), dr = r0 - range.r1, dc = c0 - range.c1;
  if (!source.sparklineGroups.length && !target.sparklineGroups.length) return null;
  const rows = Array.from({ length: range.r2 - range.r1 + 1 }, (_, i) => range.r1 + i);
  const cols = Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i);
  const snapshot = copyNativeSparklines(source, rows, cols);
  const local = formula => mapFormulaRefs(formula, ref => {
    if (ref.sheetEnd || ref.sheet && ref.sheet.toLowerCase() !== source.name.toLowerCase()) return ref;
    const { sheet, ...unqualified } = ref; return unqualified;
  });
  const binding = (formula, anchor) => {
    try {
      const tokens = tokenize(formula);
      if (tokens.length === 1 && tokens[0].type === 'name') {
        const token = tokens[0], entry = wb.namedEntry(token.value, token.sheet || source.name);
        // A dynamic definition must not become a snapshot of today's cells.
        const definition = entry && (entry.relative ? resolveRelativeName(entry.ref, anchor.r, anchor.c) : entry.ref);
        const location = definition && wb.parseNamedRef(definition);
        if (location && !location.sheetEnd && location.sheet?.toLowerCase() === source.name.toLowerCase()) return local(refToText(location));
        // Keep unresolved/foreign names explicit rather than rebinding them to
        // an unrelated destination name. Their missing dependencies stay visible.
        if (!token.sheet) return `${quoteSheet(source.name)}!${formula.trim()}`;
      }
    } catch { /* Preserve unsupported expressions for native export. */ }
    return local(formula);
  };
  snapshot.groups = snapshot.groups.map(group => {
    const anchor = parseRefText(group.sparklines[0].ref), at = { r: rows[anchor.r1], c: cols[anchor.c1] };
    const sourceColors = nativeSparklineColorValues(group, effectiveColorPalette(wb.colorPalette));
    const targetColors = nativeSparklineColorValues(group, effectiveColorPalette(targetPalette));
    const colors = {};
    for (const [key, value] of Object.entries(sourceColors)) if (value !== targetColors[key]) colors[`color${key[0].toUpperCase()}${key.slice(1)}`] = { rgb: `FF${value.slice(1).toUpperCase()}` };
    return { ...group, ...colors,
      // A new group is imported together with its date cells; ordinary clipboard
      // copies instead keep their existing group's shared date binding.
      ...(group.dateFormula == null ? {} : { dateFormula: shiftFormula(binding(group.dateFormula, at), dr, dc) }),
      sparklines: group.sparklines.map(spark => { const p = parseRefText(spark.ref); return { ...spark,
        ...(spark.formula == null ? {} : { formula: binding(spark.formula, { r: rows[p.r1], c: cols[p.c1] }) }),
      }; }),
    };
  });
  // Local expressions now belong to the receiving sheet; prevent clipboard's
  // cross-sheet qualification from sending them back to the omitted source.
  snapshot.sheetName = target.name;
  return snapshot;
}
