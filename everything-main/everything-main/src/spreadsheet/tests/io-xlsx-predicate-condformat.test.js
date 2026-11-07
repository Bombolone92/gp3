import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { matchesRule, DATE_PERIODS, todaySerialUTC, numberOfText } from '../src/core/condformat.js';
import { conditionalRuleFormula } from '../src/core/condformat-formula.js';
import * as X from '../src/vendor/xlsx.mjs';

const parser = new (new JSDOM('').window.DOMParser)();
const range = { r1: 2, c1: 3, r2: 32, c2: 4 }, paint = { bg: '#aadd88', color: '#174411', br: true, brBorder: { bs: 'thin', bc: '#225533' } };
const values = [null, '', 0, 1, -2, 12.5, false, true, ' ', ' A * ? ~ " text ', '12.5', '1.25e1', '1-2', '0x10', '$12', '12%', '1,234', ' 12.5 ', '\u00a012.5\u00a0', '\t12.5\t', 'FALSE', 'A&B 🛒', { f: '1/0' }, { f: 'NA()' }, { f: '""' }, { f: '0.1+0.2' }, 1e21, '1 2', '\u200012.5\u2000', 'INF', '1e999'];
const definitions = [
  ['gt', '10'], ['gte', 12.5], ['lt', '0'], ['lte', '-2'], ['between', 20, 1],
  ['eq', '12.5'], ['neq', '12.5'], ['eq', '#DIV/0!'], ['eq', 'FALSE'], ['eq', ''],
  ['contains', '*'], ['contains', 'div'], ['contains', 'A&B 🛒'], ['contains', '?'], ['contains', ''],
  ['notContains', '~'], ['notContains', ''], ['beginsWith', ' a'], ['endsWith', 'text '],
  ['endsWith', '3'], ['empty'], ['notEmpty'], ['gt', 'bad'], ['between', 0, 'bad'],
  ['top', 2], ['bottom', 2], ['top', 1000], ['bottom', 0], ['top', 'bad'],
].map(([type, value, value2]) => ({ type, value, value2 }));
afterEach(() => vi.useRealTimers());
function populate(wb) {
  const id = wb.activeSheetId;
  wb.setCells(id, values.flatMap((v, i) => [3, 4].map(c => ({ r: i + 2, c, cell: v && typeof v === 'object' ? { ...v } : { v } }))));
}
const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
async function exported(wb, nativeOnly = true) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const sheet = parser.parseFromString(text('/xl/worksheets/sheet1.xml'), 'application/xml');
  expect(sheet.querySelector('parsererror')).toBeNull();
  if (nativeOnly) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  }
  return { sheet, back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'rules.xlsx') };
}

it.each(definitions)('preserves live %j predicates through native XLSX with typed values and errors', async definition => {
  const wb = new Workbook(); populate(wb);
  wb.addRule(wb.activeSheetId, { ...definition, range, style: paint });
  const before = wb.toJSON(), { back, sheet } = await exported(wb);
  expect(wb.toJSON()).toEqual(before);
  expect(sheet.querySelectorAll('cfRule')).toHaveLength(1);
  expect(sheet.querySelector('conditionalFormatting').getAttribute('sqref')).toBe('D3:E33');
  expect(back.activeSheet.rules).toHaveLength(1);
  for (let i = 0; i < values.length; i++) for (const c of [3, 4]) {
    expect(!!look(back, i + 2, c), `${i}: ${JSON.stringify(values[i])}`).toBe(!!look(wb, i + 2, c));
  }
  back.setInput(back.activeSheetId, 2, 3, '13'); wb.setInput(wb.activeSheetId, 2, 3, '13');
  expect(!!look(back, 2, 3)).toBe(!!look(wb, 2, 3));
  back.undo(); expect(!!look(back, 2, 3)).toBe(!!matchesRule(definition, null));
});

it.each(DATE_PERIODS.map(p => p.value))('exports the live date period %s relative to TODAY', async value => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 0, 5, 12));
  const wb = new Workbook(), id = wb.activeSheetId, today = todaySerialUTC();
  const days = [-400, -40, -8, -7, -1, 0, 0.9, 1, 6, 7, 40, 400];
  const g = { r1: 1, c1: 1, r2: days.length, c2: 2 };
  days.forEach((d, i) => wb.setCells(id, [{ r: i + 1, c: 1, cell: { v: today + d } }, { r: i + 1, c: 2, cell: { v: String(today + d) } }]));
  wb.addRule(id, { type: 'date', value, range: g, style: paint });
  const { back } = await exported(wb);
  for (const offset of [0, 1, 30, 365]) {
    vi.setSystemTime(new Date(2026, 0, 5 + offset, 12));
    for (let i = 0; i < days.length; i++) for (const c of [1, 2]) expect(!!look(back, i + 1, c)).toBe(!!look(wb, i + 1, c));
  }
});

it('uses the same plain-number grammar in matching and native expressions', () => {
  for (const whitespace of [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    expect(numberOfText(`${whitespace}+1.25e1${whitespace}`)).toBe(12.5);
  }
  for (const value of ['1 2', '1-2', '1/2', '0x10', '$12', '12%', '1,234', 'Infinity']) expect(numberOfText(value)).toBeNull();
  expect(conditionalRuleFormula({ type: 'unknown', range })).toBeNull();
  expect(conditionalRuleFormula({ type: 'unknown' })).toBeNull();
});

it.each([false, true])('preserves priorities, stops, clears and repeat saves (native-only=%s)', async nativeOnly => {
  let wb = new Workbook(); populate(wb);
  wb.addRule(wb.activeSheetId, { type: 'notEmpty', range, stopIfTrue: false, style: paint });
  wb.addRule(wb.activeSheetId, { type: 'gt', value: 10, range, stopIfTrue: true, style: { bg: '#ff0000', bold: true, bt: false } });
  wb.addRule(wb.activeSheetId, { type: 'empty', range, style: { bg: '#0000ff' } });
  const expected = values.map((_, i) => look(wb, i + 2, 3));
  for (let save = 0; save < 2; save++) {
    const { back, sheet } = await exported(wb, nativeOnly);
    expect([...sheet.querySelectorAll('cfRule')].map(n => n.getAttribute('priority'))).toEqual(['1', '2', '3']);
    expect([...sheet.querySelectorAll('cfRule')].map(n => n.getAttribute('stopIfTrue'))).toEqual(['0', '1', '1']);
    for (let i = 0; i < values.length; i++) expect(look(back, i + 2, 3)).toMatchObject(expected[i]);
    wb = back;
  }
});
