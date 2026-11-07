import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const make = (code, categories) => normalizeChart({type:'bar',legend:false,range:{r1:0,c1:0,r2:2,c2:0},anchor:{r:0,c:2},
  sourceRefs:[{literal:{values:[4,9,6],...(categories ? {categories} : {})}}],appearance:{xFormat:code}});
const text = (wb,ch) => new JSDOM(renderChartSvg(chartData(wb,wb.activeSheetId,ch),ch,560,340)).window.document.body.textContent;
it('formats generated numeric categories without changing their source labels',()=>{
  const w=new Workbook(), ch=make('"Period "00');
  expect(chartData(w,w.activeSheetId,ch).categories).toEqual(['1','2','3']);
  expect(text(w,ch)).toContain('Period 01');
  expect(text(w,ch)).toContain('Period 03');
  const hidden=make(';;'); hidden.appearance.hideYAxis=true;
  const dom=new JSDOM(renderChartSvg(chartData(w,w.activeSheetId,hidden),hidden,560,340));
  expect([...dom.window.document.querySelectorAll('text')].some(n=>n.textContent==='1')).toBe(false);
});
it('retains numeric versus text types and applies the fourth format section',()=>{
  const w=new Workbook(),ch=make('0.0;0.0;0.0;"Text "@',[2.5,'2.5','East']);
  expect(text(w,ch)).toContain('Text 2.5');
  expect(text(w,ch)).toContain('Text East');
  expect(chartData(w,w.activeSheetId,ch).categoryValues).toEqual([2.5,'2.5','East']);
});
it('formats worksheet categories and updates after edits',()=>{
  const w=new Workbook(),id=w.activeSheetId;
  w.setInput(id,0,0,'Alpha');w.setInput(id,1,0,'Beta');w.setInput(id,0,1,4);w.setInput(id,1,1,7);
  const ch={...make(';;;"Item "@'),sourceRefs:undefined,headers:false,seriesIn:'cols',range:{r1:0,c1:0,r2:1,c2:1}};
  expect(text(w,ch)).toContain('Item Alpha');
  w.setInput(id,0,0,'Gamma');expect(text(w,ch)).toContain('Item Gamma');
});
it('preserves the axis format through duplication and native-only export',async()=>{
  const w=new Workbook({sheets:[{name:'Data',charts:[make('"Q"0')]}]});
  w.duplicateChart(w.activeSheetId,w.activeSheet.charts[0].id);
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
  p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
  const r=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'axis.xlsx');
  for(const ch of r.activeSheet.charts){expect(ch.appearance.xFormat).toBe('"Q"0');expect(text(r,ch)).toContain('Q3')}
});

it('keeps source-linked category display text instead of applying the cached axis code',()=>{
  const w=new Workbook(),id=w.activeSheetId;
  w.setInput(id,0,0,7);w.setInput(id,1,0,8);
  w.setInput(id,0,1,4);w.setInput(id,1,1,5);
  w.applyStyle(id,{r1:0,c1:0,r2:1,c2:0},{fmt:'custom',code:'"Item "00'});
  const ch=make('General');ch.appearance.xSourceLinked=true;
  ch.sourceRefs=[{categories:'Sheet1!A1:A2',values:'Sheet1!B1:B2'}];
  expect(text(w,ch)).toContain('Item 07');
  expect(text(w,ch)).toContain('Item 08');
});
it.each([['',true],[' sourceLinked="1"',true],[' sourceLinked="0"',false]])('imports category source linkage %s',async(attribute,expected)=>{
  const w=new Workbook({sheets:[{name:'Data',charts:[make('0.00')]}]});
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'});
  const p=X.CFB.find(zip,'/xl/workbook.xml');p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
  const c=X.CFB.find(zip,'/xl/charts/chart1_1.xml');
  c.content=new TextEncoder().encode(new TextDecoder().decode(c.content).replace(/(<c:catAx>[\s\S]*?<c:numFmt[^>]*?) sourceLinked="0"/,`$1${attribute}`));c.size=c.content.length;
  const r=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'linked.xlsx');
  expect(!!r.activeSheet.charts[0].appearance.xSourceLinked).toBe(expected);
});

it('keeps raw category values aligned when Pareto sorts categories',()=>{
  const w=new Workbook(),ch=make('"Group "0',[12,31,7]);ch.pareto=true;
  const d=chartData(w,w.activeSheetId,ch);
  expect(d.categories).toEqual(['31','7','12']);
  expect(d.categoryValues).toEqual([31,7,12]);
});
