import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { xmlText } from '../src/core/xlsx-export-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

const fill = '<fill><patternFill><bgColor rgb="FF98D070"/></patternFill></fill>';
const block = (formula, range = 'D7:D8 F3:F4', extra = '', paint = fill) =>
  `<x14:conditionalFormatting><x14:cfRule type="expression" priority="2" ${extra}><xm:f>${xmlText(formula)}</xm:f><x14:dxf>${paint}</x14:dxf></x14:cfRule><xm:sqref>${range}</xm:sqref></x14:conditionalFormatting>`;
const extension = xml => `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:conditionalFormattings>${xml}</x14:conditionalFormattings></ext></extLst>`;
const look = (w, r, c) => w.conditionalStyle(w.activeSheetId, r, c, w.getValue(w.activeSheetId, r, c));
async function nativeOnly(w) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(w)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}

it('imports inline predicates, rebases unordered ranges, and preserves live edits/copy/export', async () => {
  let w = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { tail: extension(block('$B3>$A$1', undefined, 'stopIfTrue="1"')) } } }), 'extended.xlsx');
  w.setInput(w.activeSheetId, 0, 0, '10'); w.setInput(w.activeSheetId, 6, 1, '12'); w.setInput(w.activeSheetId, 2, 1, '4');
  for (let pass = 0; pass < 2; pass++) {
    expect(w.activeSheet.rules).toHaveLength(2);
    expect(w.activeSheet.rules.every(r => r.stopIfTrue)).toBe(true);
    expect(look(w, 6, 3)?.bg).toBe('#98d070'); expect(look(w, 2, 5)?.bg).toBeUndefined();
    w.setInput(w.activeSheetId, 0, 0, '20'); expect(look(w, 6, 3)?.bg).toBeUndefined();
    w.undo(); expect(look(w, 6, 3)?.bg).toBe('#98d070');
    w.pasteCells(w.activeSheetId, w.copyRange(w.activeSheetId, { r1: 6, c1: 3, r2: 7, c2: 3 }), 10, 3, { r: 6, c: 3 }, null, { conditionalFormats: w.copyConditionalFormats(w.activeSheetId, [6, 7], [3]) });
    w.setInput(w.activeSheetId, 10, 1, '15'); expect(look(w, 10, 3)?.bg).toBe('#98d070');
    w.undo(); w.undo();
    if (!pass) w = await nativeOnly(w);
  }
});

it('orders legacy and extended predicates together, including stop rules and explicit paint clears', () => {
  const xml = '<conditionalFormatting sqref="B2"><cfRule type="expression" priority="3" dxfId="0"><formula>TRUE</formula></cfRule></conditionalFormatting>'
    + extension(block('B2>0', 'B2', 'stopIfTrue="1"', '<font><b val="0"/></font><border><left/></border><fill><patternFill patternType="none"/></fill>'));
  const rules = readXlsxConditionalFormats(xml, { dxfs: [{ bg: '#ff0000', bold: true }] });
  const w = new Workbook({ sheets: [{ name: 'Data', rules }] });
  w.setInput(w.activeSheetId, 1, 1, '1');
  expect(look(w, 1, 1)).toMatchObject({ bg: 'transparent', bold: false, bl: false, blBorder: null });
  w.setInput(w.activeSheetId, 1, 1, '0'); expect(look(w, 1, 1)).toMatchObject({ bg: '#ff0000', bold: true });
});

it('resolves inline theme/indexed colors with the same differential-style reader', () => {
  const xml = block('TRUE', 'A1', '', '<font><color theme="1"/><name val="Example &amp; Sans"/></font><fill><patternFill><bgColor indexed="3"/></patternFill></fill><border><bottom style="double"><color rgb="FF123456"/></bottom></border>');
  const [rule] = readXlsxConditionalFormats(xml, {}, { themeElements: { clrScheme: [{ rgb: 'FFFFFF' }, { rgb: '456789' }] }, indexedColors: ['000000', 'FFFFFF', 'FF0000', 'ABCDEF'] });
  expect(rule.style).toMatchObject({ bg: { indexed: 3, base: '#abcdef', rgb: '#abcdef' }, color: { theme: 1, rgb: '#456789' }, font: 'font:Example & Sans', bb: true, bbBorder: { bs: 'double', bc: '#123456' } });
});

it('reads both operands of extended cell comparisons', () => {
  const xml = block('2', 'C4', '', fill).replace('type="expression"', 'type="cellIs" operator="between"').replace('</xm:f>', '</xm:f><xm:f>4</xm:f>');
  const rules = readXlsxConditionalFormats(xml, {}), w = new Workbook({ sheets: [{ name: 'Data', rules }] });
  for (const n of [1, 2, 3, 4, 5]) { w.setInput(w.activeSheetId, 3, 2, String(n)); expect(look(w, 3, 2)?.bg).toBe(n >= 2 && n <= 4 ? '#98d070' : undefined); }
});

it.each(['', '0', '-1', '1.5', 'bad'])('ignores invalid standalone priority %j without inventing a rule', priority => {
  const xml = block('TRUE', 'A1').replace('priority="2"', priority ? `priority="${priority}"` : '');
  expect(readXlsxConditionalFormats(xml, {})).toEqual([]);
});

it('ignores empty predicates and invalid ranges, and decodes XML-escaped formulas', () => {
  const xml = block('', 'A1') + block('TRUE', 'XFE1') + block('TRUE', 'A0') + block('A1="a&b"', 'A1 A1:B2');
  const rules = readXlsxConditionalFormats(xml, {});
  expect(rules).toHaveLength(2); expect(rules[0].value).toBe('A1="a&b"');
});
