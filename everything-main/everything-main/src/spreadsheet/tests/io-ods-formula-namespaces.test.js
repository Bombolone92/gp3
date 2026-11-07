import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

const OF = 'urn:oasis:names:tc:opendocument:xmlns:of:1.2';
const escape = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const cell = (formula = 'fx:=2*3', attrs = '', empty = false) => `<table:table-cell ${attrs} table:formula="${escape(formula)}" office:value-type="float" office:value="6"${empty ? '/>' : '></table:table-cell>'}`;
const named = (formula = 'fx:=2*3', attrs = '') => `<table:named-expressions><table:named-expression table:name="Result" table:expression="${escape(formula)}" table:base-cell-address="$Data.$A$1" ${attrs}/></table:named-expressions>`;
async function read({ root = `xmlns:fx="${OF}"`, rows, local = '', global = '', before = '', format = 'fods' } = {}) {
  const tag = format === 'ods' ? 'document-content' : 'document';
  const xml = `<?xml version="1.0"?><office:${tag} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ${root} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet>${before}<table:table table:name="Data"><table:table-column/>${rows || `<table:table-row>${cell()}</table:table-row>`}${local}</table:table>${global}</office:spreadsheet></office:body></office:${tag}>`;
  let bytes = new TextEncoder().encode(xml);
  if (format === 'ods') {
    const base = X.utils.book_new();
    X.utils.book_append_sheet(base, X.utils.aoa_to_sheet([[0]]), 'Data');
    const zip = X.CFB.read(new Uint8Array(X.write(base, { type: 'array', bookType: 'ods' })), { type: 'array' });
    X.CFB.utils.cfb_add(zip, 'content.xml', bytes);
    bytes = X.CFB.write(zip, { fileType: 'zip', type: 'array' });
  }
  return workbookFromFile(bytes, `formulas.${format}`);
}
const value = (wb, r = 0, c = 0) => wb.getValue(wb.activeSheetId, r, c);

it.each(['fx', 'Formula', '__proto__', 'form_ula'])('resolves root formula namespace %s', async prefix => {
  const wb = await read({ root: `xmlns:${prefix}="${OF}"`, rows: `<table:table-row>${cell(`${prefix}:=2*3`)}</table:table-row>` });
  expect(value(wb)).toBe(6);
  expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe('2*3');
});
it.each(['fods', 'ods'])('imports live OpenFormula expressions in %s', async format => {
  const wb = await read({ format, rows: `<table:table-row>${cell('fx:=IF(TRUE();SUM({1;2|3;4});0)')}${cell('fx:=[.A1]*2')}</table:table-row>` });
  expect(value(wb)).toBe(10); expect(value(wb, 0, 1)).toBe(20);
  wb.setInput(wb.activeSheetId, 0, 0, '7'); expect(value(wb, 0, 1)).toBe(14);
});
it.each(['local', 'global'])('resolves %s named expression namespaces', async scope => {
  const wb = await read({ [scope]: named('fx:=SUM({1;2|3;4})') });
  wb.setInput(wb.activeSheetId, 0, 0, '=Result'); expect(value(wb)).toBe(10);
});
it('resolves a named expression declaration on the element itself', async () => {
  const wb = await read({ root: '', global: named('fx:=2*3', `xmlns:fx="${OF}"`) });
  wb.setInput(wb.activeSheetId, 0, 0, '=Result'); expect(value(wb)).toBe(6);
});
it('honors row and cell scopes and restores bindings after closing tags', async () => {
  const wb = await read({ rows: `<table:table-row xmlns:fx="urn:unsupported">${cell('fx:=2*3', `xmlns:fx="${OF}"`)}${cell()}</table:table-row><table:table-row>${cell()}</table:table-row>` });
  expect(value(wb)).toBe(6); expect(value(wb, 0, 1)).toEqual({ error: '#ERROR!' }); expect(value(wb, 1)).toBe(6);
});
it('restores bindings after self-closing cells', async () => {
  const wb = await read({ rows: `<table:table-row>${cell('fx:=2*3', 'xmlns:fx="urn:unsupported"', true)}${cell()}</table:table-row>` });
  expect(value(wb)).toEqual({ error: '#ERROR!' }); expect(value(wb, 0, 1)).toBe(6);
});
it('rejects a rebound conventional prefix in both cells and names', async () => {
  const wb = await read({ root: 'xmlns:of="urn:unsupported"', rows: `<table:table-row>${cell('of:=2*3')}</table:table-row>`, global: named('of:=2*3') });
  expect(value(wb)).toEqual({ error: '#ERROR!' });
  wb.setInput(wb.activeSheetId, 0, 0, '=Result'); expect(value(wb)).toEqual({ error: '#NAME?' });
});
it('does not bind namespaces from comments or quoted attribute text', async () => {
  const wb = await read({ root: `office:note="xmlns:fx='${OF}'"`, before: `<!-- <fake xmlns:fx="${OF}"> -->` });
  expect(value(wb)).toEqual({ error: '#ERROR!' });
});
it('keeps namespace prefixes case sensitive', async () => {
  const wb = await read({ root: `xmlns:FX="${OF}"` }); expect(value(wb)).toEqual({ error: '#ERROR!' });
});
it('retains default OpenFormula and recognizes the legacy Calc URI', async () => {
  const wb = await read({ root: 'xmlns:legacy="http://openoffice.org/2004/calc"', rows: `<table:table-row>${cell('=2*3')}${cell('legacy:=2*3')}${cell('="https://example.com"')}</table:table-row>` });
  expect(value(wb)).toBe(6); expect(value(wb, 0, 1)).toBe(6); expect(value(wb, 0, 2)).toBe('https://example.com');
});
it.each(['ods', 'xlsx'])('preserves imported formulas and names through %s export', async format => {
  let wb = await read({ global: named(), rows: `<table:table-row>${cell('fx:=Result*2')}</table:table-row>` });
  wb = await workbookFromFile(await (format === 'ods' ? workbookToOds(wb) : workbookToXlsx(wb)), `saved.${format}`);
  expect(value(wb)).toBe(12);
});

