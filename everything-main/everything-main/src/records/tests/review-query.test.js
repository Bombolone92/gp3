import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inferType, planFromRows, baseFromPlan, addTableFromPlan, appendPlan, decodeText, importFileDialog } from '../src/ui/importer.js';
import { Base } from '../src/data/base.js';
import { exportRows } from '../src/ui/exporter.js';
import { baseWith, makeChoice } from './helpers/base.js';
import { runView, sortRecords, groupRecords } from '../src/data/query.js';
import { parseCSV } from '../src/lib/csv.js';
import { parseNumber, formatPercent, parseDate } from '../src/lib/format.js';
import { mountApp, openBase, tick } from './helpers/app.js';
import { parseText, convertValue, splitList, listText } from '../src/data/fields.js';

describe('import', () => {
  it('does not read decimal-comma currency as whole amounts', () => {
    // "€1,50" is one and a half euros: as currency it would import empty.
    expect(inferType(['€1,50', '€2,25']).type).toBe('text');
    expect(inferType(['€1,500', '€2,250.75']).type).toBe('currency');
    const plan = planFromRows([['Name', 'Price'], ['A', '€1,50'], ['B', '€2,25']]);
    const { doc, records } = baseFromPlan(plan, 'Shop');
    const t = doc.tables[0];
    const price = t.fields.find((f) => f.name === 'Price');
    expect(records[t.id].map((r) => r.c[price.id])).toEqual(['€1,50', '€2,25']);
  });

  it('keeps the decimals of small numbers written with an exponent', () => {
    expect(inferType(['1e-5', '2.5e-3'])).toEqual({ type: 'number', options: { precision: 5 } });
    expect(inferType(['1.5e3', '2'])).toEqual({ type: 'number', options: { precision: 0 } });
    expect(inferType(['(1.25)', '3.5'])).toEqual({ type: 'number', options: { precision: 2 } });
  });

  it('does not read fractions or ranges as dates', () => {
    expect(inferType(['1/2', '3/4']).type).toBe('text');
    expect(inferType(['1-2', '3-5', '10-12']).type).toBe('text');
    expect(inferType(['1/2/26', '3/4/26']).type).toBe('date');
    expect(inferType(['2026-01-02', '1/3/2026']).type).toBe('date');
    expect(inferType(['Jan 5, 2026', 'Feb 6, 2026']).type).toBe('date');
  });
});

describe('parseNumber', () => {
  it('rejects European grouping with a decimal comma', () => {
    expect(parseNumber('1.234,56')).toBe(null);
    expect(parseNumber('1.2.3')).toBe(null);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('.5')).toBe(0.5);
  });
});

describe('parseNumber with letters and signs', () => {
  it('reads the typographic minus and rejects codes', () => {
    expect(parseNumber('−5')).toBe(-5);
    expect(parseNumber('−$5.00')).toBe(-5);
    expect(parseNumber('ID-42')).toBe(null);
    expect(parseNumber('Q3')).toBe(null);
    expect(parseNumber('Apt 4B')).toBe(null);
    // Still numbers: symbols, exponents, and units apart from the digits.
    expect(parseNumber('4e3')).toBe(4000);
    expect(parseNumber('2.5E-3')).toBe(0.0025);
    expect(parseNumber('-€5')).toBe(-5);
    expect(parseNumber('5 kg')).toBe(5);
    // Units written against the number, as before.
    expect(parseNumber('5kg')).toBe(5);
    expect(parseNumber('12h')).toBe(12);
    expect(parseNumber('1,200USD')).toBe(1200);
    expect(parseNumber('4B2')).toBe(null);
    expect(parseNumber('USD 5')).toBe(5);
    // Currencies with a letter symbol show as "CHF5.00".
    expect(parseNumber('-CHF5.00')).toBe(-5);
  });
});

const fld = (type, options = {}) => ({ id: `fld${type}`, name: type, type, options });

