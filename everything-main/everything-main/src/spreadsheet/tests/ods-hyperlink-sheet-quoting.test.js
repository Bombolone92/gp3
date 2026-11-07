import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}

/** An ODS whose internal link is written the way other producers spell it: the sheet name bare. */
async function odsLinkingTo(sheetName, href) {
  const wb = new Workbook({ sheets: [{ name: 'Index' }, { name: sheetName }] });
  wb.setLink(wb.sheets[0].id, 0, 0, `#${quoteSheet(sheetName)}!A1`, 'Jump');
  wb.setInput(wb.sheets[1].id, 0, 0, '42');
  const zip = XLSX.CFB.read(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), { type: 'array' });
  editPart(zip, 'content.xml', (xml) => xml.replace(/xlink:href="#[^"]*"/, `xlink:href="${href}"`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each([
  ['Data Sheet', '#Data Sheet.A1', "#'Data Sheet'!A1"],
  ['Q1 2024', '#Q1 2024.A1', "#'Q1 2024'!A1"],
  ["O'Brien", "#&apos;O&apos;&apos;Brien&apos;.A1", "#'O''Brien'!A1"],
  ['Data', '#Data.A1', '#Data!A1'],
  ['Data Sheet', '#&apos;Data Sheet&apos;.A1', "#'Data Sheet'!A1"],
])('quotes the sheet of an ODS internal link as needed: %s via %s', async (sheetName, href, expected) => {
  const bytes = await odsLinkingTo(sheetName, href);
  const raw = XLSX.read(bytes, { type: 'array' });
  expect(raw.Sheets.Index.A1.l.Target).toBe(expected);
  const wb = await workbookFromFile(bytes, 'links.ods');
  const link = wb.linkAt(wb.sheets[0].id, 0, 0);
  expect(link).toEqual({ url: expected, label: 'Jump' });
  expect(wb.resolveLink(link.url, wb.sheets[0].id)).toMatchObject({ sheetId: wb.sheetByName(sheetName).id, range: { r1: 0, c1: 0 } });
  // Saved as .xlsx, the location is one Excel can follow.
  const zip = XLSX.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const sheetXml = new TextDecoder().decode(XLSX.CFB.find(zip, 'sheet1.xml').content);
  expect(sheetXml).toContain(`location="${expected.slice(1).replace(/'/g, '&apos;')}"`);
});
