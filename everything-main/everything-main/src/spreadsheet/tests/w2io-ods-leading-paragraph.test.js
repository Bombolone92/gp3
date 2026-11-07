import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

function fods(cells) {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>${cells}</table:table-row></table:table></office:spreadsheet></office:body></office:document>`);
}
const cell = (body) => `<table:table-cell office:value-type="string">${body}</table:table-cell>`;

// ODF spells a line break between two paragraphs, so text that starts with a line break
// is an empty first paragraph. The reader joined paragraphs with a break only when the
// text so far was non-empty, which dropped those leading breaks, and it added a break of
// its own for a self-closing empty paragraph.
it('keeps a leading line break written as an empty first paragraph', async () => {
  const wb = await workbookFromFile(fods(
    cell('<text:p></text:p><text:p>starts</text:p>')
    + cell('<text:p/><text:p>self</text:p>')
    + cell('<text:p></text:p><text:p></text:p><text:p>two</text:p>')
    + cell('<text:p>a</text:p><text:p/><text:p>b</text:p>')
    + cell('<text:p>ends</text:p><text:p/>')
    + cell('<text:p>plain</text:p>'),
  ), 'paragraphs.fods');
  const id = wb.activeSheetId;
  expect([0, 1, 2, 3, 4, 5].map((c) => wb.getValue(id, 0, c))).toEqual(['\nstarts', '\nself', '\n\ntwo', 'a\n\nb', 'ends\n', 'plain']);
});

it('keeps text and notes that start with line breaks through an .ods round trip', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '\nstarts');
  wb.setInput(id, 1, 0, '\n\ntwo');
  wb.setInput(id, 2, 0, 'a\n\nb');
  wb.setInput(id, 3, 0, 'ends\n');
  // Notes are trimmed on import, so only an inner blank line can be checked on one.
  wb.setNote(id, 0, 0, 'n1\n\nn2');
  const back = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'paragraphs.ods');
  const bid = back.activeSheetId;
  expect([0, 1, 2, 3].map((r) => back.getValue(bid, r, 0))).toEqual(['\nstarts', '\n\ntwo', 'a\n\nb', 'ends\n']);
  expect(back.getNote(bid, 0, 0)).toBe('n1\n\nn2');
});
