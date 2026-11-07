// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { sheetToHtml, workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { formatValue, numFmtToStyle } from '../src/core/format.js';
import * as X from '../src/vendor/xlsx.mjs';

// Office number-format escapes use four hex digits; adjacent digits, letters
// and whitespace are literal code characters, unlike standard CSS escapes.
const strip = (html) => html.replace(/ data-spreadsheet-(cells|values|origin)="[^"]*"/g, '');
const back = (html) => {
  const parsed = parseHtmlClipboard(strip(html));
  expect(parsed.cells).toBeUndefined();
  return cellsFromHtmlRows(parsed.rows)[0].cell;
};

describe('quoted labels in copied number formats', () => {
  // Clipboard HTML in the form Excel for Mac writes. Keeping these inputs
  // independent of our writer catches a decoder/writer agreement that Excel
  // does not share. The last cases cover escaped controls and UTF-16 units.
  it.each([
    [String.raw`?\/??\0022 \0022??`, '?/??" "??'],
    [String.raw`\0022abc\00220`, '"abc"0'],
    [String.raw`\0022face\00220`, '"face"0'],
    [String.raw`\00220\00220`, '"0"0'],
    [String.raw`0\0022 \0022`, '0" "'],
    [String.raw`0\0022  \0022`, '0"  "'],
    [String.raw`\0022 \00220`, '" "0'],
    [String.raw`\0022  \00220`, '"  "0'],
    [String.raw`\0022$\00220\.00`, '"$"0.00'],
    [String.raw`0\0022 kg\0022`, '0" kg"'],
    [String.raw`0\0022雪\0022`, '0"雪"'],
    [String.raw`0\0022😀\0022`, '0"😀"'],
    [String.raw`0\0022a\;b\0022`, '0"a;b"'],
    [String.raw`0\0022\\\0022`, '0"\\"'],
    [String.raw`0\\a`, '0\\a'],
    [String.raw`0\0022\0009\0022`, '0"\t"'],
    // General encoding controls, independent of the native sample above.
    [String.raw`\0022\D83D\DE00\00220`, '"😀"0'],
    [String.raw`\ 0\ `, ' 0 '],
  ])('reads native format %s without consuming adjacent characters', (encoded, code) => {
    const html = `<style>.n {mso-number-format:"${encoded}"}</style><table><tr><td class=n x:num="2.75">value</td></tr></table>`;
    const { rows } = parseHtmlClipboard(html);
    expect(rows[0][0].style).toEqual(numFmtToStyle(code));
    const cell = cellsFromHtmlRows(rows)[0].cell;
    expect(cell.v).toBe(2.75);
    const copied = cellsToHtml([[formatValue(cell.v, cell.s)]], [[cell]], null, [[cell.v]]);
    expect(back(copied).s).toMatchObject(numFmtToStyle(code));
  });

  it.each(['"$"0.00', '"Q"0', '"USD "0', '"a"b', '"€"#,##0', '0" units"', '"Total: "#,##0.0'])('round-trips %s through the markup alone', (code) => {
    const shown = formatValue(5, { fmt: 'custom', code });
    const html = cellsToHtml([[shown]], [[{ v: 5, s: { fmt: 'custom', code } }]], null, [[5]]);
    const cell = back(html);
    expect(cell.v).toBe(5);
    expect(formatValue(5, cell.s)).toBe(shown);
  });

  // Excel's HTML-only importer makes the same distinction. Its native copy
  // formats can carry the original number separately, but display-only HTML
  // cannot recover 2.75 from a rounded or decorated label such as abc3.
  it.each([
    [String.raw`?\/??\0022 \0022??`, '11/4<span style="mso-spacerun:yes">&nbsp; </span>0', '11/4  0'],
    [String.raw`\0022abc\00220`, 'abc3', 'abc3'],
    [String.raw`\00220\00220`, '03', 3],
    [String.raw`0\0022 kg\0022`, '3 kg', '3 kg'],
    [String.raw`\0022$\00220\.00`, '$2.75', 2.75],
  ])('reads display-only native HTML %s without inventing a raw number', (encoded, shown, expected) => {
    const html = `<style>td {mso-number-format:"${encoded}"}</style><table><tr><td>${shown}</td></tr></table>`;
    expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell.v).toBe(expected);
  });

  it('writes Office four-digit escapes without adding literal spaces', () => {
    const style = (code) => /style="([^"]*)"/.exec(cellsToHtml([['x']], [[{ v: 5, s: { fmt: 'custom', code } }]], null, [[5]]))[1];
    expect(style('"$"0.00')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:&quot;\\0022\\$\\00220\\.00&quot;');
    expect(style('"a"b')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:&quot;\\0022a\\0022b&quot;');
    expect(style('"€"#,##0')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:&quot;\\0022\\€\\0022\\#\\,\\#\\#0&quot;'); // unchanged where no digit follows
    expect(style('"g"0')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:&quot;\\0022g\\00220&quot;'); // g is no hex digit
    // Splitting the surrogate pair with a backslash corrupts it during UTF-8
    // clipboard transfer, even though our own decoder can join it again.
    expect(style('0"😀"')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:&quot;0\\0022\\😀\\0022&quot;');
  });

  it('preserves pasted labels and spaces through edits and metadata-free XLSX', async () => {
    const codes = ['?/??" "??', '"abc"0', '"face"0', '"0"0', '0" "', '"  "0', '0"😀"'];
    const wb = new Workbook(), id = wb.activeSheetId;
    codes.forEach((code, r) => {
      const encoded = code.replaceAll('"', String.raw`\0022`);
      const html = `<style>td {mso-number-format:"${encoded}"}</style><table><tr><td x:num="2.75">value</td></tr></table>`;
      const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
      wb.pasteCells(id, [[cell]], r, 0);
      wb.setInput(id, r, 0, '4.125');
      expect(wb.styleAt(id, r, 0).code).toBe(code);
    });
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob); });
    const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    codes.forEach((code, r) => {
      expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
      expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(4.125);
    });
  });

  it('keeps the format through the exported web page, which strips the embedded cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '"$"0.00' });
    wb.setInput(id, 0, 1, '7');
    wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { fmt: 'custom', code: '"Q"0' });
    const page = sheetToHtml(wb, id);
    expect(page).not.toContain('data-spreadsheet-cells');
    const { rows } = parseHtmlClipboard(page);
    const layout = { color: '#1a1a1a', wrap: true, valign: 'middle' };
    for (const side of ['bt', 'br', 'bb', 'bl']) { layout[side] = true; layout[`${side}Border`] = { bs: 'thin', bc: '#dddddd' }; }
    expect(rows[0].map((cell) => cell.style)).toEqual([{ ...layout, fmt: 'currency', cur: 'USD', dec: 2, group: false }, { ...layout, fmt: 'custom', code: '"Q"0' }]);
    const cells = cellsFromHtmlRows(rows).map(({ cell }) => cell);
    expect(formatValue(cells[0].v, cells[0].s)).toBe('$5.00');
  });
});
