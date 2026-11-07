import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

function fods(cells) {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>${cells}</table:table-row></table:table></office:spreadsheet></office:body></office:document>`);
}
const cell = (body) => `<table:table-cell office:value-type="string">${body}</table:table-cell>`;

// The reader turned <text:line-break/> into a newline only in that exact spelling; the
// same element written with a space before the slash or as an open and close tag, both
// well-formed XML, disappeared and ran the two lines together.
it('reads every spelling of a line break element inside a paragraph', async () => {
  const wb = await workbookFromFile(fods(
    cell('<text:p>a<text:line-break/>b</text:p>')
    + cell('<text:p><text:span text:style-name="T1">c<text:line-break/>d</text:span></text:p>')
    + cell('<text:p>e<text:line-break />f</text:p>')
    + cell('<text:p>g<text:line-break></text:line-break>h</text:p>')
    + cell('<text:p>i<text:line-break\n/>j</text:p>')
    + cell('<office:annotation><text:p>n1<text:line-break />n2</text:p></office:annotation><text:p>k</text:p>')
    + cell('<text:p>l<text:s text:c="2" />m<text:s />n</text:p>'),
  ), 'breaks.fods');
  const id = wb.activeSheetId;
  expect([0, 1, 2, 3, 4, 5, 6].map((c) => wb.getValue(id, 0, c))).toEqual(['a\nb', 'c\nd', 'e\nf', 'g\nh', 'i\nj', 'k', 'l  m n']);
  expect(wb.getNote(id, 0, 5)).toBe('n1\nn2');
});
