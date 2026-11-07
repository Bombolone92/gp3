import { describe, it, expect } from 'vitest';
import { BORDER_PRESETS, CELL_ALIGNMENTS, DEFAULT_BORDER, shadeCell, applyBorders, distributeColumns, alignCell, TEXT_DELIMITERS, SORT_CHOICES, detectDelimiter, textToTable, tableToText, sortTable, TABLE_ALIGNMENTS, setHeaderRow, alignTable, tableAlignment } from '../src/lib/tables.js';

const fakeApi = () => {
  const calls = [];
  const ok = (name) => async (input) => { calls.push([name, input]); return { success: true }; };
  return { calls, tables: { setShading: ok('shade'), clearShading: ok('clear'), setBorders: ok('borders'), distributeColumns: ok('distribute'), setCellProperties: ok('cell'), convertFromText: async (input) => { calls.push(['fromText', input]); return { success: true, table: { nodeId: 'tbl:new' } }; }, convertToText: ok('toText'), sort: ok('sort'), setRowOptions: ok('rowOptions'), setLayout: ok('layout'), getProperties: async ({ nodeId }) => ({ nodeId, alignment: 'center' }) } };
};

describe('table appearance', () => {
  it('offers the engine border presets and three vertical positions', () => {
    expect(BORDER_PRESETS.map((b) => b.id)).toEqual(['all', 'box', 'none']);
    expect(CELL_ALIGNMENTS.map((a) => a.id)).toEqual(['top', 'center', 'bottom']);
  });

  it('shades or clears the cell by node id', async () => {
    const api = fakeApi();
    await shadeCell(api, 'tc:1', '#fff2cc');
    await shadeCell(api, 'tc:1', null);
    expect(api.calls).toEqual([['shade', { nodeId: 'tc:1', color: '#fff2cc' }], ['clear', { nodeId: 'tc:1' }]]);
    await expect(shadeCell(api, null, '#000000')).rejects.toThrow('No cell');
  });

  it('routes borders, widths, and alignment and surfaces failures', async () => {
    const api = fakeApi();
    await applyBorders(api, 'tbl:1', 'box');
    await distributeColumns(api, 'tbl:1');
    await alignCell(api, 'tc:2', 'center');
    expect(api.calls).toEqual([
      ['borders', { nodeId: 'tbl:1', mode: 'applyTo', applyTo: 'all', border: null }],
      ['borders', { nodeId: 'tbl:1', mode: 'applyTo', applyTo: 'outside', border: DEFAULT_BORDER }],
      ['distribute', { nodeId: 'tbl:1' }],
      ['cell', { nodeId: 'tc:2', verticalAlign: 'center' }],
    ]);
    api.calls.length = 0;
    await applyBorders(api, 'tbl:1', 'none');
    expect(api.calls).toEqual([['borders', { nodeId: 'tbl:1', mode: 'applyTo', applyTo: 'all', border: null }]]);
    await applyBorders(api, 'tbl:1', 'all');
    expect(api.calls[2][1]).toEqual({ nodeId: 'tbl:1', mode: 'applyTo', applyTo: 'all', border: DEFAULT_BORDER });
    api.tables.setBorders = async () => ({ success: false, failure: { message: 'locked' } });
    await expect(applyBorders(api, 'tbl:1', 'all')).rejects.toThrow('locked');
    await expect(distributeColumns(api, null)).rejects.toThrow('No table');
  });
});