describe('rounding', () => {
  it('rounds typed values the way they show', () => {
    expect(parseText(fld('currency', { symbol: '$', precision: 2 }), '1.005')).toBe(1.01);
    expect(parseText(fld('number', { precision: 1 }), '0.35')).toBe(0.4);
    expect(parseText(fld('number', { precision: 0 }), '-2.5')).toBe(-3);
    expect(formatPercent(0.145, 0)).toBe('15%');
    expect(formatPercent(0.25, 0)).toBe('25%');
  });
});

describe('converting between number types', () => {
  it('keeps the value when a percent or currency becomes a number', () => {
    expect(convertValue(fld('percent', { precision: 0 }), fld('number', { precision: 0 }), 0.25)).toBe(0.25);
    expect(convertValue(fld('currency', { precision: 2 }), fld('number', { precision: 0 }), 19.99)).toBe(19.99);
  });
});

describe('converting numbers and checkboxes', () => {
  it('checks any number but zero', () => {
    const box = fld('checkbox');
    expect(convertValue(fld('number', { precision: 2 }), box, 1)).toBe(true);
    expect(convertValue(fld('number', { precision: 0 }), box, 5)).toBe(true);
    expect(convertValue(fld('number', { precision: 0 }), box, 0)).toBe(false);
    expect(convertValue(fld('currency', { precision: 2 }), box, -3)).toBe(true);
  });

  it('turns a checked box into 1 in every number type', () => {
    expect(convertValue(fld('checkbox'), fld('number'), true)).toBe(1);
    expect(convertValue(fld('checkbox'), fld('currency', { precision: 2 }), true)).toBe(1);
    expect(convertValue(fld('checkbox'), fld('percent'), true)).toBe(1);
    expect(convertValue(fld('checkbox'), fld('rating', { max: 5 }), true)).toBe(1);
    // A second is no meaningful duration for a checked box.
    expect(convertValue(fld('checkbox'), fld('duration'), true)).toBe(null);
    expect(convertValue(fld('checkbox'), fld('currency'), false)).toBe(null);
    expect(convertValue(fld('checkbox'), fld('number'), false)).toBe(0);
  });
});

describe('lists with quotes in names', () => {
  const choices = [{ id: 'selA', name: '27" monitor', color: 'blue' }, { id: 'selB', name: 'Desk, oak', color: 'red' }, { id: 'selC', name: '"Quoted"', color: 'green' }];
  const multi = fld('multipleSelect', { choices });

  it('keeps a quote inside a name', () => {
    expect(splitList('27" monitor')).toEqual(['27" monitor']);
    expect(splitList('a, 27" monitor, "b, c"')).toEqual(['a', '27" monitor', 'b, c']);
    expect(splitList('"say ""hi"", ok", x')).toEqual(['say "hi", ok', 'x']);
  });

  it('round trips names with quotes and commas', () => {
    const text = listText(multi, ['selA', 'selB', 'selC']);
    // Only names that would split, or start with a quote, are quoted.
    expect(text).toBe('27" monitor, "Desk, oak", """Quoted"""');
    expect(listText(multi, ['selA'])).toBe('27" monitor');
    expect(parseText(multi, text)).toEqual({ value: ['selA', 'selB', 'selC'], newChoices: [] });
    // A single option with a quote becomes one option of a multiple select.
    const single = fld('singleSelect', { choices });
    expect(convertValue(single, multi, 'selA')).toEqual({ value: ['selA'], newChoices: [] });
    expect(convertValue(single, multi, 'selB')).toEqual({ value: ['selB'], newChoices: [] });
  });
});

describe('appending rows', () => {
  it('keeps the options made when two columns go to the same select field', () => {
    const base = new Base({ v: 1, id: 'appX', name: 'X', tables: [] }, {});
    const tid = addTableFromPlan(base, planFromRows(parseCSV('Name,Size\nA,S\nB,M\nC,S\nD,M'), { name: 'Shirts' }));
    const t = base.table(tid);
    const size = t.fieldByName('Size');
    const plan = planFromRows(parseCSV('Name,Size,Other size\nE,XL,\nF,,XXL'));
    appendPlan(base, tid, plan, [t.primary.id, size.id, size.id]);
    const ids = new Set(t.fieldByName('Size').options.choices.map((c) => c.id));
    const added = t.ordered().slice(4).map((r) => r.c[size.id]);
    expect(added.every((id) => ids.has(id))).toBe(true);
    expect(added.map((id) => t.fieldByName('Size').options.choices.find((c) => c.id === id).name)).toEqual(['XL', 'XXL']);
  });
});

