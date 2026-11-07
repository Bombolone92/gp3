import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}

function cdataFile(mode, encoded, preamble = '') {
  const shared = mode.includes('shared');
  const rich = mode.startsWith('rich');
  const book = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['SENTINEL', 17]]);
  ws.A2 = { t: 's', v: 'cached', f: 'A1' };
  ws['!ref'] = 'A1:B2';
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: shared })), { type: 'array' });
  const content = rich ? `<r><rPr><b/></rPr><t>${encoded}</t></r>` : `<t>${encoded}</t>`;
  editPart(zip, shared ? 'sharedStrings.xml' : 'sheet1.xml', (xml) => {
    xml = xml.replace('?>', `?>${preamble}`);
    if (shared) return xml.replace('<t>SENTINEL</t>', content);
    if (mode === 'str') return xml.replace('SENTINEL', encoded);
    return xml.replace('t="str"', 't="inlineStr"').replace('<v>SENTINEL</v>', `<is>${content}</is>`);
  });
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const cases = [
  { name: 'plain text', encoded: '<![CDATA[hello]]>', expected: 'hello' },
  { name: 'literal markup', encoded: '<![CDATA[hello <world> & friends]]>', expected: 'hello <world> & friends' },
  { name: 'entity-looking text', encoded: '<![CDATA[&amp; &#65; &#x1F600;]]>', expected: '&amp; &#65; &#x1F600;' },
  { name: 'Unicode and Xstring escapes', encoded: '<![CDATA[😀_x0041__x005F_x0042_]]>', expected: '😀A_x0042_' },
  { name: 'escape ending in CDATA', encoded: '_x00<![CDATA[41_]]>', expected: 'A' },
  { name: 'escape starting in CDATA', encoded: '<![CDATA[_x00]]>41_', expected: 'A' },
  { name: 'mixed text and empty sections', encoded: 'a&amp;<![CDATA[]]><![CDATA[<&]]>&gt;b', expected: 'a&<&>b' },
  { name: 'CDATA end marker', encoded: '<![CDATA[a]]]]><![CDATA[>b]]>', expected: 'a]]>b' },
  { name: 'line endings', encoded: '<![CDATA[a\r\nb\rc_x000D_\nd]]>', expected: 'a\nb\nc\r\nd' },
  { name: 'string table delimiters', encoded: '<![CDATA[</t></r></si><si><t>literal</t></sst>]]>', expected: '</t></r></si><si><t>literal</t></sst>' },
  { name: 'worksheet delimiters', encoded: '<![CDATA[</v></c></row></sheetData></worksheet>]]>', expected: '</v></c></row></sheetData></worksheet>' },
  { name: 'comment and PI syntax', encoded: '<![CDATA[<!-- comment --> <?text instruction?>]]>', expected: '<!-- comment --> <?text instruction?>' },
];

it.each(['str', 'shared', 'inline', 'rich-shared', 'rich-inline'].flatMap((mode) => cases.map((c) => ({ mode, ...c }))))(
  'imports CDATA as text: $mode / $name', async ({ mode, encoded, expected }) => {
    const bytes = cdataFile(mode, encoded);
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(raw.Sheets.Data.A1.v).toBe(expected);
    expect(raw.Sheets.Data.B1.v).toBe(17);
    const saved = XLSX.write(raw, { type: 'array', bookType: 'xlsx', bookSST: true });
    expect(XLSX.read(saved, { type: 'array' }).Sheets.Data.A1.v).toBe(expected);
    let wb = await workbookFromFile(bytes, 'cdata.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(expected);
      expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(expected);
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(17);
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(['str', 'shared'].flatMap((mode) => [false, true].map((cdata) => ({ mode, cdata }))))(
  'ignores CDATA-like syntax in comments and processing instructions: %j', async ({ mode, cdata }) => {
    const preamble = '<!-- <![CDATA[unfinished --><?note <![CDATA[unfinished ?>';
    const bytes = cdataFile(mode, cdata ? '<![CDATA[hello]]>' : 'hello', preamble);
    const wb = await workbookFromFile(bytes, 'preamble.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('hello');
  },
);

it.each(['str', 'shared'])('rejects unterminated CDATA without recursive parsing: %s', (mode) => {
  const bytes = cdataFile(mode, '<![CDATA[unfinished');
  expect(() => XLSX.read(bytes, { type: 'array', WTF: true })).toThrow('Unterminated XML CDATA section');
});

it.each(['str', 'shared', 'rich-inline'])('imports many adjacent CDATA sections without recursion: %s', async (mode) => {
  const wb = await workbookFromFile(cdataFile(mode, '<![CDATA[a]]>'.repeat(20000)), 'many-sections.xlsx');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('a'.repeat(20000));
});

it('preserves formulas and defined names containing CDATA', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1', A1: { t: 's', v: 'cached', f: 'SENTINEL' }, B1: { t: 's', v: 'cached', f: 'Label' },
  }, 'Data');
  book.Workbook = { Names: [{ Name: 'Label', Ref: 'SENTINEL' }] };
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const literal = '</f></definedName> &amp; 😀_x0041_';
  const formula = `"${literal}"`;
  const encoded = `<![CDATA["${literal.replace('_x0041_', '_x005F_x0041_')}"]]>`;
  for (const name of ['sheet1.xml', 'workbook.xml']) editPart(zip, name, (xml) => xml.replace('SENTINEL', encoded));
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'formulas.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe(formula);
    expect(wb.names.find((n) => n.name === 'Label').ref).toBe(formula);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(literal);
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(literal);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});