describe('text and tables', () => {
  it('detects tabs before commas', () => {
    expect(detectDelimiter('a\tb,c')).toBe('tab');
    expect(detectDelimiter('a,b')).toBe('comma');
    expect(detectDelimiter('plain')).toBeNull();
    expect(detectDelimiter(null)).toBeNull();
    expect(TEXT_DELIMITERS.map((d) => d.id)).toEqual(['tab', 'comma']);
  });

  it('converts text to a table and back, and sorts by the caret column', async () => {
    const api = fakeApi();
    expect(await textToTable(api, 'p1', 'comma')).toBe('tbl:new');
    await tableToText(api, 'tbl:new');
    await sortTable(api, 'tbl:new', 2, 'numberDesc');
    expect(api.calls).toEqual([
      ['fromText', { nodeId: 'p1', delimiter: 'comma' }],
      ['toText', { nodeId: 'tbl:new', delimiter: 'tab' }],
      ['sort', { nodeId: 'tbl:new', keys: [{ columnIndex: 2, direction: 'descending', type: 'number' }] }],
    ]);
    expect(SORT_CHOICES.map((c) => c.id)).toEqual(['textAsc', 'textDesc', 'numberAsc', 'numberDesc']);
  });

  it('refuses missing targets and bad choices', async () => {
    const api = fakeApi();
    await expect(textToTable(api, null, 'tab')).rejects.toThrow('No paragraph');
    await expect(tableToText(api, null)).rejects.toThrow('No table');
    await expect(sortTable(api, 'tbl:1', null, 'textAsc')).rejects.toThrow('No column');
    await expect(sortTable(api, 'tbl:1', 0, 'nope')).rejects.toThrow('No column');
    api.tables.convertFromText = async () => ({ success: false, failure: { message: 'no delimiter found' } });
    await expect(textToTable(api, 'p1', 'tab')).rejects.toThrow('no delimiter found');
  });
});

describe('rows and placement', () => {
  it('repeats a header row and aligns the table', async () => {
    const api = fakeApi();
    await setHeaderRow(api, 'tbl:1', 0, true);
    await setHeaderRow(api, 'tbl:1', 0, false);
    await alignTable(api, 'tbl:1', 'right');
    expect(api.calls).toEqual([
      ['rowOptions', { nodeId: 'tbl:1', rowIndex: 0, repeatHeader: true }],
      ['rowOptions', { nodeId: 'tbl:1', rowIndex: 0, repeatHeader: false }],
      ['layout', { nodeId: 'tbl:1', alignment: 'right' }],
    ]);
    expect(TABLE_ALIGNMENTS.map((a) => a.id)).toEqual(['left', 'center', 'right']);
  });

  it('reads the alignment, defaulting to left, and rejects bad input', async () => {
    const api = fakeApi();
    expect(await tableAlignment(api, 'tbl:1')).toBe('center');
    api.tables.getProperties = async () => ({});
    expect(await tableAlignment(api, 'tbl:1')).toBe('left');
    api.tables.getProperties = async () => { throw new Error('gone'); };
    expect(await tableAlignment(api, 'tbl:1')).toBe('left');
    await expect(setHeaderRow(api, 'tbl:1', null, true)).rejects.toThrow('No row');
    await expect(alignTable(api, 'tbl:1', 'middle')).rejects.toThrow('No alignment');
    await expect(alignTable(api, null, 'left')).rejects.toThrow('No table');
  });
});

