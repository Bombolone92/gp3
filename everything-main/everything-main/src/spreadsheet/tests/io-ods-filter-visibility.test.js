import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

// ODF gives the rows a filter hides their own visibility, table:visibility="filter", apart from
// the collapse a by-hand hide uses. Reading only the collapse left a file whose conditions this
// app cannot express (LibreOffice's Top-10, colour and regex filters) showing every row the file
// hides, where the .xlsx path — whose filtered rows are plain hidden rows — keeps them hidden.

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Region', 'Amt'], ['East', 1], ['West', 2], ['South', 3], ['East', 4]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 1 });
  wb.setFilterCriteria(id, 0, { values: ['East'] });
  return { wb, id };
}

/** This app's own .ods without its settings block, optionally with content.xml rewritten. */
async function odsBytes(wb, rewrite = (xml) => xml) {
  const bytes = new Uint8Array(await (await workbookToOds(wb, { settings: false })).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const entry = X.CFB.find(zip, 'content.xml');
  const content = rewrite(new TextDecoder().decode(entry.content));
  entry.content = new TextEncoder().encode(content);
  entry.size = entry.content.length;
  return { content, bytes: X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}

// What LibreOffice's Top-10, colour and regex filters look like: a condition with no set items
// and an operator this app has no criterion for.
const unreadable = (xml) => xml.replace(/table:operator="="/g, 'table:operator="top values"').replace(/<table:filter-set-item[^>]*\/>/g, '');

it('keeps the rows an .ods hides with the filter visibility when its conditions cannot be read', async () => {
  const { wb } = book();
  const { content, bytes } = await odsBytes(wb, unreadable);
  expect([...content.matchAll(/<table:table-row\b[^>]*>/g)].map((m) => m[0])[2]).toContain('table:visibility="filter"');
  const back = await workbookFromFile(bytes, 'top.ods');
  const id = back.activeSheetId;
  expect(back.activeSheet.filter).toEqual({ range: { r1: 0, c1: 0, r2: 4, c2: 1 }, criteria: {} });
  // The file's own view is kept: rows 3 and 4 stay out of sight, as they do in the .xlsx path.
  expect([...back.activeSheet.hiddenRows].sort((a, b) => a - b)).toEqual([2, 3]);
  expect([...back.activeSheet.filterHidden]).toEqual([]);
  expect(back.isRowHidden(id, 2)).toBe(true);
});

it('still reads a filter it can express as a filter, leaving no row hidden by hand', async () => {
  const { wb } = book();
  const { bytes } = await odsBytes(wb);
  const back = await workbookFromFile(bytes, 'east.ods');
  // ODF's own predicate, compiled back into the formula criterion the filter UI reads.
  expect(back.activeSheet.filter.criteria[0].formula).toContain('EXACT($A2&"","East")');
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([2, 3]);
  expect([...back.activeSheet.hiddenRows]).toEqual([]);
  // Clearing the filter shows them again, which a by-hand hide would not.
  back.clearFilter(back.activeSheetId);
  expect([...back.activeSheet.filterHidden]).toEqual([]);
  expect(back.isRowHidden(back.activeSheetId, 2)).toBe(false);
});

it('treats a filter-hidden row outside the filter range as hidden by hand', async () => {
  const { wb, id } = book();
  wb.setInput(id, 6, 0, 'Note');
  const { bytes } = await odsBytes(wb, (xml) => xml.replace(/(<table:table-row)(?![^>]*visibility)([^>]*>(?:(?!<\/table:table-row>)[\s\S])*?Note)/, '$1 table:visibility="filter"$2'));
  const back = await workbookFromFile(bytes, 'note.ods');
  expect([...back.activeSheet.hiddenRows]).toEqual([6]);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([2, 3]);
});
