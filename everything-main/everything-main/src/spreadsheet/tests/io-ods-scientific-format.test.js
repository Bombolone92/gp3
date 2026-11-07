import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { styleToNumFmt } from '../src/core/format.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

// The reader built the scientific code on both the opening and the closing tag of the
// element, so a format written with a separate closing tag came back doubled
// (0.00E+000.00E00) and the file's own code, not this app's settings, showed it wrong.
it('reads a scientific number format written with a separate closing tag once', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1500');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'scientific', dec: 2 });
  const bytes = new Uint8Array(await (await workbookToOds(wb, { settings: false })).arrayBuffer());
  const content = new TextDecoder().decode(X.CFB.find(X.CFB.read(bytes, { type: 'array' }), 'content.xml').content);
  expect(content).toMatch(/<number:scientific-number[^>]*><\/number:scientific-number>/);
  const back = await workbookFromFile(bytes, 'scientific.ods');
  const bid = back.activeSheetId;
  expect(styleToNumFmt(back.getCell(bid, 0, 0).s)).toBe('0.00E+00');
  expect(back.getDisplay(bid, 0, 0)).toBe(wb.getDisplay(id, 0, 0));
});

it('reads a self-closing scientific number format as before', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:automatic-styles>
  <number:number-style style:name="N1"><number:scientific-number number:decimal-places="3" number:min-integer-digits="1" number:min-exponent-digits="2" number:forced-exponent-sign="true"/></number:number-style>
  <style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>
 </office:automatic-styles>
 <office:body><office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell table:style-name="ce1" office:value-type="float" office:value="1500"><text:p>1.500E+03</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body>
</office:document>`;
  const wb = await workbookFromFile(new TextEncoder().encode(xml), 'scientific.fods');
  expect(styleToNumFmt(wb.getCell(wb.activeSheetId, 0, 0).s)).toBe('0.000E+00');
});