describe('table properties', () => {
  it('converts measures and reads the dialog state from the engine properties', async () => {
    const { TABLE_WIDTH_MODES, unitToPt, ptToUnitValue, tableSizeState } = await import('../src/lib/tables.js');
    expect(TABLE_WIDTH_MODES.map((m) => m.id)).toEqual(['fit', 'fixed']);
    expect(unitToPt('1', 'in')).toBe(72);
    expect(unitToPt('2,54', 'cm')).toBeCloseTo(72, 5);
    expect(unitToPt('', 'in')).toBeNull();
    expect(unitToPt('abc', 'in')).toBeNaN();
    expect(unitToPt('-1', 'in')).toBeNaN();
    expect(ptToUnitValue(72, 'in')).toBe(1);
    expect(ptToUnitValue(72, 'cm')).toBe(2.54);
    expect(tableSizeState(null)).toEqual({ widthMode: 'keep', widthPt: null, paddingPt: null });
    expect(tableSizeState({ autoFitMode: 'fixedWidth', preferredWidthType: 'dxa', preferredWidth: 4320, defaultCellMargins: { topPt: 6, rightPt: 6, bottomPt: 6, leftPt: 6 } })).toEqual({ widthMode: 'fixed', widthPt: 216, paddingPt: 6 });
    expect(tableSizeState({ autoFitMode: 'fixedWidth', preferredWidthType: 'pct', preferredWidth: 2500, defaultCellMargins: { topPt: 0, rightPt: 5, bottomPt: 0, leftPt: 5 } })).toEqual({ widthMode: 'keep', widthPt: null, paddingPt: null });
  });

  it('writes only the settings given, addressing the caret column and row', async () => {
    const { applyTableProperties } = await import('../src/lib/tables.js');
    const calls = [];
    const ok = (name) => async (input) => { calls.push([name, input]); return { success: true }; };
    const api = { tables: { setLayout: ok('layout'), setColumnWidth: ok('col'), setRowHeight: ok('row'), setTableOptions: ok('options') } };
    const ctx = { tableNodeId: 'tbl:1', columnIndex: 2, rowIndex: 0 };
    expect(await applyTableProperties(api, ctx, { widthMode: 'fixed', widthPt: 216, columnWidthPt: 72, rowHeightPt: null, paddingPt: 4 })).toBe(3);
    expect(calls).toEqual([
      ['layout', { nodeId: 'tbl:1', autoFitMode: 'fixedWidth', preferredWidth: 4320, preferredWidthType: 'dxa' }],
      ['col', { nodeId: 'tbl:1', columnIndex: 2, widthPt: 72 }],
      ['options', { nodeId: 'tbl:1', defaultCellMargins: { topPt: 4, rightPt: 4, bottomPt: 4, leftPt: 4 } }],
    ]);
    calls.length = 0;
    expect(await applyTableProperties(api, ctx, { widthMode: 'fit', rowHeightPt: 36 })).toBe(2);
    expect(calls).toEqual([
      ['layout', { nodeId: 'tbl:1', autoFitMode: 'fitWindow' }],
      ['row', { nodeId: 'tbl:1', rowIndex: 0, heightPt: 36, rule: 'atLeast' }],
    ]);
    await expect(applyTableProperties(api, {}, {})).rejects.toThrow('No table');
    // The 22-inch DOCX page limit: past it the table cannot be seen whole here or opened faithfully elsewhere.
    for (const sizes of [{ widthMode: 'fixed', widthPt: 1585 }, { columnWidthPt: 2000 }, { rowHeightPt: 100000 }]) {
      await expect(applyTableProperties(api, ctx, sizes)).rejects.toThrow('up to 22 inches');
    }
    expect(await applyTableProperties(api, ctx, { widthMode: 'fixed', widthPt: 1584, columnWidthPt: 1584, rowHeightPt: 1584 })).toBe(3);
    // A table already wider than the limit can still be fitted to the page or given padding: only a fixed width is checked.
    expect(await applyTableProperties(api, ctx, { widthMode: 'fit', widthPt: 72000, paddingPt: 4 })).toBe(2);
    expect(await applyTableProperties(api, ctx, { widthPt: 72000, paddingPt: 4 })).toBe(1);
  });
});

