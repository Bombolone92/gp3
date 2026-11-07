// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import native from './fixtures/reference-clipboard-representations.json';

const office = body => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table>${body}</table></body></html>`;
const values = result => cellsFromHtmlRows(result.rows).map(x => x.cell?.v ?? null);

it('combines native rendered HTML with width-independent TSV without retaining hashes or fill', () => {
  const parsed = parseHtmlClipboard(native.html, native.text);
  const cells = cellsFromHtmlRows(parsed.rows);
  const expected = ['alpha\nbeta gamma','label','label','label','00123','=SUM(1,2)','1/2','  two  spaces  ',12.35,123456789.25,true,.33,{error:'#DIV/0!'}];
  for (const column of [1,2]) {
    const data = cells.filter(x => x.j === column);
    expect(data.map(x => x.cell.v)).toEqual(expected);
    expect(data.every(x => x.cell.f == null && x.cell.s.wrap)).toBe(true);
  }
  expect(parsed.rows[0][1].style.code).toBe('0;0;0;@*.');
  // The external formats contain only 12.35 and .33, not 12.345 or =1/3.
  expect(cells.find(x => x.i === 8 && x.j === 1).cell.v).toBe(12.35);
});

it('keeps explicit typed values ahead of both rendered representations', () => {
  const html=office('<tr><td x:num="12.345">###</td><td x:str="raw">shown</td><td x:bool="TRUE">yes</td><td x:str>collapsed text</td></tr>');
  expect(values(parseHtmlClipboard(html,'12.35\tother\tFALSE\t  spaced  text  '))).toEqual([12.345,'raw',true,'  spaced  text  ']);
});

it('recognizes Office ProgId for TSV values and honors declared wrapping in generic web tables', () => {
  const body='<table><tr><td style="white-space:normal">###</td></tr></table>';
  const native=parseHtmlClipboard('<meta name="ProgId" content="Excel.Sheet">'+body,'"two\nlines"');
  expect(native.rows[0][0]).toMatchObject({text:'two\nlines',style:{wrap:true}});
  expect(parseHtmlClipboard(body,'different').rows[0][0]).toEqual({text:'###',style:{wrap:true}});
});

it.each(['a', 'a\tb\tc', 'a\tb\nextra\trow', 'a\tb\t', '"bad"quote\tb', 'a\t"unfinished'])('ignores an incompatible TSV shape: %j', text => {
  const html=office('<tr><td>left</td><td>right</td></tr>');
  expect(values(parseHtmlClipboard(html,text))).toEqual(['left','right']);
});

it('maps merged geometry only when the covered TSV cells are empty', () => {
  const html=office('<tr><td rowspan="2" colspan="2">painted</td><td>c</td></tr><tr><td>d</td></tr>');
  const result=parseHtmlClipboard(html,'actual\t\tc\n\t\td');
  expect(result.merges).toEqual([{r1:0,c1:0,r2:1,c2:1}]);
  expect(values(result)).toEqual(['actual',null,'c',null,null,'d']);
  expect(parseHtmlClipboard(html,'actual\tcovered\tc\n\t\td').rows[0][0].text).toBe('painted');
});

it('uses TSV quoting without CSV guessing for commas, tabs, quotes, and hard breaks', () => {
  const html=office('<tr><td>x</td></tr><tr><td>y</td></tr>');
  expect(values(parseHtmlClipboard(html,'"a,b\tc\n\"\"quoted\"\""\r\nother,words\r\n'))).toEqual(['a,b\tc\n"quoted"','other,words']);
});

it('does not reinterpret numeric fields through their text section or override typed strings', () => {
  const html=office('<tr><td style=\'mso-number-format:"0;0;0;@@"\'>1212</td><td x:str="abcd" style=\'mso-number-format:"0;0;0;@@"\'>abcdabcd</td></tr>');
  expect(values(parseHtmlClipboard(html,'1212\tabcdabcd'))).toEqual([1212,'abcd']);
});

it('recognizes omitted default text alignment only in Office General cells', () => {
  const body='<style>td{text-align:general;mso-number-format:General}</style><table><tr><td>00123</td><td align=right>123</td><td align=center>TRUE</td><td>TRUE</td><td x:num>45</td><td style="text-align:left">67</td></tr></table>';
  expect(values(parseHtmlClipboard('<html xmlns:x="urn:schemas-microsoft-com:office:excel">'+body+'</html>'))).toEqual(['00123',123,true,'TRUE',45,67]);
  expect(values(parseHtmlClipboard(body))[0]).toBe(123);
});

it('preserves literal formula text from Office and Text-formatted cells without changing ordinary web paste', () => {
  expect(values(parseHtmlClipboard(office('<tr><td>=1+1</td></tr>'),'=1+1'))).toEqual(['=1+1']);
  const text=parseHtmlClipboard('<table><tr><td style=\'mso-number-format:"\\@"\'>=1+1</td></tr></table>');
  expect(values(text)).toEqual(['=1+1']);
  expect(cellsFromHtmlRows(parseHtmlClipboard('<table><tr><td>=1+1</td></tr></table>').rows)[0].cell.f).toBe('1+1');
});

it('keeps signed internal cells ahead of any accompanying TSV', () => {
  const cell={v:42,f:null,s:{fmt:'number',dec:2}};
  const html=cellsToHtml([['42.00']],[[cell]],null,[[42]]);
  expect(parseHtmlClipboard(html,'wrong').cells[0][0]).toMatchObject(cell);
});
