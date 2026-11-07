import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds, detectDelimiter, decodeText } from '../src/core/io.js';
import {
  applyStep, csvTable, convertValue, detectType, evaluateQuery, initialSteps, loadResult, refreshAll, refreshQuery, saveQuery,
  queryByName, loadedTable, stepNames, stepFormula, normalizeQueries, uniqueQueryName, queryForTable, unloadQuery, deleteQuery,
  sheetNameFor, tableNameFor,
} from '../src/core/queries.js';

const io = { detectDelimiter, decodeText, workbookFromFile };
const CSV = 'Region,Product,Units,Price,Date,Active\nNorth,Widget,10,2.5,2024-01-05,true\nSouth,Gadget,4,10,2024-02-10,false\nNorth,Gadget,7,10,2024-03-15,true\nEast,Widget,,2.5,2024-01-20,true\nNorth,Widget,10,2.5,2024-01-05,true\n';
const base = () => csvTable(CSV, ',');
const run = (table, ...steps) => steps.reduce((t, s) => applyStep(t, s, {}), table);
const typed = () => {
  const t = base();
  return run(t, ...initialSteps(t));
};

describe('source and type detection', () => {
  it('reads delimited text as untyped Column1… and detects the types after promoting headers', () => {
    const t = base();
    expect(t.columns).toEqual(['Column1', 'Column2', 'Column3', 'Column4', 'Column5', 'Column6']);
    expect(t.rows).toHaveLength(6);
    const steps = initialSteps(t);
    expect(steps.map((s) => s.type)).toEqual(['promoteHeaders', 'changeType']);
    expect(steps[1].columns).toEqual({ Region: 'text', Product: 'text', Units: 'int', Price: 'decimal', Date: 'date', Active: 'bool' });
    const out = typed();
    expect(out.columns).toEqual(['Region', 'Product', 'Units', 'Price', 'Date', 'Active']);
    expect(out.rows[0]).toEqual(['North', 'Widget', 10, 2.5, 45296, true]);
    expect(out.rows[3][2]).toBeNull();
  });

  it('converts values the way Changed Type does, with errors for values that do not convert', () => {
    expect(convertValue('12', 'any', 'int')).toBe(12);
    expect(convertValue('2.5', 'any', 'int')).toBe(2);
    expect(convertValue('3.5', 'any', 'int')).toBe(4);
    expect(convertValue('abc', 'any', 'decimal')).toMatchObject({ error: 'DataFormat.Error' });
    expect(convertValue(45296, 'date', 'text')).toBe('1/5/2024');
    expect(convertValue('TRUE', 'any', 'bool')).toBe(true);
    expect(convertValue('', 'any', 'int')).toBeNull();
    expect(detectType(['1', '2', 'x'])).toBe('text');
    expect(detectType([1, 2.5])).toBe('decimal');
  });

  it('names steps as Power Query does and shows a formula for each', () => {
    const q = { name: 'Q', source: { kind: 'csv', name: 'sales.csv', text: CSV }, steps: [{ type: 'changeType', columns: { A: 'int' } }, { type: 'changeType', columns: { A: 'text' } }, { type: 'sortRows', keys: [{ column: 'A', desc: true }] }] };
    expect(stepNames(q)).toEqual(['Source', 'Changed Type', 'Changed Type1', 'Sorted Rows']);
    expect(stepFormula(q, 0)).toContain('Csv.Document(File.Contents("sales.csv")');
    expect(stepFormula(q, 2)).toBe('= Table.TransformColumnTypes(#"Changed Type",{{"A", type text}})');
    expect(stepFormula(q, 3)).toBe('= Table.Sort(#"Changed Type1",{{"A", Order.Descending}})');
  });
});