describe('table captions', () => {
  it('adds a numbered "Table" caption above the table', async () => {
    const { captionTable } = await import('../src/lib/tables.js');
    const calls = [];
    const api = { captions: { insert: async (i) => { calls.push(i); return { success: true, caption: { kind: 'block', nodeType: 'paragraph', nodeId: 'cap1' } }; } } };
    expect(await captionTable(api, 'tbl:1', '  Sales by region ')).toBe('cap1');
    // Typed with its label, as the hint shows it, the caption is not numbered twice.
    expect(await captionTable(api, 'tbl:1', 'Table 1: Costs')).toBe('cap1');
    expect(calls.map((call) => call.text)).toEqual(['Sales by region', 'Costs']);
    expect(calls[0]).toEqual({ adjacentTo: { kind: 'block', nodeType: 'table', nodeId: 'tbl:1' }, position: 'above', label: 'Table', text: 'Sales by region' });
    await expect(captionTable(api, null, 'x')).rejects.toThrow('No table');
  });

  it('finds the caption paragraph above a table and nothing else', async () => {
    const { findTableCaption, captionTable } = await import('../src/lib/tables.js');
    const nodes = { cap: { styleRef: 'Caption', inlines: [{ kind: 'run', run: { text: 'Table ' } }, { kind: 'field', field: { resolvedText: '1' } }, { kind: 'run', run: { text: ': Sales' } }] }, plain: { inlines: [{ kind: 'run', run: { text: 'Intro' } }] } };
    const api = (order) => ({
      blocks: { list: async () => ({ blocks: order.map((nodeId) => ({ nodeId, nodeType: nodeId.startsWith('tbl') ? 'table' : 'paragraph' })) }) },
      getNodeById: async ({ nodeId }) => ({ node: { paragraph: nodes[nodeId] } }),
    });
    expect(await findTableCaption(api(['plain', 'cap', 'tbl:1']), 'tbl:1')).toEqual({ nodeId: 'cap', text: 'Table 1: Sales' });
    // A figure's caption above the table is the picture's, whatever its text says.
    const figure = { ...api(['plain', 'cap', 'tbl:1']), captions: { get: async () => ({ label: 'Figure', number: 1, text: 'Sales' }) } };
    expect(await findTableCaption(figure, 'tbl:1')).toBeNull();
    const table = { ...api(['plain', 'cap', 'tbl:1']), captions: { get: async () => ({ label: 'Table', number: 1, text: 'Sales' }) } };
    expect(await findTableCaption(table, 'tbl:1')).toEqual({ nodeId: 'cap', text: 'Table 1: Sales' });
    nodes.cap.inlines = [{ kind: 'run', run: { text: 'Figure 1: Sales' } }];
    expect(await findTableCaption(api(['plain', 'cap', 'tbl:1']), 'tbl:1')).toBeNull();
    nodes.cap.inlines = [{ kind: 'run', run: { text: 'Table 1: Sales' } }];
    expect(await findTableCaption(api(['cap', 'plain', 'tbl:1']), 'tbl:1')).toBeNull();
    expect(await findTableCaption(api(['tbl:1', 'cap']), 'tbl:1')).toBeNull();
    expect(await findTableCaption(api(['tbl:2', 'tbl:1']), 'tbl:1')).toBeNull();
    expect(await findTableCaption({}, 'tbl:1')).toBeNull();
    await expect(captionTable({ captions: { insert: async () => ({ success: false, failure: { message: 'nope' } }) } }, 'tbl:1', 'x')).rejects.toThrow('nope');
  });
});

describe('splitting and row sizes', () => {
  it('splits above the caret row and distributes rows', async () => {
    const { splitTable, distributeRows } = await import('../src/lib/tables.js');
    const calls = [];
    const api = { tables: { split: async (i) => { calls.push(['split', i]); return { success: true }; }, distributeRows: async (i) => { calls.push(['rows', i]); return { success: true }; } } };
    await splitTable(api, 'tbl:1', 2);
    await distributeRows(api, 'tbl:1');
    expect(calls).toEqual([['split', { nodeId: 'tbl:1', rowIndex: 2 }], ['rows', { nodeId: 'tbl:1' }]]);
    await expect(splitTable(api, 'tbl:1', 0)).rejects.toThrow('below the first');
    await expect(splitTable(api, null, 1)).rejects.toThrow('No table');
    await expect(distributeRows(api, null)).rejects.toThrow('No table');
  });
});

describe('alternate rows', () => {
  it('shades every second row and clears the rest, or clears all', async () => {
    const { bandRows, tableCells, BAND_COLOR } = await import('../src/lib/tables.js');
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) cells.push({ nodeId: `tc${r}${c}`, rowIndex: r, columnIndex: c });
    const calls = [];
    const api = { tables: {
      getCells: async ({ nodeId }) => ({ nodeId, cells }),
      setShading: async (i) => { calls.push(['set', i.nodeId, i.color]); return { success: true }; },
      clearShading: async (i) => { calls.push(['clear', i.nodeId]); return { success: true }; },
    } };
    expect((await tableCells(api, 't1')).length).toBe(6);
    expect(await bandRows(api, 't1', BAND_COLOR)).toBe(2);
    expect(calls.filter((c) => c[0] === 'set').map((c) => c[1])).toEqual(['tc10', 'tc11']);
    expect(calls.filter((c) => c[0] === 'clear').map((c) => c[1])).toEqual(['tc00', 'tc01', 'tc20', 'tc21']);
    calls.length = 0;
    expect(await bandRows(api, 't1', null)).toBe(0);
    expect(calls.every((c) => c[0] === 'clear')).toBe(true);
    expect(calls).toHaveLength(6);
    await expect(bandRows(api, null, BAND_COLOR)).rejects.toThrow('No table');
  });
});
