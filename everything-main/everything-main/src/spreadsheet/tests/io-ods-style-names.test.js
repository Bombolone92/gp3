import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const modes = ['fods', 'ods-inline', 'ods-external', 'ods-common'];
function file({ mode, styleName = 'ce1', formatName = 'N1', defineStyle = true, defineFormat = true, omitFormatReference = false, mapName, defineMap = false, styleFirst = false }) {
  const ns = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"`;
  const mapped = defineMap ? `<number:number-style style:name="${mapName}"><number:number number:decimal-places="3" number:min-integer-digits="1"/></number:number-style>` : '';
  const mapping = mapName ? `<style:map style:condition="value()&gt;=0" style:apply-style-name="${mapName}"/>` : '';
  const format = mapped + (defineFormat ? `<number:number-style style:name="${formatName}"><number:number number:decimal-places="2" number:min-integer-digits="1"/>${mapping}</number:number-style>` : '');
  const style = defineStyle ? `<style:style style:name="${styleName}" style:family="table-cell"${omitFormatReference ? '' : ` style:data-style-name="${formatName}"`}/>` : '';
  const externalFormat = mode === 'ods-external' || mode === 'ods-common';
  const inlineStyle = mode === 'ods-common' ? '' : style;
  const root = mode === 'fods' ? 'document' : 'document-content';
  const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
  <office:${root} ${ns} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
    <office:automatic-styles>${styleFirst ? inlineStyle : ''}${externalFormat ? '' : format}${styleFirst ? '' : inlineStyle}</office:automatic-styles>
    <office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>
      <table:table-cell office:value-type="float" office:value="7.5" table:style-name="${styleName}"/>
      <table:table-cell office:value-type="float" office:value="12"/>
    </table:table-row></table:table></office:spreadsheet></office:body>
  </office:${root}>`);
  if (mode === 'fods') return content;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
  XLSX.CFB.utils.cfb_add(zip, 'content.xml', content);
  if (externalFormat) XLSX.CFB.utils.cfb_add(zip, 'styles.xml', new TextEncoder().encode(`<?xml version="1.0"?><office:document-styles ${ns} office:version="1.2"><office:styles>${mode === 'ods-common' && styleFirst ? style : ''}${format}${mode === 'ods-common' && !styleFirst ? style : ''}</office:styles></office:document-styles>`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

async function check(options, expected) {
  const wb = await workbookFromFile(file(options), options.mode === 'fods' ? 'styles.fods' : 'styles.ods');
  for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(7.5);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(expected);
    expect(back.getValue(back.activeSheetId, 0, 1)).toBe(12);
    expect(back.getDisplay(back.activeSheetId, 0, 1)).toBe('12');
  }
}

it.each(modes.flatMap((mode) => [
  ['__proto__', 'N1'], ['ce1', '__proto__'], ['__proto__', '__proto__'],
  ['constructor', 'toString'], ['hasOwnProperty', 'valueOf'], ['normal', 'normal'],
].map(([styleName, formatName]) => ({ mode, styleName, formatName }))))(
  'keeps defined style $styleName and format $formatName in $mode', async (options) => {
    await check(options, '7.50');
  },
);

it.each(modes.flatMap((mode) => ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].flatMap((name) => [
  { mode, styleName: name, defineStyle: false },
  { mode, formatName: name, defineFormat: false },
])))(
  'ignores missing style or format references instead of inheriting properties: %j', async (options) => {
    await check(options, '7.5');
  },
);

it.each(modes)('does not treat an absent format reference as the name undefined in %s', async (mode) => {
  await check({ mode, formatName: 'undefined', omitFormatReference: true }, '7.5');
});

it.each(modes.flatMap((mode) => [false, true].flatMap((defineMap) =>
  ['__proto__', 'constructor', 'mapped'].map((mapName) => ({ mode, defineMap, mapName })),
)))(
  'uses only defined conditional style references: %j', async (options) => {
    await check(options, options.defineMap ? '7.500' : '7.50');
  },
);

it.each(['fods', 'ods-inline', 'ods-common'].flatMap((mode) => [false, true].flatMap((styleFirst) =>
  ['N1', '__proto__'].map((formatName) => ({ mode, styleFirst, formatName })),
)))(
  'resolves cell number formats independently of declaration order: %j', async (options) => {
    await check(options, '7.50');
  },
);

it.each([
  { location: 'content', family: 'table-cell', defineStyle: true, expected: '7.5000' },
  { location: 'common', family: 'paragraph', defineStyle: true, expected: '7.50' },
  { location: 'automatic', family: 'table-cell', defineStyle: true, expected: '7.50' },
  { location: 'automatic', family: 'table-cell', defineStyle: false, expected: '7.5' },
])('respects common style scope and local overrides: %j', async ({ location, family, defineStyle, expected }) => {
  const zip = XLSX.CFB.read(new Uint8Array(file({ mode: 'ods-common', defineStyle })), { type: 'array' });
  const path = location === 'content' ? 'content.xml' : 'styles.xml';
  const xml = new TextDecoder().decode(zip.FileIndex.find((entry) => entry.name === path).content);
  const extra = `<number:number-style style:name="N2"><number:number number:decimal-places="4" number:min-integer-digits="1"/></number:number-style>
    <style:style style:name="ce1" style:family="${family}" style:data-style-name="N2"/>`;
  const modified = location === 'automatic'
    ? xml.replace('</office:document-styles>', `<office:automatic-styles>${extra}</office:automatic-styles></office:document-styles>`)
    : xml.replace(location === 'content' ? '</office:automatic-styles>' : '</office:styles>', `${extra}${location === 'content' ? '</office:automatic-styles>' : '</office:styles>'}`);
  XLSX.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(modified));
  const wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'scope.ods');
  for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(7.5);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(expected);
    expect(back.getDisplay(back.activeSheetId, 0, 1)).toBe('12');
  }
});
