// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { cellFromInput, Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const modern = ['#SPILL!', '#CALC!', '#CONNECT!', '#BLOCKED!', '#UNKNOWN!', '#FIELD!', '#BUSY!', '#GETTING_DATA'];
const parse = (body, css = 'td{text-align:general;mso-number-format:General}', options) => cellsFromHtmlRows(
  parseHtmlClipboard(`<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>${css}</style></head><body><table><tr>${body}</tr></table></body></html>`).rows, undefined, options).map(x => x.cell);

// Native Excel for Mac HTML captured from an actual #CALC! value has
// text-align:general plus align=center, no x:str or explicit error attribute.
describe('native Office HTML error value hints', () => {
  it.each(modern)('imports %s as an error while preserving literal text controls', error => {
    const cells = parse(`<td align=center>${error}</td><td align=left>${error}</td><td>${error}</td><td align=center x:str="${error}">${error}</td>`);
    expect(cells.map(c => c.v)).toEqual([{ error }, error, error, error]);
    expect(cellFromInput(error).v).toBe(error);
    expect(parse(`<td align=center>${error}</td>`, undefined, { values: true })[0].v).toEqual({ error });
  });

  it('requires automatic placement rather than ordinary centered HTML or explicit CSS alignment', () => {
    for (const css of ['', 'td{text-align:center}', 'td{text-align:left}', 'td{text-align:general}.manual{text-align:center}']) {
      expect(parse('<td class=manual align=center>#CALC!</td>', css)[0].v).toBe('#CALC!');
    }
    expect(parse('<td align=center>#NOT_AN_ERROR!</td>')[0].v).toBe('#NOT_AN_ERROR!');
    expect(parse('<td align=center>#CYCLE!</td>')[0].v).toBe('#CYCLE!'); // app-specific spelling
  });

  it('uses resolved inheritance and fragmented rich text, and preserves errors even with a text number format', () => {
    expect(parse('<td align=" CENTER "><b>#CA</b><i>LC!</i></td>', 'table{text-align:general}td{text-align:inherit;mso-number-format:"\\@"}')[0].v).toEqual({ error: '#CALC!' });
    expect(parse('<td align=center>#N/A</td>', 'td{text-align:auto;mso-number-format:"\\@"}')[0].v).toEqual({ error: '#N/A' });
    expect(parse('<td align=center>#CALC!</td>', 'td{text-align:general;direction:rtl}')[0].v).toEqual({ error: '#CALC!' });
  });

  it('lets explicit numeric, text, Boolean and Sheets type attributes take precedence', () => {
    const cells = parse('<td align=center x:num="7">7</td><td align=center x:num>#CALC!</td><td align=center x:str>#CALC!</td><td align=center x:bool="FALSE">#CALC!</td><td align=center data-sheets-value=\'{"1":2,"2":"#CALC!"}\'>#CALC!</td>');
    expect(cells.map(c => c.v)).toEqual([7, '#CALC!', '#CALC!', false, '#CALC!']);
  });

  it('retains error semantics through private clipboard, edit/undo and native-only XLSX export', async () => {
    const cells = parse('<td align=center>#CALC!</td><td align=left>#CALC!</td>');
    const w = new Workbook(), id = w.activeSheetId;
    w.setCells(id, cells.map((cell, c) => ({ r: 0, c, cell })));
    w.setInput(id, 1, 0, '=ISERROR(A1)'); w.setInput(id, 1, 1, '=ISTEXT(B1)');
    expect(w.getValue(id, 1, 0)).toBe(true); expect(w.getValue(id, 1, 1)).toBe(true);
    const html = cellsToHtml([['#CALC!', '#CALC!']], [cells], null, [cells.map(c => c.v)]);
    expect(parseHtmlClipboard(html).cells[0].map(c => c.v)).toEqual([{ error: '#CALC!' }, '#CALC!']);
    w.setInput(id, 0, 0, '7'); expect(w.getValue(id, 1, 0)).toBe(false);
    w.undo(); expect(w.getValue(id, 1, 0)).toBe(true);
    const blob = await workbookToXlsx(w);
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
    const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expect(back.getValue(back.activeSheetId, 0, 0)).toEqual({ error: '#CALC!' });
    expect(back.getValue(back.activeSheetId, 0, 1)).toBe('#CALC!');
    expect(back.getValue(back.activeSheetId, 1, 0)).toBe(true);
  });
});
