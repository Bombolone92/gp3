import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function missingLinkFile(kind, label, location) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1', A1: { t: 's', v: label, l: { Target: 'https://example.com/missing' } },
    B1: { t: 's', v: 'Valid link', l: { Target: 'https://example.com/valid' } },
  }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const edit = (name, fn) => {
    const entry = zip.FileIndex.find((e) => e.name === name);
    entry.content = new TextEncoder().encode(fn(new TextDecoder().decode(entry.content)));
    entry.size = entry.content.length;
  };
  edit('sheet1.xml.rels', (xml) => xml.replace(/<Relationship\b[^>]*\/>/, (rel) =>
    kind === 'comment' ? `<!-- ${rel} -->` : kind === 'instruction' ? `<?note ${rel} ?>` : ''));
  edit('sheet1.xml', (xml) => xml.replace(/<hyperlink\b[^>]*ref="A1"[^>]*\/>/, (tag) => {
    if (kind === 'no-id') tag = tag.replace(/ r:id="[^"]*"/, '');
    if (location !== undefined) tag = tag.replace('/>', ` location="${location}"/>`);
    return tag;
  }));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each(['missing', 'no-id', 'comment', 'instruction', 'empty-location'].flatMap((kind) => ['', 'Label'].flatMap((label) => [false, true].map((dense) => ({ kind, label, dense })))))(
  'ignores a hyperlink without a resolvable target: %j', async ({ kind, label, dense }) => {
    const bytes = missingLinkFile(kind, label, kind === 'empty-location' ? '' : undefined);
    const raw = XLSX.read(bytes, { type: 'array', dense });
    const sheet = raw.Sheets.Data;
    expect((dense ? sheet['!data'][0]?.[0] : sheet.A1)?.l).toBeUndefined();
    expect((dense ? sheet['!data'][0]?.[1] : sheet.B1).l.Target).toBe('https://example.com/valid');
    let wb = await workbookFromFile(bytes, 'missing-link.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.getCell(wb.activeSheetId, 0, 0)?.f).toBeFalsy();
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(label);
      expect(wb.linkAt(wb.activeSheetId, 0, 0)).toBeFalsy();
      expect(wb.linkAt(wb.activeSheetId, 0, 1)?.url).toBe('https://example.com/valid');
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(['missing', 'no-id', 'comment', 'instruction'])('retains an explicit internal location with a %s relationship', async (kind) => {
  let wb = await workbookFromFile(missingLinkFile(kind, 'Label', 'Data!B1'), 'internal.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe('#Data!B1');
    expect(wb.resolveLink('#Data!B1')).toMatchObject({ sheetId: wb.activeSheetId, range: { r1: 0, c1: 1, r2: 0, c2: 1 } });
    expect(wb.linkAt(wb.activeSheetId, 0, 1)?.url).toBe('https://example.com/valid');
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});
