import { sha256 } from '@noble/hashes/sha2.js';
import { mapFormulaRefs, quoteSheet } from './refs.js';
import { externalWorkbookScope } from './external-workbooks.js';

// Only these internal values are URI leaves. Cell text and other strings must
// remain literal calculation inputs, even when they happen to look like URLs.
class SourceUri { constructor(target) { this.target = target; } }
export const sourceUri = target => new SourceUri(target);

/** Hash calculation structure separately from its ordered source identities.
 * Sorting keys before visiting leaves keeps both outputs independent of object
 * insertion order. Explicit URI rebasing can then update sources without
 * discarding or recreating the calculation fingerprint. */
export function externalProvenance(value) {
  const sources = [];
  const serialized = JSON.stringify(value, (_, item) => {
    if (item instanceof SourceUri) { sources.push(item.target); return { externalSource: true }; }
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  });
  const signature = Array.from(sha256(new TextEncoder().encode(serialized)), n => n.toString(16).padStart(2, '0')).join('');
  return { signature, sources };
}

/** Package-local indexes are not workbook identity. Keep each reference's URI
 * in occurrence order beside a canonical formula, including named references. */
export function externalFormulaProvenance(books, formula) {
  const sources = [];
  const scopeName = name => {
    const scope = externalWorkbookScope(books, name);
    if (!scope) return null;
    if (typeof scope.book.target !== 'string') return JSON.stringify(['external', scope.book.kind, scope.sheet?.name || '']);
    sources.push(sourceUri(scope.book.target));
    return JSON.stringify(['external', scope.sheet?.name || '']);
  };
  const canonical = mapFormulaRefs(formula, ref => {
    const sheet = scopeName(ref.sheet);
    return sheet == null ? ref : { ...ref, sheet,
      ...(ref.sheetEnd?.startsWith('[') ? { sheetEnd: scopeName(ref.sheetEnd) || ref.sheetEnd } : {}) };
  }, token => {
    const sheet = scopeName(token.sheet);
    return sheet == null ? null : `${quoteSheet(sheet)}!${token.value}`;
  });
  return { formula: canonical, sources };
}
