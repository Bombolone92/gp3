import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}

const markupCases = [
  '<!-- explanation -->', '<?note explanation?>', '<?xml-stylesheet ignored?>',
  '<!-- </v></c></row></sheetData></worksheet> -->',
  '<!-- </t></r></si><si><t>phantom</t></sst> -->',
  '<?note </t></r></si></v></c></row></sheetData> ?>',
  '<!-- <![CDATA[not a section --><?note <![CDATA[not a section ?>',
];

it.each(['str', 'shared', 'inline', 'rich-shared', 'rich-inline'].flatMap((mode) => markupCases.map((markup) => ({ mode, markup }))))(
  'ignores XML comments and processing instructions in text: %j', async ({ mode, markup }) => {
    const shared = mode.includes('shared');
    const book = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['SENTINEL', 17], ['NEXT']]);
    ws.A3 = { t: 's', v: 'cached', f: 'A1' };
    ws['!ref'] = 'A1:B3';
    XLSX.utils.book_append_sheet(book, ws, 'Data');
    const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: shared })), { type: 'array' });
    const encoded = `hello${markup}world _x00${markup}41_`;
    const content = mode.startsWith('rich') ? `<r><rPr><b/></rPr><t>${encoded}</t></r>` : `<t>${encoded}</t>`;
    editPart(zip, shared ? 'sharedStrings.xml' : 'sheet1.xml', (xml) => {
      if (shared) return xml.replace('<t>SENTINEL</t>', content);
      if (mode === 'str') return xml.replace('SENTINEL', encoded);
      return xml.replace('t="str"', 't="inlineStr"').replace('<v>SENTINEL</v>', `<is>${content}</is>`);
    });
    const bytes = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(raw.Sheets.Data.A1.v).toBe('helloworld A');
    expect(raw.Sheets.Data.A2.v).toBe('NEXT');
    const saved = XLSX.write(raw, { type: 'array', bookType: 'xlsx', bookSST: true });
    expect(XLSX.read(saved, { type: 'array' }).Sheets.Data.A1.v).toBe('helloworld A');
    let wb = await workbookFromFile(bytes, 'comments.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('helloworld A');
      expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe('NEXT');
      expect(wb.getValue(wb.activeSheetId, 2, 0)).toBe('helloworld A');
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(17);
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(['comment', 'instruction'])('ignores fake worksheet structure and formula markup inside an XML %s', async (kind) => {
  const wrap = (text) => kind === 'comment' ? `<!-- ${text} -->` : `<?note ${text} ?>`;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1', A1: { t: 's', v: 'cached', f: '"SENTINEL"' }, B1: { t: 's', v: 'cached', f: 'Label' },
  }, 'Data');
  book.Workbook = { Names: [{ Name: 'Label', Ref: '"SENTINEL"' }] };
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const encoded = `hello${wrap('</f></definedName>')}world`;
  editPart(zip, 'sheet1.xml', (xml) => xml.replace('SENTINEL', encoded).replace('<sheetData>',
    `<sheetData>${wrap('<row r="9"><c r="A9" t="str"><v>phantom</v></c></row>')}`));
  editPart(zip, 'workbook.xml', (xml) => xml.replace('SENTINEL', encoded).replace('<sheets>',
    `<sheets>${wrap('<sheet name="Ghost" sheetId="9" r:id="rId9"/>')}`));
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'structure.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.sheets.map((s) => s.name)).toEqual(['Data']);
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe('"helloworld"');
    expect(wb.names.find((n) => n.name === 'Label').ref).toBe('"helloworld"');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('helloworld');
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe('helloworld');
    expect(wb.getValue(wb.activeSheetId, 8, 0)).toBeNull();
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});