describe('applied steps', () => {
  it('removes and chooses columns, and reports a missing column', () => {
    expect(run(typed(), { type: 'removeColumns', columns: ['Price', 'Date'] }).columns).toEqual(['Region', 'Product', 'Units', 'Active']);
    expect(run(typed(), { type: 'selectColumns', columns: ['Units', 'Region'] }).columns).toEqual(['Units', 'Region']);
    expect(() => run(typed(), { type: 'removeColumns', columns: ['Nope'] })).toThrow(/column 'Nope'/);
  });

  it('filters rows by conditions and by a list of kept values', () => {
    const north = run(typed(), { type: 'filterRows', column: 'Region', join: 'and', conditions: [{ op: 'equals', value: 'North' }] });
    expect(north.rows).toHaveLength(3);
    const many = run(typed(), { type: 'filterRows', column: 'Units', join: 'and', conditions: [{ op: 'gt', value: 5 }] });
    expect(many.rows.map((r) => r[2])).toEqual([10, 7, 10]);
    const typedText = run(typed(), { type: 'filterRows', column: 'Units', join: 'or', conditions: [{ op: 'lt', value: '5' }, { op: 'isNull' }] });
    expect(typedText.rows.map((r) => r[2])).toEqual([4, null]);
    const kept = run(typed(), { type: 'filterRows', column: 'Region', join: 'and', conditions: [{ op: 'in', values: ['South', 'East'] }] });
    expect(kept.rows.map((r) => r[0])).toEqual(['South', 'East']);
    const contains = run(typed(), { type: 'filterRows', column: 'Product', join: 'and', conditions: [{ op: 'contains', value: 'Gad' }] });
    expect(contains.rows).toHaveLength(2);
    const dates = run(typed(), { type: 'filterRows', column: 'Date', join: 'and', conditions: [{ op: 'after', value: '2/1/2024' }] });
    expect(dates.rows).toHaveLength(2);
  });

  it('sorts stably with nulls first, ascending and descending over several keys', () => {
    const sorted = run(typed(), { type: 'sortRows', keys: [{ column: 'Units', desc: false }] });
    expect(sorted.rows.map((r) => r[2])).toEqual([null, 4, 7, 10, 10]);
    const two = run(typed(), { type: 'sortRows', keys: [{ column: 'Region', desc: false }, { column: 'Units', desc: true }] });
    expect(two.rows.map((r) => `${r[0]}${r[2]}`)).toEqual(['Eastnull', 'North10', 'North10', 'North7', 'South4']);
  });

  it('removes duplicates over all columns or chosen ones', () => {
    expect(run(typed(), { type: 'removeDuplicates', columns: null }).rows).toHaveLength(4);
    expect(run(typed(), { type: 'removeDuplicates', columns: ['Region'] }).rows.map((r) => r[0])).toEqual(['North', 'South', 'East']);
  });

  it('replaces text inside values or whole values only', () => {
    const t = run(typed(), { type: 'replaceValues', columns: ['Product'], find: 'dg', replace: 'DG', matchEntire: false });
    expect(t.rows.map((r) => r[1])).toEqual(['WiDGet', 'GaDGet', 'GaDGet', 'WiDGet', 'WiDGet']);
    const whole = run(typed(), { type: 'replaceValues', columns: ['Product'], find: 'dg', replace: 'DG', matchEntire: true });
    expect(whole.rows[0][1]).toBe('Widget');
    const num = run(typed(), { type: 'replaceValues', columns: ['Units'], find: '10', replace: '11', matchEntire: true });
    expect(num.rows.map((r) => r[2])).toEqual([11, 4, 7, null, 11]);
  });

  it('splits a column by a delimiter into numbered columns', () => {
    const t = { columns: ['Name', 'N'], types: ['text', 'int'], rows: [['Ada Lovelace King', 1], ['Alan Turing', 2], [null, 3]] };
    const each = applyStep(t, { type: 'splitColumn', column: 'Name', delimiter: ' ', mode: 'each' });
    expect(each.columns).toEqual(['Name.1', 'Name.2', 'Name.3', 'N']);
    expect(each.rows[1]).toEqual(['Alan', 'Turing', null, 2]);
    const left = applyStep(t, { type: 'splitColumn', column: 'Name', delimiter: ' ', mode: 'left' });
    expect(left.rows[0]).toEqual(['Ada', 'Lovelace King', 1]);
    const right = applyStep(t, { type: 'splitColumn', column: 'Name', delimiter: ' ', mode: 'right' });
    expect(right.rows[0]).toEqual(['Ada Lovelace', 'King', 1]);
  });

  it('adds an index, groups with aggregations, keeps top rows and removes blank rows', () => {
    const idx = run(typed(), { type: 'addIndex', column: 'Index', start: 1, increment: 1 });
    expect(idx.rows.map((r) => r.at(-1))).toEqual([1, 2, 3, 4, 5]);
    expect(idx.types.at(-1)).toBe('int');
    const g = run(typed(), { type: 'groupBy', keys: ['Region'], aggregations: [
      { name: 'Total', op: 'sum', column: 'Units' }, { name: 'Count', op: 'count' }, { name: 'Avg', op: 'avg', column: 'Price' },
      { name: 'Min', op: 'min', column: 'Units' }, { name: 'Max', op: 'max', column: 'Units' }] });
    expect(g.columns).toEqual(['Region', 'Total', 'Count', 'Avg', 'Min', 'Max']);
    expect(g.rows).toEqual([['North', 27, 3, 5, 7, 10], ['South', 4, 1, 10, 4, 4], ['East', null, 1, 2.5, null, null]]);
    expect(run(typed(), { type: 'keepFirst', count: 2 }).rows).toHaveLength(2);
    const blanks = { columns: ['A', 'B'], types: ['any', 'any'], rows: [['x', null], [null, ''], [null, 1]] };
    expect(applyStep(blanks, { type: 'removeBlankRows' }).rows).toEqual([['x', null], [null, 1]]);
  });

  it('renames, fills down, transforms text and promotes headers with unique names', () => {
    const t = { columns: ['A', 'B'], types: ['any', 'any'], rows: [['x', 'x'], [' a ', null], [null, 'b']] };
    expect(applyStep(t, { type: 'promoteHeaders' }).columns).toEqual(['x', 'x_1']);
    expect(applyStep(t, { type: 'renameColumns', renames: [['A', 'Alpha']] }).columns).toEqual(['Alpha', 'B']);
    expect(() => applyStep(t, { type: 'renameColumns', renames: [['A', 'B']] })).toThrow();
    expect(applyStep(t, { type: 'fillDown', columns: ['B'] }).rows.map((r) => r[1])).toEqual(['x', 'x', 'b']);
    expect(applyStep(t, { type: 'transformText', columns: ['A'], op: 'trim' }).rows[1][0]).toBe('a');
    expect(applyStep(t, { type: 'transformText', columns: ['A'], op: 'upper' }).rows[0][0]).toBe('X');
  });

  it('merges another query with a left outer join and expands its columns', async () => {
    const wb = new Workbook();
    saveQuery(wb, { name: 'Prices', source: { kind: 'csv', name: 'p.csv', text: 'Product,List\nWidget,3\nGadget,12\n' }, steps: [{ type: 'promoteHeaders' }, { type: 'changeType', columns: { List: 'int' } }] });
    const sales = saveQuery(wb, { name: 'Sales', source: { kind: 'csv', name: 's.csv', text: 'Product,Units\nWidget,2\nGizmo,1\nGadget,5\n' }, steps: [
      { type: 'promoteHeaders' }, { type: 'merge', query: 'Prices', left: ['Product'], right: ['Product'], kind: 'leftOuter', column: 'Prices', expand: ['List'] }] });
    const { table, error } = await evaluateQuery(wb, sales, io);
    expect(error).toBeNull();
    expect(table.columns).toEqual(['Product', 'Units', 'Prices.List']);
    expect(table.rows).toEqual([['Widget', '2', 3], ['Gizmo', '1', null], ['Gadget', '5', 12]]);
    sales.steps[1].kind = 'inner';
    expect((await evaluateQuery(wb, sales, io)).table.rows).toHaveLength(2);
    sales.steps[1].kind = 'leftAnti';
    expect((await evaluateQuery(wb, sales, io)).table.rows).toEqual([['Gizmo', '1', null]]);
  });

  it('previews any step and reports the step that fails', async () => {
    const wb = new Workbook();
    const q = saveQuery(wb, { name: 'Q', source: { kind: 'csv', name: 'a.csv', text: CSV }, steps: [...initialSteps(base()), { type: 'removeColumns', columns: ['Missing'] }] });
    const atSource = await evaluateQuery(wb, q, io, { upTo: 0 });
    expect(atSource.table.columns[0]).toBe('Column1');
    const all = await evaluateQuery(wb, q, io);
    expect(all.error.step).toBe(2);
    expect(all.error.message).toMatch(/Missing/);
  });

  it('refuses a query that references itself through another', async () => {
    const wb = new Workbook();
    saveQuery(wb, { name: 'A', source: { kind: 'query', query: 'B' }, steps: [] });
    saveQuery(wb, { name: 'B', source: { kind: 'query', query: 'A' }, steps: [] });
    const res = await evaluateQuery(wb, queryByName(wb, 'A'), io);
    expect(res.error.message).toMatch(/cyclic/i);
  });
});

