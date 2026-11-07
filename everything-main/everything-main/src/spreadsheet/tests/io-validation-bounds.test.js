import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookToOds } from '../src/core/io.js';

// A rule's bounds come from the sidecar of an older file or a hand-edited one as well as from
// the dialog, so a bound may be text, blank, or infinite. Such a bound was interpolated into
// the file's formula as it was (>=NaN, >=Infinity, and a blank as <=0), which Excel reports
// as a corrupt file; a bound that is not a finite number is left out of the file's rule.
function book(rules) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  rules.forEach((rule, i) => wb.addValidation(id, { ...rule, range: { r1: i, c1: 0, r2: i, c2: 0 } }));
  return wb;
}
async function xlsxRules(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  return [...xml.matchAll(/<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation>/g)].map((m) => m[0].replace(/&gt;/g, '>').replace(/&lt;/g, '<'));
}
async function odsConditions(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
  return [...xml.matchAll(/table:condition="([^"]*)"/g)].map((m) => m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"'));
}

it('writes only finite number bounds into an .xlsx rule', async () => {
  const rules = await xlsxRules(book([
    { type: 'number', min: 'abc', max: 10 },
    { type: 'number', min: Infinity },
    { type: 'number', min: '1e3', max: '' },
    { type: 'number', min: 2, max: 8 },
  ]));
  expect(rules).toHaveLength(4);
  expect(rules[0]).toContain('VALUE(A1)<=10');
  expect(rules[0]).not.toMatch(/NaN|>=/);
  expect(rules[1]).not.toMatch(/Infinity/);
  expect(rules[1]).toContain('ISNUMBER(VALUE(A2))');
  expect(rules[2]).toContain('VALUE(A3)>=1000');
  expect(rules[2]).not.toContain('<=');
  expect(rules[3]).toContain('VALUE(A4)>=2');
  expect(rules[3]).toContain('VALUE(A4)<=8');
});

it('writes only finite date and text-length bounds into an .xlsx rule', async () => {
  const rules = await xlsxRules(book([
    { type: 'date', min: 'soon', max: 45000 },
    { type: 'text', min: 2, max: 'many' },
    { type: 'date', min: -Infinity },
  ]));
  expect(rules[0]).toContain('operator="between"');
  expect(rules[0]).toContain('<formula1>0</formula1><formula2>45000</formula2>');
  expect(rules[1]).toContain('operator="greaterThanOrEqual"');
  expect(rules[1]).toContain('<formula1>2</formula1>');
  expect(rules[1]).not.toContain('formula2');
  expect(rules[2]).toContain('<formula1>0</formula1>');
  expect(rules.join('')).not.toMatch(/NaN|Infinity|many|soon/);
});

it('writes only finite bounds into an .ods condition', async () => {
  const conditions = await odsConditions(book([
    { type: 'number', min: 'abc', max: 10 },
    { type: 'number', min: Infinity },
    { type: 'text', min: '1e3', max: '' },
    { type: 'date', min: 2, max: 8 },
  ]));
  expect(conditions).toHaveLength(4);
  expect(conditions[0]).toContain('cell-content()<=10');
  expect(conditions[0]).not.toMatch(/NaN|abc/);
  expect(conditions[1]).toContain('is-true-formula(TRUE())');
  expect(conditions[1]).not.toContain('Infinity');
  expect(conditions[2]).toContain('cell-content-text-length()>=1000');
  expect(conditions[3]).toContain('cell-content-is-between(2,8)');
});
