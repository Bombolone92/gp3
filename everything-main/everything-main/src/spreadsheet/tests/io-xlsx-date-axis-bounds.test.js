import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { ymdToSerial as d } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('').window.DOMParser)();
const cases = [
  ['days', [45000.1,45000.9,45002,45009], 44996,45014, [4,4,6,13],19],
  ['months', [d(2024,1,15),d(2024,1,31),d(2024,2,29),d(2024,5,20)], d(2024,1,10),d(2024,7,20), [0,0,1,4],7],
  ['years', [d(2022,7,15),d(2023,1,1),d(2023,12,20),d(2025,4,1)], d(2021,6,15),d(2026,10,20), [1,2,2,4],6],
];
function fixture(type, base, dates, min, max, between, reverse) {
  return new Workbook({sheets:[{name:'Dates',charts:[{type,anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},legend:false,yMin:0,yMax:100,
    sourceRefs:[{name:'Values',literal:{categories:dates,values:[20,80,30,60]}}],
    appearance:{dateAxis:true,xMin:min,xMax:max,xBaseTimeUnit:base,xTimeUnit:base,xStep:1,xFormat:'yyyy-mm-dd',
      categoryBetween:between,reverseCategories:reverse,plot:{x:.2,y:.2,w:.6,h:.6},lines:[{marker:true}],
      axisStyles:{x:{color:'#111111',majorTick:'out'},y:{color:'#222222'}},axisCrossings:{y:'min'}}}]}]});
}
async function native(wb, check = () => {}, transformBook = xml => xml) {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  check(new TextDecoder().decode(X.CFB.find(zip,'/xl/charts/chart1_1.xml').content));
  const book=X.CFB.find(zip,'/xl/workbook.xml');
  book.content=new TextEncoder().encode(transformBook(new TextDecoder().decode(book.content)).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'dates.xlsx');
}
function draw(wb) {
  const chart=wb.activeSheet.charts[0],svg=renderChartSvg(chartData(wb,wb.activeSheetId,chart),chart,600,400);
  expect(svg).not.toMatch(/NaN|Infinity/);
  const doc=parser.parseFromString(svg,'image/svg+xml'),clip=doc.querySelector('clipPath rect');
  return {doc,plot:{x:+clip.getAttribute('x'),y:+clip.getAttribute('y')+1,w:+clip.getAttribute('width'),h:+clip.getAttribute('height')-2}};
}
it.each(['column','bar','line'])('preserves native %s date bounds, base units and geometry through repeated round trips',async type=>{
  for(const [base,dates,min,max,indices,count] of cases) for(const between of [true,false]) for(const reverse of [true,false]) {
    let wb=fixture(type,base,dates,min,max,between,reverse);
    for(let pass=0;pass<2;pass++) {
      wb=await native(wb,xml=>{
        const axis=/<c:dateAx>([\s\S]*?)<\/c:dateAx>/.exec(xml)[1];
        expect(axis).toContain(`<c:min val="${min}"/>`);expect(axis).toContain(`<c:max val="${max}"/>`);
        expect(axis).toContain(`<c:baseTimeUnit val="${base}"/>`);
        expect(axis.indexOf('<c:baseTimeUnit')).toBeLessThan(axis.indexOf('<c:majorUnit'));
      });
      expect(wb.activeSheet.charts[0].appearance).toMatchObject({xMin:min,xMax:max,xBaseTimeUnit:base,categoryBetween:between,reverseCategories:reverse});
      const {doc,plot}=draw(wb),horizontal=type==='bar',key=horizontal?'y':'x';
      const marks=[...doc.querySelectorAll(type==='line'?'circle':horizontal?'.chart-bar':'.chart-column')];
      expect(marks).toHaveLength(4);
      marks.forEach((mark,i)=>{
        const fraction=(indices[i]+(between?.5:0))/(count-(between?0:1));
        const center=type==='line'?+mark.getAttribute('cx'):+mark.getAttribute(key)+ +mark.getAttribute(horizontal?'height':'width')/2;
        expect(center).toBeCloseTo(horizontal?plot.y+plot.h*(reverse?fraction:1-fraction):plot.x+plot.w*(reverse?1-fraction:fraction),1);
        if(type!=='line') expect(+mark.getAttribute(horizontal?'height':'width')).toBeCloseTo((horizontal?plot.h:plot.w)/(count-(between?0:1))/2.5,1);
      });
      const ticks=[...doc.querySelectorAll('.chart-axis-x.chart-axis-tick-major')];
      expect(ticks).toHaveLength(count+(between?1:0));
    }
    const original=wb.activeSheet.charts[0],id=wb.duplicateChart(wb.activeSheetId,original.id);
    expect(wb.chartById(wb.activeSheetId,id).appearance).toEqual(original.appearance);
    wb.undo();expect(wb.activeSheet.charts).toHaveLength(1);
  }
});
it('keeps date bounds fixed while live categories are edited and undone',async()=>{
  const wb=fixture('column','days',[45000,45002,45005,45009],44996,45014,true,false),id=wb.activeSheetId;
  [45000,45002,45005,45009].forEach((v,r)=>wb.setInput(id,r,0,String(v)));
  const chart=wb.activeSheet.charts[0];
  wb.updateChart(id,chart.id,{sourceRefs:[{name:'Values',categories:'Dates!A1:A4',literal:{values:[20,80,30,60]}}]});
  const before=draw(wb).doc.querySelector('.chart-column').getAttribute('x');
  wb.setInput(id,0,0,'45001');
  const after=draw(wb).doc.querySelector('.chart-column').getAttribute('x');
  expect(+after- +before).toBeCloseTo(360/19,1);
  expect(wb.activeSheet.charts[0].appearance.xMin).toBe(44996);
  wb.undo();expect(draw(wb).doc.querySelector('.chart-column').getAttribute('x')).toBe(before);
  const back=await native(wb);expect(chartData(back,back.activeSheetId,back.activeSheet.charts[0]).x).toEqual([45000,45002,45005,45009]);
});
it('omits malformed calendar points from lines and trend fits',()=>{
  const wb=fixture('line','days',[45000,1e100,45002,NaN],44996,45014,true,false);
  wb.updateChart(wb.activeSheetId,wb.activeSheet.charts[0].id,{trendline:true});
  expect(draw(wb).doc.querySelectorAll('circle')).toHaveLength(2);
});
it.each([
  ['yyyy-mm-dd', true], ['yyyy-mm-dd hh:mm', true], ['[>=43000]yyyy-mm-dd;0', true],
  ['General', false], ['hh:mm', false], ['[h]:mm', false], ['[>=44000]yyyy-mm-dd;0', false],
])('normalizes 1904 date-axis bounds and format-sensitive literals (%s) only once',async(format,shift)=>{
  const dates=[43538,43540,43543,43547];
  let wb=fixture('column','days',dates,43534,43552,true,false),id=wb.activeSheetId,chart=wb.activeSheet.charts[0];
  wb.updateChart(id,chart.id,{sourceRefs:[{...chart.sourceRefs[0],categoryFormat:format}],appearance:{...chart.appearance,axisCrossings:{x:50,y:43540}}});
  wb=await native(wb,()=>{},xml=>xml.replace(/<workbookPr\b([^>]*)\/>/,(_,attrs)=>`<workbookPr${attrs.replace(/\sdate1904="[^"]*"/,'')} date1904="1"/>`));
  for(let pass=0;pass<2;pass++) {
    chart=wb.activeSheet.charts[0];
    expect(chart.appearance).toMatchObject({xMin:44996,xMax:45014,axisCrossings:{x:50,y:45002}});
    expect(chartData(wb,wb.activeSheetId,chart).x).toEqual(dates.map(v=>v+(shift?1462:0)));
    const {doc,plot}=draw(wb),bar=doc.querySelector('.chart-column');
    const center=+bar.getAttribute('x')+ +bar.getAttribute('width')/2;
    if(shift) expect(center).toBeCloseTo(plot.x+plot.w*4.5/19,1);
    else expect(center).toBeLessThan(plot.x);
    wb=await native(wb);
  }
});
it.each([true,false])('aligns 1904 bounds with live references without double-converting date cells (%s)',async(formatted)=>{
  let wb=fixture('line','months',[43538,43540,43543,43547],43534,43552,true,false),id=wb.activeSheetId,chart=wb.activeSheet.charts[0];
  [43538,43540,43543,43547].forEach((v,r)=>wb.setInput(id,r,0,String(v)));
  if(formatted) wb.applyStyle(id,{r1:0,c1:0,r2:3,c2:0},{fmt:'custom',code:'yyyy-mm-dd'});
  wb.updateChart(id,chart.id,{sourceRefs:[{name:'Values',categories:'Dates!A1:A4',categoryFormat:'yyyy-mm-dd',literal:{values:[20,80,30,60]}}]});
  wb=await native(wb,()=>{},xml=>xml.replace(/<workbookPr\b([^>]*)\/>/,(_,attrs)=>`<workbookPr${attrs.replace(/\sdate1904="[^"]*"/,'')} date1904="1"/>`));
  const expected=[43538,43540,43543,43547].map(v=>v+(formatted?1462:0));
  for(let pass=0;pass<2;pass++) {
    expect(wb.activeSheet.charts[0].appearance).toMatchObject({xMin:44996,xMax:45014,xBaseTimeUnit:'months'});
    expect(chartData(wb,wb.activeSheetId,wb.activeSheet.charts[0]).x).toEqual(expected);
    expect(wb.getValue(wb.activeSheetId,0,0)).toBe(expected[0]);
    wb=await native(wb);
  }
});
