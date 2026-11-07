// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
const parse = body => parseHtmlClipboard(`<table><tr><td>${body}</td></tr></table>`).rows;

it('discards native HTML NUL references in rendered text but preserves explicit typed values', () => {
  // Pasted into Excel for Mac and saved on 2026-09-19.
  for (const [html,expected] of [['a&#0;b','ab'],['&#0;abc','abc'],['abc&#0;','abc'],['1&#0;2',12],['a&#x0;b','ab'],['a&#000;b','ab'],['a&#X0000;b','ab'],['a&#0b','ab'],['<span>a&#0;b</span>c','abc'],['a&#0;<b>b</b>c','abc']]) {
    expect(cellsFromHtmlRows(parse(html))[0].cell.v,html).toBe(expected);
  }
  expect(cellsFromHtmlRows(parse('&#0;'))[0].cell).toBeNull();
  const html='<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr><td x:str="3&#0;">3&#0;</td></tr></table></html>';
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell.v).toBe('3\0');
});

it('preserves replacement characters, nonzero references, escaped entity text and raw CSS', () => {
  for(const [html,expected] of [['a\uFFFDb','a\uFFFDb'],['a&#65533;b','a\uFFFDb'],['a&#1;b','a\x01b'],['a&amp;#0;b','a&#0;b'],['a&#01;b','a\x01b'],['a&#x01;b','a\x01b']]) {
    expect(parse(html)[0][0].text,html).toBe(expected);
  }
  const html='<style>.year {mso-number-format:\'"a&#0;b"\';}</style><table><tr><td class="year">3&#0;</td></tr></table>';
  const row=parseHtmlClipboard(html).rows[0][0];
  expect(row.text).toBe('3');expect(row.style.code).toBe('"a&#0;b"');
  expect(parse('<script>"&#0;"</script>a&#0;b')[0][0].text).toBe('ab');
  expect(parse('<!-- &#0; -->a&#0;b')[0][0].text).toBe('ab');
});

it('retains NUL values in the app’s verified clipboard snapshots', () => {
  const value='a\0b',cell={v:value};
  const html=cellsToHtml([[value]],[[cell]],null,[[value]]);
  expect(parseHtmlClipboard(html).cells[0][0].v).toBe(value);
  expect(parseHtmlClipboard(html).values).toEqual([[value]]);
});

const office = body => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr>${body}</tr></table></html>`;
const value = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell?.v;
const foreign = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');

it('retains numeric NUL references only in explicit Office string attributes', () => {
  // Chrome system clipboard -> Excel for Mac -> saved XLSX, 2026-09-21.
  for (const ref of ['&#0;', '&#0000;', '&#x0;', '&#X000;', '&#0']) {
    for (const quote of ['"', "'", '']) {
      const html = office(`<td X:STR=${quote}a${ref}g${quote}><b>display</b><i>text</i></td><td x:str>a${ref}g</td><td>a${ref}g</td>`);
      const parsed = parseHtmlClipboard(html, 'changed\tother\tother');
      expect(cellsFromHtmlRows(parsed.rows).map(x => x.cell.v), html).toEqual(['a\0g', 'other', 'other']);
      const explicit = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
      expect(explicit.s.bold).toBe(true);
      expect(explicit.richText).toBeUndefined();
    }
  }
  expect(value(office('<td x:str="&#0;&#x0;&#000;">display</td>'))).toBe('\0\0\0');
  expect(value(office('<td x:str="a\0b">display</td>'))).toBe('ab');
  expect(value(office('<td x:str="\0">display</td>'))).toBe('');
});

it('keeps HTML character-reference boundaries, literal replacements and escaped references distinct', () => {
  // Missing semicolons use standard HTML longest-digit-prefix recovery.
  // Excel's legacy malformed-hex rules differ; do not infer a delimiter table
  // from isolated native controls or change nonzero references to fit them.
  for (const [source, expected] of [
    ['a&#x0g', 'a\0g'], ['a&#x00g', 'a\0g'], ['a&#x0b', 'a\x0b'], ['a&#01;b', 'a\x01b'],
    ['&#x0', '\0'], ['a&#x0 b', 'a\0 b'], ['&#x01g', '\x01g'], ['&#x1g;', '\x01g;'],
    ['a&#x0😀', 'a\0😀'], ['a&#x0雪;', 'a\0雪;'], ['&#x0aG;', '\nG;'],
    ['a&#0;b&#65533;c', 'a\0b\uFFFDc'], ['&#0;&amp;#0;', '\0&#0;'],
    ['&#0;&quot;&apos;&amp;&#x1f600;', '\0"\'&😀'],
    ['a&#13;0&#0;b&#xD;1&#x0;c', 'a\r0\0b\r1\0c'],
    ['&#013;&#0;&#x000D;01', '\r\0\r01'], ['&#0;&#0130;&#x0D0;', '\0\u0082Ð'],
    ['a&NewLine;0&#0;&amp;#13;1', 'a\n0\0&#13;1'],
    // Excel retains literal line endings in explicit string attributes.
    ['a\r0&#0;b\r\n1', 'a\r0\0b\r\n1'],
  ]) expect(value(office(`<td x:str="${source}">display</td>`)), source).toBe(expected);
  for (const suffix of ['_', '=', ',', '.', '-', '/', '#', '@', '+', '!', ':', '?', ')', '&amp;']) {
    expect(value(office(`<td x:str="a&#x0${suffix}Z">display</td>`))).toBe('a\0' + (suffix === '&amp;' ? '&' : suffix) + 'Z');
    expect(parse(`a&#x0${suffix}Z`)[0][0].text).toBe('a' + (suffix === '&amp;' ? '&' : suffix) + 'Z');
  }
  expect(parse('a&#x0g')[0][0].text).toBe('ag');
  expect(cellsFromHtmlRows(parse('&#x0'))[0].cell).toBeNull();
});