describe('loading and refreshing', () => {
  function workbookWithTable() {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Name', 'Score'], ['Ann', 3], ['Bob', 5], ['Cy', 1]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
    const tableId = wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Scores' });
    return { wb, id, tableId };
  }

  it('loads a query from a table to a new sheet as a table named after the query, and refreshes it when the source changes', async () => {
    const { wb, id } = workbookWithTable();
    const query = saveQuery(wb, { name: 'Top Scores', source: { kind: 'table', table: 'Scores' }, steps: [
      { type: 'changeType', columns: { Name: 'text', Score: 'int' } }, { type: 'sortRows', keys: [{ column: 'Score', desc: true }] }] });
    const { table } = await evaluateQuery(wb, query, io);
    const res = loadResult(wb, query, table);
    expect(res.error).toBeUndefined();
    const sheet = wb.sheet(res.sheetId);
    expect(sheet.name).toBe('Top Scores');
    expect(sheet.tables[0].name).toBe('Top_Scores');
    expect([0, 1, 2, 3].map((r) => wb.getValue(res.sheetId, r, 0))).toEqual(['Name', 'Bob', 'Ann', 'Cy']);
    expect(queryByName(wb, 'Top Scores').rowCount).toBe(3);
    expect(queryForTable(wb, res.sheetId, res.tableId)?.name).toBe('Top Scores');

    // The source grows by a row; a refresh rewrites the output table and resizes it.
    wb.setInput(id, 4, 0, 'Dee'); wb.setInput(id, 4, 1, '9');
    expect(wb.tableByName('Scores').table.range.r2).toBe(4);
    const again = await refreshQuery(wb, queryByName(wb, 'Top Scores'), io);
    expect(again.rows).toBe(4);
    expect(wb.sheet(res.sheetId).tables[0].range).toMatchObject({ r1: 0, r2: 4, c1: 0, c2: 1 });
    expect([1, 2, 3, 4].map((r) => wb.getValue(res.sheetId, r, 0))).toEqual(['Dee', 'Bob', 'Ann', 'Cy']);

    // Fewer rows and columns: the table shrinks and the cells it left are cleared.
    const live = queryByName(wb, 'Top Scores');
    live.steps.push({ type: 'keepFirst', count: 1 }, { type: 'removeColumns', columns: ['Score'] });
    saveQuery(wb, live);
    await refreshQuery(wb, queryByName(wb, 'Top Scores'), io);
    expect(wb.sheet(res.sheetId).tables[0].range).toMatchObject({ r1: 0, r2: 1, c1: 0, c2: 0 });
    expect(wb.getValue(res.sheetId, 2, 0)).toBeNull();
    expect(wb.getValue(res.sheetId, 0, 1)).toBeNull();
  });

  it('follows a renamed output table and refreshes every query with Refresh All', async () => {
    const { wb, id } = workbookWithTable();
    const q = saveQuery(wb, { name: 'Copy', source: { kind: 'table', table: 'Scores' }, steps: [] });
    const out = loadResult(wb, q, (await evaluateQuery(wb, q, io)).table);
    wb.updateTable(out.sheetId, out.tableId, { name: 'Renamed' });
    wb.setInput(id, 1, 1, '30');
    saveQuery(wb, { name: 'Broken', source: { kind: 'table', table: 'Nope' }, steps: [] });
    const res = await refreshAll(wb, io);
    expect(res.refreshed).toBe(1);
    expect(res.failed.map((f) => f.name)).toEqual(['Broken']);
    expect(wb.getValue(out.sheetId, 1, 1)).toBe(30);
    expect(loadedTable(wb, queryByName(wb, 'Copy')).table.name).toBe('Renamed');
    expect(wb.toJSON().queries.find((x) => x.name === 'Copy').load.table).toBe('Renamed');
  });

  it('loads to an existing location, refuses overlapping a table, and unloads to a connection', async () => {
    const { wb, id } = workbookWithTable();
    const q = saveQuery(wb, { name: 'Q', source: { kind: 'csv', name: 'x.csv', text: 'a,b\n1,2\n' }, steps: [{ type: 'promoteHeaders' }] });
    const t = (await evaluateQuery(wb, q, io)).table;
    expect(loadResult(wb, q, t, { at: { sheetId: id, r: 1, c: 1 } }).error).toMatch(/overlap/);
    const ok = loadResult(wb, q, t, { at: { sheetId: id, r: 0, c: 5 } });
    expect(ok.sheetId).toBe(id);
    expect(wb.getValue(id, 1, 5)).toBe('1');
    unloadQuery(wb, queryByName(wb, 'Q'));
    expect(wb.getValue(id, 1, 5)).toBeNull();
    expect(wb.tableByName('Q')).toBeNull();
    expect(queryByName(wb, 'Q').load.kind).toBe('connection');
  });

  it('writes dates with a date format and errors as empty cells, counting them', async () => {
    const wb = new Workbook();
    const q = saveQuery(wb, { name: 'Dates', source: { kind: 'csv', name: 'd.csv', text: 'When,N\n2024-01-05,1\n2024-02-01,x\n' }, steps: [{ type: 'promoteHeaders' }, { type: 'changeType', columns: { When: 'date', N: 'int' } }] });
    const res = loadResult(wb, q, (await evaluateQuery(wb, q, io)).table);
    expect(res.errors).toBe(1);
    expect(wb.getCell(res.sheetId, 1, 0)).toMatchObject({ v: 45296, s: { fmt: 'date' } });
    expect(wb.getValue(res.sheetId, 2, 1)).toBeNull();
    expect(queryByName(wb, 'Dates').errorCount).toBe(1);
  });

  it('chooses free names for queries, sheets and tables', () => {
    const wb = new Workbook();
    saveQuery(wb, { name: 'Sales', source: { kind: 'blank' }, steps: [] });
    expect(uniqueQueryName(wb, 'Sales')).toBe('Sales (2)');
    wb.addSheet('Sales');
    expect(sheetNameFor(wb, 'Sales')).toBe('Sales (2)');
    expect(sheetNameFor(wb, 'a/b:c')).toBe('abc');
    expect(tableNameFor(wb, '2024 Sales')).toBe('_2024_Sales');
    deleteQuery(wb, queryByName(wb, 'Sales').id);
    expect(wb.queries).toEqual([]);
  });
});

