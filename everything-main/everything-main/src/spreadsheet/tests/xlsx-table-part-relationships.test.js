import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';

const decode = part => new TextDecoder().decode(part.content);
const write = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
function edit(zip, path, fn) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(decode(part))); part.size = part.content.length;
}
async function fixture(second = false) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '5');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Entries' });
  if (second) {
    wb.setInput(id, 0, 3, 'Value'); wb.setInput(id, 1, 3, '9');
    wb.addTable(id, { r1: 0, c1: 3, r2: 1, c2: 3 }, { name: 'OtherEntries' });
  }
  return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
}

it.each([false, true])('ignores orphan table relationships with private metadata removed: %s', async noMeta => {
  const zip = await fixture();
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/, ''));
  if (noMeta) edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta"[^>]*\/>/, ''));
  const raw = X.read(write(zip), { type: 'array' });
  expect(raw.Sheets.Sheet1['!tableXml']).toBeUndefined();
  const back = await workbookFromFile(write(zip), 'orphan.xlsx');
  expect(back.activeSheet.tables).toEqual([]);
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe(5);
});

it('uses namespaced, entity-encoded references in worksheet order and deduplicates them', async () => {
  const zip = await fixture(true);
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/,
    '<x:tableParts xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3"><x:tablePart r:id="&#112;uterTable2"/><x:tablePart r:id="puterTable1"/><x:tablePart r:id="puterTable2"/></x:tableParts>'));
  const raw = X.read(write(zip), { type: 'array' });
  expect(raw.Sheets.Sheet1['!tableXml']).toHaveLength(2);
  expect(raw.Sheets.Sheet1['!tableXml'][0]).toContain('name="OtherEntries"');
  expect((await workbookFromFile(write(zip), 'references.xlsx')).activeSheet.tables.map(t => t.name)).toEqual(['OtherEntries', 'Entries']);
});

it('does not activate commented-out table references', async () => {
  const zip = await fixture();
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/(<tableParts\b[^>]*>[\s\S]*?<\/tableParts>)/, '<!-- $1 -->'));
  expect((await workbookFromFile(write(zip), 'comment.xlsx')).activeSheet.tables).toEqual([]);
});

it.each(['relationship', 'target', 'type', 'external'])('rejects a referenced table with an invalid %s instead of silently losing it', async kind => {
  const zip = await fixture();
  edit(zip, '/xl/worksheets/_rels/sheet1.xml.rels', xml => {
    if (kind === 'relationship') return xml.replace(/<Relationship\b[^>]*Type="[^"]*\/table"[^>]*\/>/, '');
    if (kind === 'target') return xml.replace('../tables/table1.xml', '../tables/missing.xml');
    if (kind === 'type') return xml.replace('/relationships/table', '/relationships/hyperlink');
    return xml.replace('Id="puterTable1"', 'Id="puterTable1" TargetMode="External"');
  });
  await expect(workbookFromFile(write(zip), 'broken.xlsx')).rejects.toThrow(/could not be read/);
});


it.each(['<tableParts count="0"/>', '<tableParts count="0"></tableParts>'])('accepts an empty table collection: %s', async empty => {
  const zip = await fixture();
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/, empty));
  expect((await workbookFromFile(write(zip), 'empty.xlsx')).activeSheet.tables).toEqual([]);
});