it('uses source token boundaries and first-attribute precedence for protected values', () => {
  for (const [attrs, expected] of [
    ['x:str="a&#0;b" x:str="ignored"', 'a\0b'],
    ['x:str="kept" x:str="&#0;"', 'kept'], ['x:str x:str="&#0;"', 'display'],
    [`title="<td x:str='&#0;'>" x:str="a&#0;b"`, 'a\0b'],
    ['data-office-empty-string="nul" data-office-empty-string-0 x:str="a&#0;b"', 'a\0b'],
  ]) expect(value(office(`<td ${attrs}>display</td>`)), attrs).toBe(expected);
  expect(parseHtmlClipboard(office('<td x:num="7" x:str="&#0;">display</td>')).rows[0][0].value).toBe(7);
  const html = '<script>"<td x:str=\"&#0;\">"</script><!-- <td x:str="&#0;"> -->' + office('<th x:str="İ😀&#0;雪">display</th>');
  expect(value(html)).toBe('İ😀\0雪');
});

it('removes encoding markers and restores attributes before resolving CSS', () => {
  const spy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    const html = '<style>td[x\\:str="a�b"] {color:#ff0000} td {color:#123456}</style>' + office('<td x:str="a&#0;b">display</td>');
    expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell).toMatchObject({v:'a\0b',s:{color:'#123456'}});
    expect(spy).toHaveBeenCalledTimes(2);
    const td = spy.mock.results.at(-1).value.querySelector('td');
    expect(td.getAttributeNames()).toEqual(['x:str']);
    expect(td.getAttribute('x:str')).toBe('a\0b');
  } finally { spy.mockRestore(); }
});

it('emits numeric NUL references and retains private, value-only and foreign copies', () => {
  const values = ['\0', 'a\0b\0c', 'a\r0\0b\r\n1', 'a\uFFFD\0b', '\0&#0;'];
  const matrix = [values], cells = [values.map(v => ({v}))];
  const html = cellsToHtml(matrix, cells, null, matrix);
  expect(html).toContain('x:str="a&#0;b&#0;c"');
  expect(parseHtmlClipboard(html).cells.map(row => row.map(c => c.v))).toEqual(matrix);
  for (const copy of [foreign(html), cellsToHtml(matrix, null, null, matrix)]) {
    expect(cellsFromHtmlRows(parseHtmlClipboard(copy).rows).map(x => x.cell.v)).toEqual(values);
  }
  const onlyValues = cellsToHtml(matrix, null, null, matrix);
  const serialized = new DOMParser().parseFromString(onlyValues, 'text/html').documentElement.outerHTML;
  expect(cellsFromHtmlRows(parseHtmlClipboard(serialized).rows).map(x => x.cell.v)).toEqual(values);
});

it('preserves NUL string semantics through editing, undo and native XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{r:0,c:0,cell:cellsFromHtmlRows(parseHtmlClipboard(office('<td x:str="a&#0;b">display</td>')).rows)[0].cell},
    {r:0,c:1,cell:{f:'LEN(A1)'}},{r:0,c:2,cell:{f:'ISBLANK(A1)'}}]);
  expect(wb.getValue(id,0,1)).toBe(3);
  expect(wb.getValue(id,0,2)).toBe(false);
  wb.setInput(id,0,0,'edited'); wb.undo();
  expect(wb.getValue(id,0,0)).toBe('a\0b');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), {type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'nul-roundtrip');
  expect(back.getValue(back.activeSheetId,0,0)).toBe('a\0b');
  expect(back.getValue(back.activeSheetId,0,1)).toBe(3);
  expect(back.getValue(back.activeSheetId,0,2)).toBe(false);
});
