// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';

const office = body => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr>${body}</tr></table></html>`;
const values = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell?.v);
const foreign = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
const controls = Array.from({length:32}, (_, i) => String.fromCharCode(0x80 + i));
// HTML's Windows-1252 replacement table, including its five unmapped controls.
const visible = Array.from('€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ');

it('matches the saved native explicit-string and rendered C1 control', () => {
  // Excel for Mac system-clipboard paste saved in null-string-edge-native.xlsx,
  // B9:D9, 2026-09-21. Only B9 uses an explicit string attribute.
  const source = '&#0130;&#0;&#x0D0;';
  expect(values(office(`<td x:str="${source}">display</td><td x:str>${source}</td><td>${source}</td>`)))
    .toEqual(['\u0082\0Ð', '‚Ð', '‚Ð']);
});

it('preserves C1 code points in typed attributes while rendered references use HTML decoding', () => {
  // General range coverage for the direct-code-point rule; the native control
  // above establishes the distinction, not 32 independent native observations.
  for (let i = 0; i < controls.length; i++) {
    const n = 0x80 + i;
    for (const ref of [`&#${n};`, `&#000${n};`, `&#x${n.toString(16)};`, `&#X000${n.toString(16).toUpperCase()};`, `&#${n}`, `&#x${n.toString(16)}`]) {
      for (const quote of ['"', "'", '']) {
        const cells = `<th X:STR=${quote}a${ref}Z${quote}>display</th><td x:str>a${ref}Z</td><td>a${ref}Z</td>`;
        expect(values(office(cells)), cells).toEqual([`a${controls[i]}Z`, `a${visible[i]}Z`, `a${visible[i]}Z`]);
      }
    }
  }
  // Typed hints also work in foreign HTML without an Office namespace.
  expect(values('<table><tr><td x:str="&#130;">display</td></tr></table>')).toEqual(['\u0082']);
});

it('keeps literal characters, escaped references, boundaries and attribute precedence distinct', () => {
  const cases = [
    ['x:str="&#130;&#x9f;&amp;#130;&sbquo;‚"', '\u0082\u009f&#130;‚‚'],
    ['x:str="&#1299;&#x800;&#127;&#160;"', String.fromCodePoint(1299, 0x800, 127, 160)],
    ['x:str="&#1300&#x800Z"', String.fromCodePoint(1300, 0x800) + 'Z'],
    ['x:str="&#130;" x:str="ignored"', '\u0082'],
    ['x:str="kept" x:str="&#130;"', 'kept'],
    ['x:str x:str="&#130;"', 'display'],
    ['title="<td x:str=\'&#130;\'>" x:str="&#x82;"', '\u0082'],
    ['data-office-empty-string="nul" x:str="&#130;&#0;\r0&#13;1"', '\u0082\0\r0\r1'],
  ];
  for (const [attrs, expected] of cases) expect(values(office(`<td ${attrs}>display</td>`)), attrs).toEqual([expected]);
  expect(parseHtmlClipboard(office('<td x:num="7" x:str="&#130;">display</td>')).rows[0][0].value).toBe(7);
  expect(values(office(`<td x:str="${controls.join('')}">display</td>`))).toEqual([controls.join('')]);
  const html = '<script>"<td x:str=\"&#130;\">"</script><!-- <td x:str="&#130;"> -->'
    + '<style>td[x\\:str="‚"] {color:#ff0000} td {color:#123456}</style>'
    + office('<td x:str="&#130;">display</td>');
  const spy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell).toMatchObject({v:'\u0082', s:{color:'#123456'}});
    const doc = spy.mock.results.at(-1).value;
    expect(doc.querySelector('td').getAttributeNames()).toEqual(['x:str']);
    expect(doc.querySelector('script').textContent).toContain('&#130;');
    expect(doc.querySelector('style').textContent).toContain('‚');
  } finally { spy.mockRestore(); }
});

it('retains C1 values in full snapshots, values-only copies, foreign copies and DOM reserialization', () => {
  const row = [...controls, '‚€Ÿ', '\u0082&amp;#130;'];
  const matrix = [row], cells = [row.map(v => ({v}))];
  const full = cellsToHtml(matrix, cells, null, matrix);
  expect(parseHtmlClipboard(full).cells[0].map(c => c.v)).toEqual(row);
  expect(parseHtmlClipboard(full).values).toEqual(matrix);
  const copies = [foreign(full), cellsToHtml(matrix, null, null, matrix)];
  for (const html of copies) {
    expect(values(html)).toEqual(row);
    const serialized = new DOMParser().parseFromString(html, 'text/html').documentElement.outerHTML;
    expect(values(serialized)).toEqual(row);
  }
});

it('retains pasted C1 strings through edit, undo, formulas and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const text = controls.join('') + '\u0082\0\r\nÐ';
  const refs = [...text].map(c => `&#${c.codePointAt(0)};`).join('');
  const cell = cellsFromHtmlRows(parseHtmlClipboard(office(`<td x:str="${refs}">display</td>`)).rows)[0].cell;
  wb.setCells(id, [{r:0,c:0,cell}, {r:0,c:1,cell:{f:'LEN(A1)'}}, {r:0,c:2,cell:{f:'UNICODE(A1)'}}]);
  expect(wb.getValue(id,0,0)).toBe(text);
  expect(wb.getValue(id,0,1)).toBe(text.length);
  expect(wb.getValue(id,0,2)).toBe(128);
  wb.setInput(id,0,0,'edited'); wb.undo();
  expect(wb.getValue(id,0,0)).toBe(text);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), {type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'c1-roundtrip');
  expect(back.getValue(back.activeSheetId,0,0)).toBe(text);
  expect(back.getValue(back.activeSheetId,0,1)).toBe(text.length);
  expect(back.getValue(back.activeSheetId,0,2)).toBe(128);
});