describe('persistence', () => {
  const defs = () => [
    { name: 'Sales', source: { kind: 'csv', name: 'sales.csv', text: CSV, delimiter: ',' }, steps: [
      { type: 'promoteHeaders' }, { type: 'changeType', columns: { Units: 'int', Date: 'date' } },
      { type: 'filterRows', column: 'Region', join: 'or', conditions: [{ op: 'equals', value: 'North' }, { op: 'in', values: ['East', null] }] },
      { type: 'groupBy', keys: ['Region'], aggregations: [{ name: 'Units', op: 'sum', column: 'Units' }] }] },
    { name: 'Web data', source: { kind: 'web', url: 'https://example.test/data.csv' }, steps: [] },
    { name: 'Book', source: { kind: 'workbook', name: 'other.xlsx', item: 'Sheet1', rows: [['A', 'B'], [1, true], [null, 'x']] }, steps: [{ type: 'promoteHeaders' }] },
  ];

  it('drops malformed stored queries and keeps names unique', () => {
    const list = normalizeQueries([...defs(), { name: 'sales', source: {}, steps: [] }, { nope: 1 }, { name: 'X', source: { kind: 'evil' }, steps: [{ type: 'bad' }, { type: 'keepFirst', count: 3 }] }]);
    expect(list.map((q) => q.name)).toEqual(['Sales', 'Web data', 'Book', 'X']);
    expect(list[3].source).toEqual({ kind: 'blank' });
    expect(list[3].steps.map((s) => s.type)).toEqual(['keepFirst']);
  });

  it('survives the JSON draft round trip', () => {
    const wb = new Workbook();
    for (const d of defs()) saveQuery(wb, d);
    const again = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(again.queries.map((q) => q.name)).toEqual(['Sales', 'Web data', 'Book']);
    expect(again.queries[0].steps).toEqual(wb.queries[0].steps);
  });

  it('survives saving to XLSX and reopening, with the loaded table intact and refreshable', async () => {
    const wb = new Workbook();
    for (const d of defs()) saveQuery(wb, d);
    const sales = queryByName(wb, 'Sales');
    const res = loadResult(wb, sales, (await evaluateQuery(wb, sales, io)).table);
    expect(res.rows).toBe(2);
    const blob = await workbookToXlsx(wb);
    const reopened = await workbookFromFile(new Uint8Array(await blob.arrayBuffer()), 'q.xlsx');
    expect(reopened.queries.map((q) => q.name)).toEqual(['Sales', 'Web data', 'Book']);
    const q2 = queryByName(reopened, 'Sales');
    expect(q2.steps).toEqual(wb.queries[0].steps.map((s) => ({ ...s })));
    expect(q2.source.text).toBe(CSV);
    expect(q2.load).toMatchObject({ kind: 'table', table: 'Sales', sheet: 'Sales' });
    expect(queryByName(reopened, 'Book').source.rows).toEqual([['A', 'B'], [1, true], [null, 'x']]);
    const sheet = reopened.sheetByName('Sales');
    expect(sheet.tables[0].name).toBe('Sales');
    // The query edited after reopening refreshes over the reopened table.
    q2.steps.pop();
    saveQuery(reopened, q2);
    const again = await refreshQuery(reopened, queryByName(reopened, 'Sales'), io);
    expect(again.rows).toBe(4);
    expect(sheet.tables[0].range).toMatchObject({ r2: 4, c2: 5 });
  });

  it('survives an ODS round trip too', async () => {
    const wb = new Workbook();
    saveQuery(wb, defs()[0]);
    const blob = await workbookToOds(wb);
    const reopened = await workbookFromFile(new Uint8Array(await blob.arrayBuffer()), 'q.ods');
    expect(reopened.queries.map((q) => q.name)).toEqual(['Sales']);
  });
});
