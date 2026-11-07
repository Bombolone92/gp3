import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const style = (name, parent, format) => `<style:style style:name="${name}" style:family="table-cell"${parent ? ` style:parent-style-name="${parent}"` : ''}${format ? ` style:data-style-name="${format}"` : ''}/>`;
function file(mode, common, automatic = '', cellStyle = 'child') {
  const ns = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"`;
  const formats = `<number:number-style style:name="N1"><number:number number:decimal-places="2" number:min-integer-digits="1"/></number:number-style>
    <number:number-style style:name="N2"><number:number number:decimal-places="3" number:min-integer-digits="1"/></number:number-style>`;
  const root = mode === 'fods' ? 'document' : 'document-content';
  const content = new TextEncoder().encode(`<?xml version="1.0"?><office:${root} ${ns} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
    ${mode === 'fods' ? `<office:styles>${formats}${common}</office:styles>` : ''}
    <office:automatic-styles>${automatic}</office:automatic-styles>
    <office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>
      <table:table-cell table:style-name="${cellStyle}" office:value-type="float" office:value="7.5" table:number-columns-repeated="2"/>
      <table:table-cell office:value-type="float" office:value="12"/>
    </table:table-row></table:table></office:spreadsheet></office:body></office:${root}>`);
  if (mode === 'fods') return content;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
  XLSX.CFB.utils.cfb_add(zip, 'content.xml', content);
  XLSX.CFB.utils.cfb_add(zip, 'styles.xml', new TextEncoder().encode(`<?xml version="1.0"?><office:document-styles ${ns} office:version="1.2"><office:styles>${formats}${common}</office:styles></office:document-styles>`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
async function check(mode, common, automatic, expected, cellStyle) {
  const wb = await workbookFromFile(file(mode, common, automatic, cellStyle), `inheritance.${mode}`);
  for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
    for (const c of [0, 1]) {
      expect(back.getValue(back.activeSheetId, 0, c)).toBe(7.5);
      expect(back.getDisplay(back.activeSheetId, 0, c)).toBe(expected);
    }
    expect(back.getDisplay(back.activeSheetId, 0, 2)).toBe('12');
  }
}

it.each(['fods', 'ods'].flatMap((mode) => [false, true].flatMap((automaticChild) =>
  [false, true].map((reverse) => ({ mode, automaticChild, reverse })),
)))('inherits a number format through common parent styles: %j', async ({ mode, automaticChild, reverse }) => {
  const common = [style('base', null, 'N1'), style('middle', 'base')];
  const child = style('child', 'middle');
  if (!automaticChild) common.push(child);
  if (reverse) common.reverse();
  await check(mode, common.join(''), automaticChild ? child : '', '7.50');
});

it.each(['fods', 'ods'])('resolves parent names that match object properties in %s', async (mode) => {
  await check(mode, style('__proto__', null, 'N1') + style('constructor', '__proto__'), style('child', 'constructor'), '7.50');
});

it.each(['fods', 'ods'].flatMap((mode) => [
  { mode, common: style('parent', null, 'N1'), automatic: style('child', 'parent', 'N2'), expected: '7.500' },
  { mode, common: style('child', 'missing'), automatic: '', expected: '7.5' },
  { mode, common: style('child', 'child'), automatic: '', expected: '7.5' },
  { mode, common: style('child', 'parent') + style('parent', 'child'), automatic: '', expected: '7.5' },
  { mode, common: style('child', 'parent') + style('parent', 'child', 'N1'), automatic: '', expected: '7.50' },
  // A parent must be a common style, even when an automatic style has the same name.
  { mode, common: style('parent', null, 'N1'), automatic: style('parent', null, 'N2') + style('child', 'parent'), expected: '7.50' },
  { mode, common: '', automatic: style('parent', null, 'N2') + style('child', 'parent'), expected: '7.5' },
]))('handles explicit formats and invalid parent links: %j', async ({ mode, common, automatic, expected }) => {
  await check(mode, common, automatic, expected);
});

it('imports a deep parent hierarchy without recursive stack growth', async () => {
  const common = Array.from({ length: 20000 }, (_, i) => style(`s${i}`, i === 19999 ? null : `s${i + 1}`, i === 19999 ? 'N1' : null)).join('');
  await check('fods', common, style('child', 's0'), '7.50');
});
