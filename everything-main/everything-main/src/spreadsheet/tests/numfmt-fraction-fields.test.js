// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode, formatCodeError } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// Results measured in desktop Excel, including literal-separated numeric fields.
const native = [
  [
    0.06,
    "?/??\" \"??",
    "3/50   "
  ],
  [
    2.75,
    "?/??\" \"??",
    "11/4  0 "
  ],
  [
    0.06,
    "?/?\"x\"???",
    "0/1x   "
  ],
  [
    3.141592653589793,
    "?/???\"x\"?",
    "355/113x "
  ],
  [
    3.141592653589793,
    "?/1\" \"0",
    "5419351/1 7250330"
  ],
  [
    3.141592653589793,
    "?/1\" \"??",
    "5419351/1 72"
  ],
  [
    3.141592653589793,
    "?/12\" \"??",
    "5419351/12 25"
  ],
  [
    0.5,
    "?/1\"x\"0\"y\"6",
    "3/1x0y6"
  ],
  [
    0.5,
    "?/12\"x\"?\"y\"??",
    "1/1 x0y  "
  ],
  [
    0.05,
    "?/12\"x\"?\"y\"??",
    "1/12x y0 "
  ],
  [
    0.5,
    "?/??\"x\"0?",
    "1/2 x00"
  ],
  [
    0.05,
    "?/??\"x\"?0",
    "1/20x 0"
  ],
  [
    0.5,
    "?/1\"\"?",
    "1/1 "
  ],
  [
    0.05,
    "?/?\"\"?",
    "0/1 "
  ],
  [
    0,
    "# ?/??\" \"??",
    "0        "
  ],
  [
    1,
    "# ?/1\" \"0",
    "1      "
  ],
  [
    0,
    "# ?/1\"x\"?\"y\"6",
    "0      y6"
  ],
  [
    0,
    "# 0/??\"x\"00",
    "0/1 x00"
  ],
  [
    -0.5,
    "# #/??\"x\"##",
    "-1/2 x0"
  ],
  [
    0,
    "# 00/00",
    "00/01"
  ],
  [
    0.5,
    "# 00/00",
    "01/02"
  ],
  [
    0,
    "# ?0/?0",
    "0  0/10"
  ],
  [
    0,
    "# 0?/0?",
    "00/01"
  ],
  [
    0,
    "# #?/##",
    "0    "
  ],
  [
    0.5,
    "# #?/##",
    "1/2"
  ],
  [
    0,
    "# #/0?",
    "0 "
  ],
  [
    1,
    "# #/##",
    "1"
  ],
  [
    0,
    "# ?/##",
    "0    "
  ],
  [
    0.5,
    "# ?/0?",
    " 1/02"
  ],
  [
    0.5,
    "# ?/00",
    " 1/02"
  ]
];
it.each(native)('preserves fraction fields at %s with %s', (value, code, expected) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps fields through TEXT, edits, clipboard and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  native.forEach(([v, code, expected], r) => {
    wb.setInput(id, r, 0, String(v)); wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    expect(wb.getValue(id, r, 1)).toBe(expected);
    const cell = wb.getCell(id, r, 0), html = cellsToHtml([[expected]], [[cell]], null, [[v]]);
    expect(parseHtmlClipboard(html).cells[0][0].v).toBe(v);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(v); expect(pasted.s.code).toBe(code);
  });
  wb.setInput(id, 0, 0, '2.75'); expect(wb.getValue(id, 0, 1)).toBe('11/4  0 '); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'native.xlsx');
  native.forEach(([v, code, expected], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(v);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected);
  });
});