describe('importing many options', () => {
  const rows = (n) => [['Name', 'Tag'], ...Array.from({ length: n }, (_, i) => [`Item ${i}`, `Tag ${i}`])];

  it('reads a column with many distinct values as text', () => {
    // The first 500 rows repeat a few values; the rest are all different.
    const data = [['Name', 'Kind'], ...Array.from({ length: 5000 }, (_, i) => [`Item ${i}`, i < 500 ? `K${i % 5}` : `Kind ${i}`])];
    expect(planFromRows(data).columns[1].type).toBe('text');
    const few = [['Name', 'Kind'], ...Array.from({ length: 5000 }, (_, i) => [`Item ${i}`, `K${i % 7}`])];
    expect(planFromRows(few).columns[1].type).toBe('singleSelect');
  });

  it('makes 30,000 options quickly when the column is a select', () => {
    for (const type of ['singleSelect', 'multipleSelect']) {
      const plan = planFromRows(rows(30_000));
      plan.columns[1].type = type;
      const t0 = performance.now();
      const { doc, records } = baseFromPlan(plan, 'Tags');
      expect(performance.now() - t0).toBeLessThan(3000);
      const t = doc.tables[0];
      const tag = t.fields.find((f) => f.name === 'Tag');
      expect(tag.options.choices.length).toBe(30_000);
      // Colors still go round in turn.
      expect(tag.options.choices.slice(0, 3).map((c) => c.color)).toEqual(['blue', 'cyan', 'teal']);
      const last = records[t.id][29_999].c[tag.id];
      expect(tag.options.choices.find((c) => c.id === (type === 'singleSelect' ? last : last[0])).name).toBe('Tag 29999');
    }
  });

  it('appends 30,000 new options quickly', () => {
    const base = new Base({ v: 1, id: 'appX', name: 'X', tables: [] }, {});
    const tid = addTableFromPlan(base, planFromRows(parseCSV('Name,Size\nA,S\nB,M\nC,S\nD,M'), { name: 'Shirts' }));
    const t = base.table(tid);
    const size = t.fieldByName('Size');
    const t0 = performance.now();
    appendPlan(base, tid, planFromRows(rows(30_000)), [t.primary.id, size.id]);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(t.fieldByName('Size').options.choices.length).toBe(30_002);
  });
});

describe('reading a CSV file', () => {
  const utf16 = (str, le) => {
    const out = [le ? 0xff : 0xfe, le ? 0xfe : 0xff];
    for (const ch of str) {
      const c = ch.charCodeAt(0);
      out.push(...(le ? [c & 255, c >> 8] : [c >> 8, c & 255]));
    }
    return new Uint8Array(out);
  };

  it('honors byte order marks and falls back to Windows-1252', () => {
    const text = 'Name,City\nZoë,Köln';
    expect(decodeText(new TextEncoder().encode(text))).toBe(text);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text);
    expect(decodeText(utf16(text, true))).toBe(text);
    expect(decodeText(utf16(text, false))).toBe(text);
    // Excel's "CSV" on Windows: Windows-1252, where é is 0xE9 and € is 0x80.
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x80, 0x35]))).toBe('Café,€5');
    // A UTF-8 file with one stray byte stays UTF-8: only that byte is lost.
    const mostly = new Uint8Array([...new TextEncoder().encode('José,Zürich,'), 0xe9, ...new TextEncoder().encode(',Ærø')]);
    expect(decodeText(mostly)).toBe('José,Zürich,\ufffd,Ærø');
  });

  it('previews a Windows-1252 file with its accents', async () => {
    document.body.replaceChildren();
    const bytes = new Uint8Array([...new TextEncoder().encode('Name,Price\n'), 0x43, 0x61, 0x66, 0xe9, 0x2c, 0x35, 0x0a]);
    await importFileDialog({ file: new File([bytes], 'menu.csv'), onDone: () => {} });
    expect(document.querySelector('.import-table tbody td').textContent).toBe('Café');
    document.body.replaceChildren();
  });
});

