/** Translate native ODF conditions into live formulas understood by the filter UI. */
import { cellName } from './cell.js';

const quoted = value => `"${String(value).replace(/"/g, '""')}"`;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function conditionFormula(node, range) {
  const attr = node.attrs, field = String(attr['field-number'] ?? '').trim();
  if (!/^\+?\d+$/.test(field)) return null;
  const col = range.s.c + Number(field);
  if (!Number.isSafeInteger(col) || col > range.e.c) return null;
  const ref = '$' + cellName(range.s.r + 1, col), text = `${ref}&""`;
  const sensitive = attr['case-sensitive'] === 'true' || attr['case-sensitive'] === '1';
  const fold = value => sensitive ? value : `LOWER(${value})`;
  if (node.items.length) {
    // XMATCH's exact mode does not treat *, ?, or ~ as wildcards.
    const values = '{' + node.items.map(quoted).join(';') + '}';
    return sensitive ? `OR(${node.items.map(value => `EXACT(${text},${quoted(value)})`).join(',')})` : `ISNUMBER(XMATCH(${text},${values},0))`;
  }
  const op = attr.operator, value = String(attr.value ?? '');
  if (op === 'empty') return `IFERROR(LEN(${text})=0,FALSE())`;
  if (op === '!empty') return `NOT(IFERROR(LEN(${text})=0,FALSE()))`;
  if (attr['data-type'] === 'number') {
    if (!['=', '!=', '<', '>', '<=', '>='].includes(op) || !numeric.test(value.trim()) || !Number.isFinite(Number(value))) return null;
    return `IF(ISNUMBER(${ref}),${ref}${op === '!=' ? '<>' : op}${Number(value)},FALSE())`;
  }
  if (attr['data-type'] && attr['data-type'] !== 'text') return null;
  const literal = quoted(value), left = fold(text), right = fold(literal);
  if (op === '=' || op === '!=') {
    const equal = `EXACT(${left},${right})`;
    return op === '=' ? equal : `NOT(${equal})`;
  }
  if (['<', '>', '<=', '>='].includes(op)) return sensitive ? null : `${left}${op}${right}`;
  const positive = op?.replace(/^!/, '');
  let expression;
  if (positive === 'contains') expression = `ISNUMBER(FIND(${right},${left}))`;
  else if (positive === 'begins' || positive === 'ends') expression = `EXACT(${positive === 'begins' ? 'LEFT' : 'RIGHT'}(${left},LEN(${literal})),${right})`;
  else return null;
  return op.startsWith('!') ? `NOT(${expression})` : expression;
}

function compile(node, range, depth = 0) {
  if (depth > 64) return null;
  if (node.kind === 'condition') return conditionFormula(node, range);
  const children = node.children.map(child => compile(child, range, depth + 1));
  // Unsupported children must not turn a compound condition into a different
  // partial filter. Retain its range until the full predicate is supported.
  if (!children.length || children.some(child => child == null)) return null;
  return children.length === 1 ? children[0] : `${node.kind === 'or' ? 'OR' : 'AND'}(${children.join(',')})`;
}

