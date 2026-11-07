/** Native duplicate/unique rules count typed values over the complete sqref.
 * App-authored rules keep their separate, trimmed valueIdentity contract.
 */
import { toNumber, compareValues } from './formula/functions.js';
import { compareSpreadsheetText, compareFoldedText, foldComparisonText } from './formula/text-comparison.js';
import { wildcardMatcher } from './formula/wildcard.js';
import { parseFormula } from './formula/parser.js';
import { cellName } from './cell.js';
import { refToText, quoteSheet } from './refs.js';
import { toFileFormula } from './xlfn.js';

const add = (map, key, count) => map.set(key, (map.get(key) || 0) + count);
const normalize = value => {
  if (typeof value !== 'string') return value;
  const number = toNumber(value);
  return typeof number === 'number' ? number : value;
};

/** Sparse area statistics. Blank cells contribute to empty-text counts, but
 * never to wildcard matches. Keep raw strings as well as their coerced types:
 * native '*' matches the stored text '1', while literal '¹' does not.
 */
export function duplicateAreaStats(values, size) {
  const stats = { blanks: size, numbers: new Map(), texts: new Map(), booleans: new Map(), errors: new Map() };
  for (const value of values) {
    if (value == null) continue;
    stats.blanks--;
    if (typeof value === 'string') add(stats.texts, value, 1);
    else if (typeof value === 'number' && Number.isFinite(value)) add(stats.numbers, value, 1);
    else if (typeof value === 'boolean') add(stats.booleans, value, 1);
    else if (value?.error) add(stats.errors, value.error, 1);
  }
  return stats;
}