describe('exporting times', () => {
  it('exports created and modified times exactly', () => {
    const { base, table } = baseWith([{ name: 'Created', type: 'createdTime' }, { name: 'Modified', type: 'lastModifiedTime' }], { now: () => Date.UTC(2026, 2, 5, 14, 30, 15) });
    base.createRecords(table.id, [{}]);
    const [head, row] = exportRows(base, table, null);
    expect(row[head.indexOf('Created')]).toBe('2026-03-05T14:30:15.000Z');
    expect(row[head.indexOf('Modified')]).toBe('2026-03-05T14:30:15.000Z');
  });
});

describe('date filters where the clocks change at midnight', () => {
  // Node reads TZ again when it changes. In Santiago, 6 September 2026 starts
  // at 1:00: midnight is skipped.
  let tz;
  beforeAll(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/Santiago';
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('keeps tomorrow out of today', () => {
    expect(new Date(2026, 8, 6).getHours()).toBe(1);
    const { base, table, f } = baseWith([{ name: 'Due', type: 'date' }], { now: () => new Date(2026, 8, 6, 12).getTime() });
    const due = f('Due').id;
    const name = f('Name').id;
    base.createRecords(table.id, ['2026-09-05', '2026-09-06', '2026-09-07', '2026-10-06', '2026-10-07'].map((d) => ({ [name]: d, [due]: d })));
    const view = table.views[0];
    const check = (op, value) => {
      base.updateView(table.id, view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: due, op, value }] } });
      return runView(base, table, view).records.map((r) => r.c[name]);
    };
    expect(check('is', { mode: 'today' })).toEqual(['2026-09-06']);
    expect(check('isOnOrBefore', { mode: 'today' })).toEqual(['2026-09-05', '2026-09-06']);
    expect(check('isAfter', { mode: 'today' })).toEqual(['2026-09-07', '2026-10-06', '2026-10-07']);
    expect(check('is', { mode: 'oneMonthFromNow' })).toEqual(['2026-10-06']);
    expect(check('isWithin', { mode: 'pastWeek' })).toEqual(['2026-09-05', '2026-09-06']);
    expect(check('isWithin', { mode: 'nextMonth' })).toEqual(['2026-09-06', '2026-09-07', '2026-10-06']);
  });
});

describe('number filters', () => {
  it('treat a value equal to the target as equal for every operator', () => {
    const { base, table, f } = baseWith([{ name: 'Qty', type: 'number', options: { precision: 2 } }]);
    const qty = f('Qty').id;
    const name = f('Name').id;
    base.createRecords(table.id, [{ [name]: 'sum', [qty]: 0.1 + 0.2 }, { [name]: 'less', [qty]: 0.29 }, { [name]: 'more', [qty]: 0.31 }]);
    const view = table.views[0];
    const check = (op) => {
      base.updateView(table.id, view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: qty, op, value: '0.3' }] } });
      return runView(base, table, view).records.map((r) => r.c[name]);
    };
    expect(check('=')).toEqual(['sum']);
    expect(check('>')).toEqual(['more']);
    expect(check('<')).toEqual(['less']);
    expect(check('>=')).toEqual(['sum', 'more']);
    expect(check('<=')).toEqual(['sum', 'less']);
    expect(check('!=')).toEqual(['less', 'more']);
  });
});