it('retains legacy undeclared of formulas without accepting explicit rebindings', async () => {
  const wb = await read({ root: '', rows: `<table:table-row>${cell('of:=2*3')}${cell('of:=2*3', 'xmlns:of="urn:unsupported"')}${cell('of:=2*3')}</table:table-row>`, global: named('of:=2*3') });
  expect(value(wb)).toBe(6); expect(value(wb, 0, 1)).toEqual({ error: '#ERROR!' }); expect(value(wb, 0, 2)).toBe(6);
  wb.setInput(wb.activeSheetId, 0, 0, '=Result'); expect(value(wb)).toBe(6);
});
it('can alternate stable root prefixes with scoped declarations', async () => {
  const wb = await read({ root: `xmlns:of="${OF}"`, rows: `<table:table-row xmlns:fx="${OF}">${cell('of:=2*3')}${cell()}${cell('of:=2*3')}</table:table-row><table:table-row>${cell()}${cell('of:=2*3')}</table:table-row>` });
  for (const c of [0, 1, 2]) expect(value(wb, 0, c)).toBe(6);
  expect(value(wb, 1)).toEqual({ error: '#ERROR!' }); expect(value(wb, 1, 1)).toBe(6);
});
it('honors a late namespace redefinition after many ordinary formulas', async () => {
  const wb = await read({ rows: `<table:table-row>${cell().repeat(8)}${cell('fx:=2*3', 'xmlns:fx="urn:unsupported"')}${cell()}</table:table-row>` });
  for (let c = 0; c < 8; c++) expect(value(wb, 0, c)).toBe(6);
  expect(value(wb, 0, 8)).toEqual({ error: '#ERROR!' }); expect(value(wb, 0, 9)).toBe(6);
});
it('keeps stable aliases distinct from longer and unknown prefixes', async () => {
  const wb = await read({ root: `xmlns:fx="${OF}" xmlns:fxExtra="urn:unsupported"`, rows: `<table:table-row>${cell()}${cell()}${cell('fxExtra:=2*3')}${cell()}${cell('missing:=2*3')}</table:table-row>` });
  for (const c of [0, 1, 3]) expect(value(wb, 0, c)).toBe(6);
  for (const c of [2, 4]) expect(value(wb, 0, c)).toEqual({ error: '#ERROR!' });
});
it('switches between a stable alias and a prefix declared on a single cell', async () => {
  const wb = await read({ rows: `<table:table-row>${cell()}${cell()}${cell('local:=2*3', `xmlns:local="${OF}"`)}${cell('local:=2*3')}${cell()}</table:table-row>` });
  for (const c of [0, 1, 2, 4]) expect(value(wb, 0, c)).toBe(6);
  expect(value(wb, 0, 3)).toEqual({ error: '#ERROR!' });
});
