import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const cases = [
  ['between', 2, 4, 3, 5], ['notBetween', 2, 4, 1, 3], ['equal', 2, undefined, 2, 3], ['notEqual', 2, undefined, 3, 2],
  ['greaterThan', 2, undefined, 3, 2], ['lessThan', 2, undefined, 1, 2], ['greaterThanOrEqual', 2, undefined, 2, 1], ['lessThanOrEqual', 2, undefined, 2, 3],
];
const types = ['number', 'whole', 'text', 'date', 'time'];
const number = (type, n) => n == null ? undefined : type === 'date' ? n + 45000 : type === 'time' ? n / 24 : n;
const value = (type, n) => type === 'text' ? 'x'.repeat(n) : number(type, n);
const scenarios = types.flatMap(type => cases.map(([operator, min, max, good, bad]) => ({ type, operator, min: number(type, min), max: number(type, max), good: value(type, good), bad: value(type, bad) })));
it.each(scenarios)('enforces $type $operator with explicit boundary examples', test => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addValidation(id, { ...test, range: { r1: 0, c1: 0, r2: 2, c2: 0 }, allowBlank: false });
  expect(wb.validateValue(id, 0, 0, test.good).ok).toBe(true); expect(wb.validateValue(id, 0, 0, test.bad).ok).toBe(false);
  expect(wb.validateValue(id, 0, 0, '').ok).toBe(false);
});
it('distinguishes whole-number and time candidates from text and logical values while keeping legacy numeric strings', () => {
  const wb = new Workbook(), id = wb.activeSheetId, range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  wb.addValidation(id, { range, type: 'whole', min: 2, max: 6 });
  for (const bad of [4.5, '4', true, Infinity]) expect(wb.validateValue(id, 0, 0, bad).ok).toBe(false);
  wb.addValidation(id, { range, type: 'time', min: .25, max: .75 });
  for (const bad of ['0.5', true, Infinity]) expect(wb.validateValue(id, 0, 0, bad).ok).toBe(false);
  expect(wb.validateValue(id, 0, 0, .5).ok).toBe(true);
  wb.addValidation(id, { range, type: 'number', operator: 'greaterThan', min: 2 });
  expect(wb.validateValue(id, 0, 0, '4').ok).toBe(true);
  expect(wb.validateValue(id, 0, 0, '0x10').ok).toBe(false); expect(wb.validateValue(id, 0, 0, true).ok).toBe(false);
});
it('restores comparison criteria and validity with Undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId, rule = wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, type: 'whole', operator: 'greaterThan', min: 2 });
  wb.clearHistory(); wb.updateValidation(id, rule, { operator: 'lessThan' });
  expect(wb.validateValue(id, 0, 0, 3).ok).toBe(false); wb.undo(); expect(wb.validateValue(id, 0, 0, 3).ok).toBe(true);
});
it.each(['xlsx', 'ods'])('preserves all comparisons and candidate validity through public %s records', async format => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [i, test] of scenarios.entries()) wb.addValidation(id, { type: test.type, operator: test.operator, min: test.min, max: test.max, range: { r1: i, c1: 0, r2: i, c2: 0 }, allowBlank: false, promptTitle: 'Criteria', prompt: 'Synthetic rule' });
  let blob = await (format === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb)), data = await blob.arrayBuffer();
  if (format === 'xlsx') {
    const zip = X.CFB.read(new Uint8Array(data), { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    data = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  }
  const back = await workbookFromFile(data, `comparisons.${format}`), out = back.activeSheetId;
  for (const [i, test] of scenarios.entries()) {
    expect(back.validateValue(out, i, 0, test.good).ok, `${test.type} ${test.operator}: good`).toBe(true);
    expect(back.validateValue(out, i, 0, test.bad).ok, `${test.type} ${test.operator}: bad`).toBe(false);
    expect(back.validateValue(out, i, 0, '').ok).toBe(false);
    expect(back.validationAt(out, i, 0)).toMatchObject({ promptTitle: 'Criteria', prompt: 'Synthetic rule' });
    if (format === 'xlsx' && ['whole', 'time'].includes(test.type)) expect(back.validationAt(out, i, 0).type).toBe(test.type);
  }
});
it('lets Any Value retain messages without imposing type or blank constraints', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 1, c2: 0 }, type: 'any', promptTitle: 'Help', prompt: 'Enter any value' });
  for (const val of ['', 'Text', 4.5, true]) expect(wb.validateValue(id, 0, 0, val).ok).toBe(true);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'any.xlsx');
  expect(back.validationAt(back.activeSheetId, 0, 0)).toMatchObject({ type: 'any', prompt: 'Enter any value' });
});
