// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { sheetToHtml, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = html => parseHtmlClipboard(html).rows;
const alignments = rows => rows.flat().map(cell => cell.style?.valign);

it('reads top, middle and bottom from native class styles and inline CSS', () => {
  const rows = parse(`<style>td {vertical-align:bottom}.top{vertical-align:top}.middle{vertical-align:middle}</style>
    <table><tr><td class=top>A</td><td class=middle>B<br>C</td><td>D</td><td class=top style="vertical-align: MIDDLE">E</td></tr></table>`);
  expect(alignments(rows)).toEqual(['top','middle','bottom','middle']);
  const cells = cellsFromHtmlRows(rows, () => ({valign:'top',bold:true}));
  expect(cells[1].cell.s).toMatchObject({valign:'middle',bold:true,wrap:true});
});

it('inherits table-group and row alignment, with cell hints and author CSS taking precedence', () => {
  const rows = parse(`<style>.override{vertical-align:bottom !important} .inherit{vertical-align:inherit}</style>
    <table><tbody valign=top><tr><td>A</td><th>B</th></tr>
    <tr valign=bottom><td>C</td><td valign=middle>D</td></tr>
    <tr style="vertical-align:middle"><td valign=top class=override style="vertical-align:top">E</td><td class=inherit valign=top>F</td></tr></tbody></table>`);
  expect(alignments(rows)).toEqual(['top','top','bottom','middle','bottom','middle']);
});

it('includes each cell’s presentational hint in the style cache key', () => {
  expect(alignments(parse('<table><tr><td valign=TOP>A</td><td valign=middle>B</td><td valign=bottom>C</td><td>D</td></tr></table>'))).toEqual(['top','middle','bottom',undefined]);
  expect(alignments(parse('<style>*{vertical-align:middle}</style><table><tr><td valign=top>A</td></tr></table>'))).toEqual(['middle']);
});

it('does not inherit vertical alignment through unrelated ancestors or override explicit resets', () => {
  const rows=parse('<div style="vertical-align:bottom"><table style="vertical-align:top"><tbody><tr valign=bottom><td style="vertical-align:initial">A</td><td style="vertical-align:unset">B</td><td style="vertical-align:inherit">C</td></tr><tr><td>D</td></tr></tbody></table></div>');
  expect(alignments(rows)).toEqual([undefined,undefined,'bottom',undefined,undefined,undefined]);
  const nested=parse('<table><tr valign=bottom><td><table><tr><td>nested</td></tr></table></td></tr></table>');
  // The parser selects the inner data table; its group starts a new context.
  expect(nested[0][0].style?.valign).toBeUndefined();
});

it('leaves unsupported alignments unconverted instead of guessing a supported placement', () => {
  expect(alignments(parse('<table><tr><td valign=center>A</td><td valign=" top ">B</td><td style="vertical-align:baseline">C</td><td style="vertical-align:2px">D</td><td style="vertical-align:text-top">E</td></tr></table>'))).toEqual([undefined,undefined,undefined,undefined,undefined]);
});

it('writes explicit alignments and the implicit spreadsheet middle default into external clipboard HTML', () => {
  const cells = ['top','middle','bottom',undefined,null,'bad; color:red'].map(valign => ({v:'value',s:{valign}}));
  const html = cellsToHtml([cells.map(c=>c.v)],[cells]);
  const doc = new DOMParser().parseFromString(html,'text/html');
  expect([...doc.querySelectorAll('td')].map(td=>td.style.verticalAlign)).toEqual(['top','middle','bottom','middle','middle','middle']);
  const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  expect(alignments(parse(external))).toEqual(['top','middle','bottom','middle','middle','middle']);
  const unstyled = new DOMParser().parseFromString(cellsToHtml([['x']],[[{v:'x'}]]),'text/html');
  expect(unstyled.querySelector('td').style.verticalAlign).toBe('middle');
  expect(unstyled.querySelector('td').style.whiteSpace).toBe('nowrap');
  const web = new DOMParser().parseFromString(cellsToHtml([['x','y']],[[{v:'x'},{v:'y',s:{valign:'bottom'}}]],null,null,null,{clipboard:false}),'text/html');
  expect([...web.querySelectorAll('td')].map(td=>td.style.verticalAlign)).toEqual(['','bottom']);
});

it('preserves resolved row alignment through two native-only XLSX round trips and external HTML copy', async () => {
  const rows=parse('<table><tbody valign=top><tr><td>A</td><td valign=middle>B</td><td style="vertical-align:bottom">C</td></tr></tbody></table>');
  let wb=new Workbook();wb.setCells(wb.activeSheetId,cellsFromHtmlRows(rows).map(({i,j,cell})=>({r:i,c:j,cell})));
  for(let pass=0;pass<2;pass++) {
    const blob=await workbookToXlsx(wb), bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsArrayBuffer(blob);});
    const zip=X.CFB.read(new Uint8Array(bytes),{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
    part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'vertical.xlsx');
    expect([0,1,2].map(c=>wb.styleAt(wb.activeSheetId,0,c).valign)).toEqual(['top','middle','bottom']);
  }
  const cells=wb.copyRange(wb.activeSheetId,{r1:0,c1:0,r2:0,c2:2});
  const html=cellsToHtml([['A','B','C']],cells).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  expect(alignments(parse(html))).toEqual(['top','middle','bottom']);
});

it('exports a web page with the same explicit and default vertical placement as the spreadsheet', () => {
  const wb=new Workbook(),id=wb.activeSheetId;
  ['top','middle','bottom',undefined].forEach((valign,c)=>wb.setCells(id,[{r:0,c,cell:{v:'Line',s:{valign}}}]));
  const page=sheetToHtml(wb,id);
  expect(alignments(parse(page))).toEqual(['top','middle','bottom','middle']);
});
