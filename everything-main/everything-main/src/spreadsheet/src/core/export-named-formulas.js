import { mapTableRefs, parseTableSpec } from './tables.js';
import { tokenize } from './formula/tokenizer.js';
import { tableReferenceTokens } from './formula/names.js';
import { isError } from './formula/functions.js';

function currentRowReference(wb, sheet, table, spec) {
  const row = table.range.r1 + 1;
  const resolved = wb.resolveTableRef(sheet.id, row, table.range.c1, table.name, spec);
  if (isError(resolved)) return resolved.error;
  // A range shrinks when a boundary is deleted, unlike individual corner
  // cells. Including the header also keeps insertions at the first data row.
  const source = wb.refTextFor(sheet.id, { r1: table.range.r1, r2: table.range.r2, c1: resolved.c1, c2: resolved.c2 });
  const header = wb.refTextFor(sheet.id, { r1: table.range.r1, r2: table.range.r1, c1: resolved.c1, c2: resolved.c2 });
  const firstRow = `ROW(OFFSET(${source},0,0,1,1))`;
  // Named table rows use the caller's row on any worksheet. Unqualified
  // references are restricted to their owning sheet by callingTableReference.
  const valid = `AND(ROW()>=${firstRow}+IFERROR(ROWS(${header}),0),ROW()<${firstRow}+ROWS(${source})${table.totalsRow ? '-1' : ''})`;
  // OFFSET reads only the selected row. INDEX over the complete table can
  // evaluate other rows and introduce false circular dependencies.
  const ref = `OFFSET(${source},ROW()-${firstRow},0,1,COLUMNS(${source}))`;
  return `IF(${valid},${ref},#VALUE!)`;
}

function choices(clauses) {
  let out = '#REF!';
  // IFS selects lazily; grouping also stays below Excel's argument limit.
  for (let end = clauses.length; end > 0; end -= 120) {
    out = `IFS(${clauses.slice(Math.max(0, end - 120), end).flat().join(',')},TRUE,${out})`;
  }
  return out;
}

function callingTableReference(wb, spec) {
  const parsed = parseTableSpec(spec);
  if (!parsed) return '#REF!';
  const sheets = [];
  for (const sheet of wb.sheets) {
    const tables = [], identities = [];
    for (const table of sheet.tables) {
      const { r1, c1 } = table.range;
      const source = wb.refTextFor(sheet.id, table.range);
      const first = `OFFSET(${source},0,0,1,1)`;
      identities.push([`ISREF(${source})`, `SHEET(${source})`]);
      // A deleted source must not prevent selecting a surviving table.
      const condition = `IFERROR(AND(ROW()>=ROW(${first}),ROW()<ROW(${first})+ROWS(${source}),COLUMN()>=COLUMN(${first}),COLUMN()<COLUMN(${first})+COLUMNS(${source})),FALSE)`;
      let ref;
      if (parsed.rows === 'this') ref = currentRowReference(wb, sheet, table, spec);
      else {
        const resolved = wb.resolveTableRef(sheet.id, r1 + 1, c1, table.name, spec);
        // Keep a single cell as a reference through the IFS branches too.
        ref = isError(resolved) ? resolved.error : `IF(TRUE,${wb.refTextFor(sheet.id, resolved)})`;
      }
      tables.push([condition, ref]);
    }
    if (tables.length) {
      // A surviving source identifies the sheet even after earlier sources
      // are deleted. Address checks do not evaluate those source cells.
      sheets.push([`IFERROR(SHEET()=${choices(identities)},FALSE)`, choices(tables)]);
    }
  }
  return choices(sheets);
}

/** Keep caller-dependent table references dynamic in exported named formulas. */
export function exportNamedTableReferences(wb, formula) {
  const bindings = [];
  const references = new Map();
  let tokens, actualReferences, used, index = 0;
  const rewritten = mapTableRefs(formula, (tableName, spec, token) => {
    if (tableName && parseTableSpec(spec)?.rows !== 'this') return null;
    tokens ??= tokenize(formula);
    actualReferences ??= new Set(tableReferenceTokens(formula, tokens).map((t) => t.start));
    if (!actualReferences.has(token.start)) return null;
    const key = `${tableName?.toLowerCase() || ''}[${spec}]`;
    if (references.has(key)) return `${references.get(key)}()`;
    let expression;
    if (tableName) {
      const found = wb.tableByName(tableName);
      if (!found) return '#NAME?';
      expression = currentRowReference(wb, found.sheet, found.table, spec);
    } else expression = callingTableReference(wb, spec);
    if (expression.startsWith('#')) return expression;
    // The outer closure keeps generated function calls outside user LET and
    // LAMBDA bindings. Resolve the reference only when the original uses it.
    used ??= new Set(tokens.flatMap((t) => t.type === 'name' ? [t.value]
      : t.type === 'tref' && t.table === null && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(t.spec.trim()) ? [t.spec.trim().toUpperCase()] : []));
    let name;
    do { name = `_puter_rowref_${++index}`; } while (used.has(name.toUpperCase()));
    used.add(name.toUpperCase());
    bindings.push([name, `LAMBDA(${expression})`]);
    references.set(key, name);
    return `${name}()`;
  });
  let out = rewritten;
  // Leave room below Excel's maximum number of LET bindings.
  for (let end = bindings.length; end > 0; end -= 120) {
    out = `LET(${bindings.slice(Math.max(0, end - 120), end).flat().join(',')},${out})`;
  }
  return out;
}
