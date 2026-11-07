import { externalProvenance, externalFormulaProvenance, sourceUri } from './external-provenance.js';
import { getLocale } from './format.js';
import { cellKey, parseKey } from './cell.js';
import { externalWorkbookScope, externalWorkbookSpan } from './external-workbooks.js';

const WHOLE = [Symbol('external input contents'), Symbol('external input metadata')];
const STYLE_READERS = Symbol('external input style readers');
const CANDIDATES = Symbol('external input spill candidates');
// Sort object keys so provenance does not depend on JSON property insertion order.
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const canonicalFormula = (wb, formula) => externalFormulaProvenance(wb.externalWorkbooks, formula);
const content = (wb, cell, styles = false) => {
  if (!cell) return null;
  const value = cell.f == null ? { v: cell.v ?? null } : { f: canonicalFormula(wb, cell.f), array: cell.array,
    // Another linked formula's saved value is itself an input. Never include
    // its context: binding snapshots must not depend on cell traversal order.
    ...(wb.iteration ? { seed: cell.v } : {}),
    saved: cell.externalResult && { value: cell.externalResult.value, array: cell.externalResult.array } };
  if (styles) value.s = cell.s;
  return value;
};

/** An opaque reference expression can select any local cell. Retain its saved
 * answer while the local calculation state is unchanged; after a change,
 * ordinary evaluation decides the result (including IFERROR and missing links).
 * This fallback is shared per revision and excludes view/selection state. */
function wholeContext(wb, styles) {
  // An opaque target may itself be a formula which reads display metadata.
  let styleReaders = wb._statsCache.get(STYLE_READERS);
  if (styleReaders === undefined) {
    styleReaders = wb.sheets.some(sheet => [...sheet.cells].some(([key, cell]) => {
      if (cell.f == null) return false;
      const { r, c } = parseKey(key);
      return wb._externalDependencies(sheet, r, c, cell.f).styles;
    }));
    wb._statsCache.set(STYLE_READERS, styleReaders);
  }
  styles ||= styleReaders;
  const key = WHOLE[+styles];
  const hit = wb._statsCache.get(key);
  if (hit) return hit;
  const snapshot = externalProvenance({
    names: wb.names.map(n => ({ ...n, ref: canonicalFormula(wb, n.ref) })), locale: getLocale(),
    external: wb.externalWorkbooks?.books.map(book => {
      // Digest supporting payloads separately so the enclosing snapshot does
      // not duplicate every cached value in one large serialized string.
      const { signature, sources } = externalProvenance({ ...book,
        ...(book.target ? { target: sourceUri(book.target) } : {}),
        ...(book.relationships ? { relationships: book.relationships.map(rel => ({ ...rel, target: sourceUri(rel.target) })) } : {}) });
      return { signature, sources: sources.map(sourceUri) };
    }),
    async: [...wb._asyncCache].sort(([a], [b]) => a.localeCompare(b)), externalAllowed: wb.externalAllowed,
    compatibility: wb.calculationCompatibility, iteration: wb.iteration,
    sheets: wb.sheets.map(sheet => ({ name: sheet.name, kind: sheet.kind, tables: sheet.tables,
      cells: [...sheet.cells].filter(([, cell]) => styles || cell.f != null || cell.v != null).map(([key, cell]) => [key, content(wb, cell, styles)]).sort(([a], [b]) => a.localeCompare(b)),
      hiddenRows: [...sheet.hiddenRows].sort((a, b) => a - b), filterHidden: [...sheet.filterHidden].sort((a, b) => a - b),
      ...(styles ? { rowStyles: [...sheet.rowStyles].sort(([a], [b]) => a - b), colStyles: [...sheet.colStyles].sort(([a], [b]) => a - b), styleResets: sheet.styleResets,
        widths: [...sheet.colWidths].sort(([a], [b]) => a - b), defaultColWidth: sheet.defaultColWidth,
        nativeWidths: sheet.nativeWidths, protected: sheet.protected, normalFont: wb.normalFont } : {}) })) });
  wb._statsCache.set(key, snapshot);
  return snapshot;
}