function lowerBound(items, compare) {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (compare(items[mid]) < 0) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Pairwise comparison is not a transitive identity. Index broad candidates,
 * then apply the actual predicate, rather than merging linguistic equivalents.
 * Counts saturate at two: the two native rules ask >1 and =1 respectively.
 */
export class NativeDuplicateCounts {
  constructor(areas) {
    this.rawTexts = new Map(); this.numbers = new Map(); this.booleans = new Map(); this.errors = new Map();
    this.blanks = 0; this.normalized = new Map(); this.cache = new Map();
    for (const area of areas) {
      this.blanks += area.blanks;
      for (const [field, map] of [['texts', this.rawTexts], ['numbers', this.numbers], ['booleans', this.booleans], ['errors', this.errors]]) {
        for (const [key, count] of area[field]) add(map, key, count);
      }
    }
    this.texts = [];
    for (const [text, count] of this.rawTexts) {
      const value = normalize(text); this.normalized.set(text, value);
      if (typeof value === 'number') add(this.numbers, value, count);
      else this.texts.push({ text, count, folded: foldComparisonText(text) });
    }
    this.numeric = [...this.numbers.keys()].sort((a, b) => a - b);
    this.texts.sort((a, b) => compareFoldedText(a.folded, b.folded));
  }

  count(raw) {
    if (raw == null) return 0;
    if (raw?.error) return Math.min(2, this.errors.get(raw.error) || 0);
    if (typeof raw === 'object') return 0;
    if (this.cache.has(raw)) return this.cache.get(raw);
    const value = this.normalized.has(raw) ? this.normalized.get(raw) : normalize(raw);
    let count = 0;
    if (typeof value === 'boolean') count = this.booleans.get(value) || 0;
    else if (typeof value === 'number' && Number.isFinite(value)) {
      const slack = 1e-14 * Math.abs(value);
      for (let i = lowerBound(this.numeric, n => n < value - slack ? -1 : 1); i < this.numeric.length && this.numeric[i] <= value + slack; i++) {
        const n = this.numeric[i];
        if (compareValues(n, value) === 0) count += this.numbers.get(n);
        if (count > 1) break;
      }
    } else if (typeof value === 'string') {
      if (/[*?]/.test(value)) {
        const matches = wildcardMatcher(value);
        for (const [text, n] of this.rawTexts) {
          if (matches(text)) count += n;
          if (count > 1) break;
        }
      } else {
        if (value === '') count = this.blanks;
        const folded = foldComparisonText(value);
        for (let i = lowerBound(this.texts, item => compareFoldedText(item.folded, folded)); count < 2 && i < this.texts.length; i++) {
          const item = this.texts[i];
          if (compareFoldedText(item.folded, folded) !== 0) break;
          if (compareSpreadsheetText(item.text, value) === 0) count += item.count;
        }
      }
    }
    count = Math.min(2, count); this.cache.set(raw, count);
    return count;
  }
}

const absolute = (r, c) => cellName(r, c).replace(/([A-Z]+)(\d+)/, '$$$1$$$2');
export function duplicateSourceFormula(ranges) {
  const refs = ranges.map(g => `${g.sheet ? `${quoteSheet(g.sheet)}!` : ''}${absolute(g.r1, g.c1)}:${absolute(g.r2, g.c2)}`);
  return refs.length === 1 ? refs[0] : `(${refs.join(',')})`;
}

/** Structural edits can produce nested unions. Preserve area repetitions and
 * reject invalid sources rather than silently counting only the valid pieces.
 */
export function duplicateSourceAreas(formula) {
  try {
    const read = node => node.type === 'ref' && !node.ref.sheetEnd ? [node.ref]
      : node.type === 'union' ? node.parts.flatMap(read) : (() => { throw new Error('Expected reference'); })();
    return read(parseFormula(String(formula || '').trim().replace(/^=/, '')));
  } catch { return null; }
}

/** Live fallback when a partial copy's paint range differs from its statistics.
 * Native rules can be used only while their applies-to union covers the source.
 * Conditional-format expressions cannot contain LAMBDA or literal unions.
 * Count each area with ordinary aggregates. TRIMRANGE avoids blank column tails;
 * analytical blank counts preserve the source's full geometry and multiplicity.
 */
const normalized = input => `IF(ISTEXT(${input}),IFERROR(VALUE(${input}),${input}),${input})`;
const fixedSource = ref => refToText({ ...ref, absR1: true, absC1: true, absR2: true, absC2: true });

function duplicateAreaCount(ref) {
  const key = '_cfKey', raw = '_cfRaw', values = '_cfValues', source = '_cfSource';
  const sum = predicate => `SUMPRODUCT(IFERROR(${predicate},0))`;
  const empty = `IF(ISTEXT(${key}),IF(${key}="",ROWS(${source})*COLUMNS(${source})-COUNTA(${source}),0),0)`;
  const numbers = sum(`ISNUMBER(${values})*NOT(ISBLANK(${raw}))*(${values}=${key})`);
  const booleans = sum(`ISLOGICAL(${raw})*(${raw}=${key})`);
  const errors = sum(`ISERROR(${raw})*(IFERROR(ERROR.TYPE(${raw}),0)=ERROR.TYPE(${key}))`);
  const literal = `${sum(`ISTEXT(${values})*(${values}=${key})`)}+${empty}`;
  // First/last wildcard matches distinguish zero, one and multiple hits without
  // MAP/LAMBDA, which Excel rejects in conditional-format expressions. FILTER
  // preserves raw numeric-looking text but excludes numbers, errors and blanks.
  const wild = `IF(SUMPRODUCT(--ISTEXT(${raw}))=0,0,LET(_cfText,FILTER(TOCOL(${raw}),TOCOL(ISTEXT(${raw}))),_cfFirst,IFERROR(XMATCH(${key},_cfText,2,1),0),_cfLast,IFERROR(XMATCH(${key},_cfText,2,-1),0),IF(_cfFirst=0,0,1+--(_cfFirst<>_cfLast))))`;
  const strings = `IF(OR(ISNUMBER(FIND("*",${key})),ISNUMBER(FIND("?",${key}))),${wild},${literal})`;
  const count = `IF(COUNTA(${source})=0,${empty},LET(${raw},TRIMRANGE(${source}),${values},${normalized(raw)},IF(ISNUMBER(${key}),${numbers},IF(ISLOGICAL(${key}),${booleans},IF(ISTEXT(${key}),${strings},${errors})))))`;
  return `LET(${source},${fixedSource(ref)},${count})`;
}

const duplicateResult = (rule, cell, count) => `IFERROR(AND(NOT(ISBLANK(${cell})),${count}${rule.type === 'dup' ? '>1' : '=1'}),FALSE)`;
export function nativeDuplicateFormula(rule) {
  const areas = duplicateSourceAreas(rule.duplicateRange);
  if (!areas?.length) return 'FALSE';
  const cell = cellName(rule.range.r1, rule.range.c1);
  return `LET(_cfKey,${normalized(cell)},${duplicateResult(rule, cell, `SUM(${areas.map(duplicateAreaCount).join(',')})`)})`;
}

// Excel formulas have an 8192-character limit (including the leading '=')
// and aggregates accept at most 255 arguments. Count serialized prefixes too.
const fits = formula => toFileFormula(formula).length < 8192;
function boundedGroups(items, formula, define) {
  const names = [];
  let group = [];
  for (const item of items) {
    if (group.length && (group.length === 255 || !fits(formula([...group, item])))) {
      names.push(define(formula(group))); group = [];
    }
    group.push(item);
  }
  if (group.length) names.push(define(formula(group)));
  return names;
}

/** A long source union must not be truncated or flattened into cached values.
 * Named LAMBDAs keep each formula within Excel's limit, take the paint cell as
 * an explicit argument, and bind statistics to absolute, qualified references.
 * A tree also bounds large numbers of calls without changing rule priority.
 */
export function exportNativeDuplicateFormula(rule, sheetName, define) {
  const inline = nativeDuplicateFormula(rule);
  if (fits(inline)) return inline;
  const areas = duplicateSourceAreas(rule.duplicateRange);
  const counts = areas.map(ref => duplicateAreaCount({ ...ref, sheet: ref.sheet || sheetName }));
  let names = boundedGroups(counts, parts => `LAMBDA(_cfCell,LET(_cfKey,${normalized('_cfCell')},SUM(${parts.join(',')})))`, define);
  const aggregate = (names, cell) => `SUM(${names.map(name => `${name}(${cell})`).join(',')})`;
  const cell = cellName(rule.range.r1, rule.range.c1);
  while (names.length > 255 || !fits(duplicateResult(rule, cell, aggregate(names, cell)))) {
    names = boundedGroups(names, parts => `LAMBDA(_cfCell,${aggregate(parts, '_cfCell')})`, define);
  }
  return duplicateResult(rule, cell, aggregate(names, cell));
}