/** Consume the existing XML stream; resolve target sheets after all tables load. */
export function odsFilterReader({ attributes, decode, address, decodeRange }) {
  const records = [];
  let current = null, stack = [], collecting = false, condition = null;
  const attrs = tag => Object.fromEntries(Object.entries(attributes(tag)).map(([key, value]) => [key, typeof value === 'string' ? decode(value) : value]));
  const finish = () => {
    if (current) records.push(current);
    current = null; stack = []; collecting = false; condition = null;
  };
  return {
    tag(tag, local, closing) {
      const empty = tag.endsWith('/>');
      if (local === 'database-range') {
        if (closing) { finish(); return; }
        finish(); current = { attrs: attrs(tag), root: { kind: 'and', children: [] } };
        stack = [current.root];
        if (empty) finish();
        return;
      }
      if (!current) return;
      if (local === 'filter') { collecting = !closing && !empty; condition = null; return; }
      if (!collecting) return;
      if (local === 'filter-and' || local === 'filter-or') {
        if (closing) { if (stack.length > 1) stack.pop(); return; }
        const group = { kind: local === 'filter-or' ? 'or' : 'and', children: [] };
        stack.at(-1).children.push(group);
        if (!empty) stack.push(group);
      } else if (local === 'filter-condition') {
        if (closing) { condition = null; return; }
        condition = { kind: 'condition', attrs: attrs(tag), items: [] };
        stack.at(-1).children.push(condition);
        if (empty) condition = null;
      } else if (local === 'filter-set-item' && !closing && condition) condition.items.push(String(attrs(tag).value ?? ''));
    },
    apply(sheets) {
      finish();
      for (const record of records) {
        try {
          const [rawSheet, ref] = address(record.attrs['target-range-address']);
          const name = /^'(?:[^']|'')*'$/.test(rawSheet) ? rawSheet.slice(1, -1).replace(/''/g, "'") : rawSheet;
          if (!sheets[name]) continue;
          const showButtons = ['true', '1'].includes(String(record.attrs['display-filter-buttons'] ?? '').trim());
          // A database range alone is not an autofilter. Conditions can remain
          // active independently of whether the header exposes filter buttons.
          if (!showButtons && !record.root.children.length) continue;
          const filter = { ref, ...(!showButtons ? { showButtons: false } : {}) };
          if (!sheets[name]['!autofilter']) sheets[name]['!autofilter'] = filter;
          else (sheets[name]['!filters'] ??= []).push(filter);
          if (!record.root.children.length || record.attrs['orientation'] === 'row' || ['false', '0'].includes(record.attrs['contains-header'])) continue;
          const range = decodeRange(ref);
          if (![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger) || range.s.r < 0 || range.s.c < 0 || range.e.r <= range.s.r || range.e.c < range.s.c || range.e.r >= 1048576 || range.e.c >= 16384) continue;
          const formula = compile(record.root, range);
          // A single condition belongs to the column it tests; one spanning several fields stays on the first.
          let only = record.root;
          while (only.kind !== 'condition' && only.children.length === 1) only = only.children[0];
          const column = only.kind === 'condition' ? range.s.c + Number(only.attrs['field-number']) : range.s.c;
          if (formula != null) filter.criteria = { [column]: { formula: `IFERROR(${formula},FALSE())` } };
        } catch { /* Malformed database ranges do not replace other sheet data. */ }
      }
    },
  };
}

/** Emit interoperable ODF predicates. App settings retain exact UI criteria. */
export function writeOdsFilter(filter, decodeRange, escape) {
  if (!filter?.criteria) return '';
  const range = decodeRange(filter.ref), parts = [];
  const node = (field, operator, value = '', extra = '', items = '') => `<table:filter-condition table:field-number="${field}" table:operator="${escape(operator)}" table:value="${escape(String(value))}"${extra}${items ? `>${items}</table:filter-condition>` : '/>'}`;
  for (const [key, crit] of Object.entries(filter.criteria)) {
    const field = Number(key) - range.s.c;
    if (!Number.isInteger(field) || field < 0 || field > range.e.c - range.s.c || !crit) continue;
    const rejectAll = () => parts.push(node(field, 'empty'), node(field, '!empty'));
    if (Array.isArray(crit.values) && !crit.values.length) { rejectAll(); continue; }
    if (Array.isArray(crit.values) && crit.values.length) {
      const items = crit.values.map(value => `<table:filter-set-item table:value="${escape(String(value))}"/>`).join('');
      parts.push(node(field, '=', crit.values[0], ` table:data-type="text" table:case-sensitive="${crit.caseSensitive !== false}"`, items));
    } else if (crit.op) {
      const operators = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', contains: 'contains', notContains: '!contains', beginsWith: 'begins', endsWith: 'ends', empty: 'empty', notEmpty: '!empty' };
      const number = value => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
      if (['contains', 'notContains', 'beginsWith', 'endsWith'].includes(crit.op) && !String(crit.value ?? '')) { rejectAll(); continue; }
      if (['gt', 'gte', 'lt', 'lte'].includes(crit.op) && !Number.isFinite(number(crit.value))) { rejectAll(); continue; }
      if (crit.op === 'between' && Number.isFinite(number(crit.value)) && Number.isFinite(number(crit.value2))) {
        parts.push(node(field, '>=', Math.min(number(crit.value), number(crit.value2)), ' table:data-type="number"'));
        parts.push(node(field, '<=', Math.max(number(crit.value), number(crit.value2)), ' table:data-type="number"'));
      } else if (operators[crit.op]) {
        const numeric = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(crit.op) && Number.isFinite(number(crit.value));
        parts.push(node(field, operators[crit.op], numeric ? number(crit.value) : crit.value ?? '', ` table:data-type="${numeric ? 'number' : 'text'}" table:case-sensitive="false"`));
      } else return '';
    } else if (crit.text != null && !crit.formula && crit.color == null) parts.push(node(field, 'contains', crit.text, ' table:data-type="text" table:case-sensitive="false"'));
    else return ''; // Never publish an incomplete conjunction in another reader.
  }
  return parts.length ? `<table:filter>${parts.length === 1 ? parts[0] : `<table:filter-and>${parts.join('')}</table:filter-and>`}</table:filter>` : '';
}