function candidates(wb, sheet) {
  let cache = wb._statsCache.get(CANDIDATES);
  if (!cache) wb._statsCache.set(CANDIDATES, cache = new Map());
  if (cache.has(sheet)) return cache.get(sheet);
  const out = [];
  for (const [key, cell] of sheet.cells) {
    if (cell.f == null || cell.array) continue;
    const ast = wb._astOrNull(cell.f);
    let candidate = !!cell.externalResult?.array;
    try { candidate ||= !!ast && wb._isArrayCandidate(ast, sheet.name); }
    catch (e) { if (!(e instanceof RangeError)) throw e; candidate = true; }
    if (candidate) out.push(parseKey(key));
  }
  cache.set(sheet, out);
  return out;
}

/** Fingerprint the sparse, transitive local input graph without calculating it.
 * No unavailable external scalar is inferred from a whole-formula last result.
 * A visited set makes cycles finite, and whole-column reads visit stored cells,
 * not all grid coordinates. Unknown/dynamic footprints use a calculation-state
 * snapshot rather than treating an incomplete reference list as exhaustive. */
export function externalInputContext(wb, sheet, r, c, formula, profile) {
  const pending = [{ sheet, r, c, formula, profile }], seen = new Set(), inputs = [];
  let open = false, styles = false;
  while (pending.length) {
    const current = pending.pop();
    const key = `${current.sheet.id}|${current.r},${current.c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = current.profile || wb._externalDependencies(current.sheet, current.r, current.c, current.formula);
    open ||= info.open; styles ||= info.styles;
    if (current.profile !== profile) {
      const context = wb._externalCallerContext(current.sheet, current.r, current.c, current.formula, false);
      // The reference path already identifies this namespace; an unqualified
      // dependency stays the same input when its containing sheet is renamed.
      delete context.sheetName;
      if (context.sources) context.sources = context.sources.map(sourceUri);
      inputs.push(['caller', current.r, current.c, context]);
    }
    for (const reference of info.externalNames) {
      const target = externalWorkbookScope(wb.externalWorkbooks, reference.sheet);
      if (!target || typeof target.book.target !== 'string') { open = true; continue; }
      inputs.push(['external-name', sourceUri(target.book.target), target.sheet?.name || '', reference.name.toLowerCase()]);
    }
    for (const ref of info.reads) {
      if (ref.sheet?.startsWith('[')) {
        // The current formula may have one unavailable source beside another
        // available source, including through a local formula dependency.
        const target = externalWorkbookScope(wb.externalWorkbooks, ref.sheet);
        const sheets = ref.sheetEnd ? externalWorkbookSpan(wb.externalWorkbooks, ref.sheet, ref.sheetEnd)?.sheets : target?.sheet && [target.sheet];
        if (!target || !sheets) { open = true; continue; }
        for (const source of sheets) {
          if (source.cells == null) {
            // Unavailable values are not inputs we can calculate, but their
            // source identity still belongs to the saved answer. Package link
            // indexes can change during transfer; target and sheet do not.
            inputs.push(['unavailable-external', sourceUri(target.book.target), source.name]);
            continue;
          }
          const values = [];
          if (ref.r1 === ref.r2 && ref.c1 === ref.c2) values.push([cellKey(ref.r1, ref.c1), source.cells[cellKey(ref.r1, ref.c1)] ?? null]);
          else for (const [key, value] of Object.entries(source.cells)) {
            const { r, c } = parseKey(key);
            if (r >= ref.r1 && r <= ref.r2 && c >= ref.c1 && c <= ref.c2 && value != null) values.push([key, value]);
          }
          inputs.push(['external', sourceUri(target.book.target), source.name, !!source.refreshError, values.sort(([a], [b]) => a.localeCompare(b))]);
        }
        continue;
      }
      const names = ref.sheetEnd ? wb.sheetsBetween(ref.sheet || current.sheet.name, ref.sheetEnd) : [ref.sheet || current.sheet.name];
      if (!names) { inputs.push(['missing-span', ref]); continue; }
      for (const name of names) {
        const target = wb.sheetByName(name);
        if (!target) { inputs.push(['missing-sheet', name]); continue; }
        if (target.externalCache) continue;
        const entries = [];
        const take = (key, cell) => {
          // Blank formatting cells and absent cells have the same value.
          if (!cell || cell.f == null && cell.v == null) return;
          entries.push([key, content(wb, cell)]);
          if (cell.f != null) pending.push({ sheet: target, ...parseKey(key), formula: cell.f });
        };
        if (ref.r1 === ref.r2 && ref.c1 === ref.c2) take(cellKey(ref.r1, ref.c1), target.cells.get(cellKey(ref.r1, ref.c1)));
        else for (const [key, cell] of target.cells) {
          const { r, c } = parseKey(key);
          if (r >= ref.r1 && r <= ref.r2 && c >= ref.c1 && c <= ref.c2) take(key, cell);
        }
        // Fixed-array children do not store their formulas. Include the owners.
        for (const array of wb._fixedArrays(target).overlapping(ref)) take(array.key, target.cells.get(array.key));
        // Dynamic output extents require evaluation. Do not reenter calculation
        // while deciding whether its saved inputs are still trustworthy.
        if (ref.spill || candidates(wb, target).some(p => p.r <= ref.r2 && p.c <= ref.c2)) open = true;
        inputs.push(['range', ref.sheet || null, ref.r1, ref.c1, ref.r2, ref.c2,
          entries.sort(([a], [b]) => a.localeCompare(b))]);
      }
    }
  }
  if (open) return wholeContext(wb, styles);
  if (!inputs.length) return { signature: null, sources: [] };
  // A bare unavailable reference observes source identity without converting
  // any local value. Its portability must not depend on regional settings.
  return externalProvenance(inputs.every(input => input[0] === 'unavailable-external' || input[0] === 'external-name')
    ? inputs : [getLocale(), wb.calculationCompatibility, wb.iteration, inputs]);
}

/** Sheet-copy conversion supplies every omitted sheet's current values in native
 * supporting caches. Rebind an input fingerprint only when the retained formula
 * graph uses value references and its caller frames remain the same. Reference
 * identity readers and opaque/dynamic footprints cannot certify that equivalence.
 * This is specific to the semantic sheet-copy operation, never ordinary paste. */
export function canRebaseCopiedExternalInputs(source, destination, sheet, copied, r, c) {
  const pending = [{ r, c }], seen = new Set();
  while (pending.length) {
    const at = pending.pop(), key = cellKey(at.r, at.c);
    if (seen.has(key)) continue;
    seen.add(key);
    const before = sheet.cells.get(key), after = copied.cells.get(key);
    if (before?.f == null || after?.f == null) return false;
    const profile = source._externalDependencies(sheet, at.r, at.c, before.f);
    if (profile.open || profile.referenceIdentity) return false;
    const beforeContext = source._externalCallerContext(sheet, at.r, at.c, before.f, false);
    const afterContext = destination._externalCallerContext(copied, at.r, at.c, after.f, false);
    // This operation proves the source-to-supporting-cache mapping separately.
    // URI spelling can change along with that mapping, but caller state cannot.
    delete beforeContext.sources; delete afterContext.sources;
    if (stable(beforeContext) !== stable(afterContext)) return false;
    for (const ref of profile.reads) {
      if (ref.sheet?.startsWith('[')) continue;
      const names = ref.sheetEnd ? source.sheetsBetween(ref.sheet || sheet.name, ref.sheetEnd) : [ref.sheet || sheet.name];
      if (!names) return false;
      for (const name of names) {
        const target = source.sheetByName(name);
        if (!target) return false;
        // Omitted formulas become their evaluated supporting-cell values. Only
        // the retained formulas continue to observe their original caller state.
        if (target !== sheet) continue;
        if (ref.spill || candidates(source, sheet).some(p => p.r <= ref.r2 && p.c <= ref.c2)) return false;
        const enqueue = (key, cell) => { if (cell?.f != null) pending.push(parseKey(key)); };
        if (ref.r1 === ref.r2 && ref.c1 === ref.c2) enqueue(cellKey(ref.r1, ref.c1), sheet.cells.get(cellKey(ref.r1, ref.c1)));
        else for (const [key, cell] of sheet.cells) {
          const { r, c } = parseKey(key);
          if (r >= ref.r1 && r <= ref.r2 && c >= ref.c1 && c <= ref.c2) enqueue(key, cell);
        }
        for (const array of source._fixedArrays(sheet).overlapping(ref)) enqueue(array.key, sheet.cells.get(array.key));
      }
    }
  }
  return true;
}