describe('group paths', () => {
  it('are different for every group, under blank groups too', () => {
    const { base, table, f } = baseWith([{ name: 'Owner', type: 'text' }, { name: 'Sub', type: 'text' }]);
    const [o, sub] = [f('Owner').id, f('Sub').id];
    base.createRecords(table.id, [{ [sub]: 'bob' }, { [o]: 'bob', [sub]: 'x' }, { [o]: 'a/b' }, { [o]: 'a', [sub]: 'b' }]);
    const tree = groupRecords(base, table, table.ordered().slice(), [{ fieldId: o }, { fieldId: sub }]);
    const paths = [];
    const walk = (nodes) => nodes.forEach((n) => (paths.push(n.path), n.children && walk(n.children)));
    walk(tree);
    expect(paths.length).toBe(8);
    expect(new Set(paths).size).toBe(8);
    // Paths of groups under a named group read as before.
    expect(paths).toContain('bob/x');
  });
});

describe('grouping by several values', () => {
  it('puts the same options in one group whatever their order', () => {
    const x = makeChoice('X');
    const y = makeChoice('Y', [x]);
    const { base, table, f } = baseWith([{ name: 'Tags', type: 'multipleSelect', options: { choices: [x, y] } }]);
    const tags = f('Tags').id;
    const link = base.addField(table.id, { name: 'Rel', type: 'link', options: { tableId: table.id } });
    const [a, b] = base.createRecords(table.id, [{}, {}]);
    base.createRecords(table.id, [{ [tags]: [y.id, x.id], [link]: [b, a] }, { [tags]: [x.id, y.id], [link]: [a, b] }]);
    const recs = table.ordered().slice(2);
    const byTags = groupRecords(base, table, recs, [{ fieldId: tags }]);
    expect(byTags.length).toBe(1);
    expect(byTags[0].value).toEqual([x.id, y.id]);
    expect(groupRecords(base, table, recs, [{ fieldId: link }]).length).toBe(1);
  });
});

describe('sorting lookups', () => {
  it('sorts by the looked-up values, not their text', () => {
    const { base, table, f } = baseWith();
    const name = f('Name').id;
    const deals = base.addTable('Deals');
    const dt = base.table(deals);
    const amount = base.addField(deals, { name: 'Amount', type: 'currency', options: { symbol: '$', precision: 2 } });
    const when = base.addField(deals, { name: 'When', type: 'date', options: { dateFormat: 'us' } });
    const ids = base.createRecords(deals, [
      { [amount]: 1000, [when]: '2026-02-01' },
      { [amount]: 200, [when]: '2026-10-01' },
      { [amount]: -5, [when]: '2026-09-15' },
    ]);
    const link = base.addField(table.id, { name: 'Deal', type: 'link', options: { tableId: deals } });
    const lookAmount = base.addField(table.id, { name: 'Amounts', type: 'lookup', options: { linkFieldId: link, targetFieldId: amount } });
    const lookWhen = base.addField(table.id, { name: 'Whens', type: 'lookup', options: { linkFieldId: link, targetFieldId: when } });
    const unique = base.addField(table.id, { name: 'Unique', type: 'rollup', options: { linkFieldId: link, targetFieldId: amount, fn: 'unique' } });
    base.createRecords(table.id, ids.map((id, i) => ({ [name]: `r${i}`, [link]: [id] })));
    void dt;
    const order = (fieldId) => {
      const recs = table.ordered().slice();
      sortRecords(base, table, recs, [{ fieldId, dir: 'asc' }]);
      return recs.map((r) => r.c[name]);
    };
    expect(order(lookAmount)).toEqual(['r2', 'r1', 'r0']);
    expect(order(lookWhen)).toEqual(['r0', 'r2', 'r1']);
    expect(order(unique)).toEqual(['r2', 'r1', 'r0']);
  });
});

