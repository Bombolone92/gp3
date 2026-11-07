import { externalWorkbookScope, externalWorkbookSpan, externalNamedEntries, externalFormulaHasLinks, externalFormulaHasCaches } from './external-workbooks.js';
import { callerDependencies } from './formula/caller-context.js';
import { isWorkbookNameScope } from './formula/tokenizer.js';
import { parseFormula } from './formula/parser.js';
import { resolveRelativeName } from './refs.js';

/** Classify the links reached by the same lexical name walk used for saved-result
 * provenance. A whole-formula result never supplies missing supporting cells. */
export function externalLinksFromDependencies(profile, books) {
  let found = false, linked = true, cached = true;
  for (const reference of [...profile.reads, ...profile.externalNames]) {
    if (!reference.sheet?.startsWith('[')) continue;
    found = true;
    const index = /^\[([1-9]\d*)\]/.exec(reference.sheet);
    if (!index || !books?.books[Number(index[1]) - 1]) { linked = cached = false; continue; }
    const source = externalWorkbookScope(books, reference.sheet);
    if (!source) { cached = false; continue; }
    if (reference.name) {
      if (!externalNamedEntries(books, reference.sheet).has(reference.name.toLowerCase())
        || source.book.sheets.some(s => s.cells == null || s.refreshError)) cached = false;
    } else {
      if (!source.sheet || source.sheet.cells == null || source.sheet.refreshError) cached = false;
      if (reference.sheetEnd) {
        const span = externalWorkbookSpan(books, reference.sheet, reference.sheetEnd);
        if (!span || span.sheets.some(s => s.cells == null || s.refreshError)) cached = false;
      }
    }
  }
  return { external: found, linked: found && linked, cached: found && cached };
}

/** Import has definitions before it has a Workbook. Index them once, preserving
 * local-over-global lookup and caller-relative references without evaluating. */
export function createExternalFormulaLinks(names, books) {
  const direct = formula => ({ external: false, linked: externalFormulaHasLinks(formula, books), cached: externalFormulaHasCaches(formula, books) });
  if (!names.some(entry => entry.ref.includes('['))) return formula => formula.includes('[') ? direct(formula) : { external: false, linked: false, cached: false };
  const globals = new Map(), locals = new Map(), parsed = new Map();
  for (const entry of names) {
    let index = globals;
    if (entry.sheet) {
      const key = entry.sheet.toLowerCase();
      if (!locals.has(key)) locals.set(key, new Map());
      index = locals.get(key);
    }
    index.set(entry.name.toLowerCase(), entry);
  }
  const ast = formula => { try { return parseFormula(formula); } catch { return null; } };
  return (formula, sheet, r, c) => {
    const root = ast(formula);
    if (!root) return direct(formula);
    return externalLinksFromDependencies(callerDependencies(root, (name, scope) => {
      const owner = scope || sheet, key = name.toLowerCase();
      const entry = isWorkbookNameScope(owner) ? globals.get(key) : owner.startsWith('[') ? externalNamedEntries(books, owner).get(key)
        : locals.get(owner.toLowerCase())?.get(key) || globals.get(key);
      if (!entry) return null;
      if (!entry.relative && !parsed.has(entry.ref)) parsed.set(entry.ref, ast(entry.ref));
      return { key: `${owner}|${key}`, ast: entry.relative ? ast(resolveRelativeName(entry.ref, r, c)) : parsed.get(entry.ref) };
    }, { expandAllNames: true }), books);
  };
}