describe('views over formulas with NOW()', () => {
  it('filter again as the minutes pass', () => {
    let now = Date.UTC(2026, 9, 12, 12, 0);
    const { base, table, f } = baseWith([{ name: 'Start', type: 'date', options: { includeTime: true } }], { now: () => now });
    const start = f('Start').id;
    const age = base.addField(table.id, { name: 'Age', type: 'formula', options: { formula: `TONOW({${start}}, "minutes")` } });
    base.createRecords(table.id, [{ [start]: new Date(now - 3 * 60000).toISOString() }]);
    const view = table.views[0];
    base.updateView(table.id, view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: age, op: '>', value: 5 }] } });
    expect(runView(base, table, view).records.length).toBe(0);
    now += 10 * 60000;
    expect(runView(base, table, view).records.length).toBe(1);
  });

  it('keep the same result within a minute', () => {
    let now = Date.UTC(2026, 9, 12, 12, 0, 5);
    const { base, table } = baseWith([], { now: () => now });
    const view = table.views[0];
    const formula = base.addField(table.id, { name: 'F', type: 'formula', options: { formula: 'NOW()' } });
    base.updateView(table.id, view.id, { sorts: [{ fieldId: formula, dir: 'asc' }] });
    const a = runView(base, table, view);
    now += 30000;
    expect(runView(base, table, view)).toBe(a);
  });
});

describe('pasting between date fields', () => {
  // Away from GMT, so a time read as local would move.
  let tz;
  beforeAll(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  async function gridWith(fields) {
    const { app, store } = await mountApp();
    const page = await openBase(app, await store.createBase());
    const t = page.table;
    const ids = fields.map((f) => page.base.addField(t.id, f));
    page.base.createRecords(t.id, [{ [t.primary.id]: 'A' }]);
    await tick();
    return { page, g: page.viewInst, t, ids };
  }

  function copyCell(g, r, c) {
    g.scroller.focus();
    g.setCursor(r, c);
    let copied = '';
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    copy.clipboardData = { setData: (type, v) => (copied = v) };
    document.dispatchEvent(copy);
    return copied;
  }

  it('keeps the date, not the text a European field shows', async () => {
    const { page, g, t, ids } = await gridWith([
      { name: 'EU', type: 'date', options: { dateFormat: 'european', includeTime: false } },
      { name: 'US', type: 'date', options: { dateFormat: 'us', includeTime: false } },
    ]);
    const rec = t.ordered()[0].id;
    page.base.setCell(t.id, rec, ids[0], '2026-12-10');
    await tick();
    const col = (id) => g.layout.cols.findIndex((x) => x.field.id === id);
    const text = copyCell(g, 0, col(ids[0]));
    expect(text).toBe('10/12/2026');
    g.setCursor(0, col(ids[1]));
    g.pasteText(text);
    expect(t.record(rec).c[ids[1]]).toBe('2026-12-10');
  });

  it('keeps the moment of a time shown in GMT', async () => {
    const { page, g, t, ids } = await gridWith([
      { name: 'GMT', type: 'date', options: { dateFormat: 'iso', includeTime: true, gmt: true } },
      { name: 'Local', type: 'date', options: { dateFormat: 'iso', includeTime: true, gmt: false } },
      { name: 'Day', type: 'date', options: { dateFormat: 'iso', includeTime: false } },
    ]);
    const rec = t.ordered()[0].id;
    page.base.setCell(t.id, rec, ids[0], '2026-03-05T14:00:00.000Z');
    await tick();
    const col = (id) => g.layout.cols.findIndex((x) => x.field.id === id);
    const text = copyCell(g, 0, col(ids[0]));
    g.setCursor(0, col(ids[1]));
    g.pasteText(text);
    expect(t.record(rec).c[ids[1]]).toBe('2026-03-05T14:00:00.000Z');
    // A day-only field gets the day the GMT field shows.
    g.setCursor(0, col(ids[2]));
    g.pasteText(text);
    expect(t.record(rec).c[ids[2]]).toBe('2026-03-05');
  });

  it('reads a GMT or UTC suffix on typed times', () => {
    const local = { includeTime: true, gmt: false };
    expect(parseDate('3/5/2026 2:00pm GMT', local)).toBe('2026-03-05T14:00:00.000Z');
    expect(parseDate('3/5/2026 14:00 UTC', local)).toBe('2026-03-05T14:00:00.000Z');
    expect(parseDate('3/5/2026 11:30pm GMT', { includeTime: false })).toBe('2026-03-05');
  });
});
