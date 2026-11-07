import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const decode = part => new TextDecoder().decode(part.content);
function fixture(type) {
  return new Workbook({ sheets: [{ name: 'Chart', cells: {
    '0,0': {v:1}, '0,1': {v:3}, '0,2': {v:7},
    '1,0': {v:2}, '1,1': {v:5}, '1,2': {v:2},
    '2,0': {v:3}, '2,1': {v:4}, '2,2': {v:6},
  }, charts: [{ type, anchor:{r:4,c:0}, range:{r1:0,c1:0,r2:2,c2:2},
    sourceRefs:[{name:'First',categories:'Chart!A1:A3',values:'Chart!B1:B3'},
      {name:'Second',categories:'Chart!A1:A3',values:'Chart!C1:C3'}] }] }] });
}
async function cycle(wb, mutate) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), {type:'array'});
  const path='/xl/charts/chart1_1.xml'; let xml=decode(X.CFB.find(zip,path));
  if(mutate) { xml=mutate(xml); X.CFB.utils.cfb_add(zip,path,new TextEncoder().encode(xml)); }
  const part=X.CFB.find(zip,'/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
  return {wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'})),xml};
}
const shapes = { circle:'circle', square:'rect', diamond:'polygon', triangle:'polygon', plus:'path', x:'path', star:'path', dash:'path', dot:'path' };
const ch = wb => wb.activeSheet.charts[0];
function draw(wb) {
  const chart=ch(wb), svg=renderChartSvg(chartData(wb,wb.activeSheetId,chart),chart,640,420);
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  return new JSDOM(svg).window.document;
}
function assertShape(wb,symbol) {
  const chart=ch(wb), doc=draw(wb), plot=[...doc.querySelectorAll('.chart-marker, .chart-radar-marker')], legend=[...doc.querySelectorAll('.chart-legend-marker, .chart-radar-legend-marker')];
  if(symbol==='none'){expect(plot).toHaveLength(0);expect(legend).toHaveLength(0);return;}
  expect(plot).toHaveLength(chart.type==='combo'?3:6);expect(legend).toHaveLength(chart.type==='combo'?1:2);
  for(const node of [...plot,...legend]) expect(node.tagName.toLowerCase()).toBe(shapes[symbol]);
  if(symbol==='diamond'||symbol==='triangle') for(const node of [...plot,...legend]) expect(node.getAttribute('points').split(' ')).toHaveLength(symbol==='diamond'?4:3);
  expect(plot.every(node=>node.querySelector('title')?.textContent.includes(' · '))).toBe(true);
  if(symbol==='dot'||symbol==='dash')for(const node of [...plot,...legend]){
    const nums=node.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    expect(nums).toHaveLength(4);expect(nums[1]).toBe(nums[3]);expect(nums[2]).toBeGreaterThan(nums[0]);
  }
}
it.each(['line','scatter','combo','radar'].flatMap(type=>[...Object.keys(shapes),'none'].map(symbol=>[type,symbol])))('preserves %s %s markers through two native cycles',async(type,symbol)=>{
  let {wb}=await cycle(fixture(type),xml=>xml.replaceAll('<c:symbol val="circle"/>',`<c:symbol val="${symbol}"/>`));
  for(let pass=0;pass<3;pass++){
    assertShape(wb,symbol);
    const result=await cycle(wb);expect(result.xml).toContain(`<c:symbol val="${symbol}"/>`);wb=result.wb;
  }
});
it.each(['line','combo'])('uses retained %s marker shapes in chart data-table keys',async type=>{
  let {wb}=await cycle(fixture(type),xml=>xml.replaceAll('<c:symbol val="circle"/>','<c:symbol val="triangle"/>').replace('</c:plotArea>','<c:dTable><c:showKeys val="1"/></c:dTable></c:plotArea>'));
  for(let pass=0;pass<2;pass++){
    const table=draw(wb).querySelector('.chart-data-table');expect(table).not.toBeNull();
    const marks=[...table.querySelectorAll('.chart-table-marker')];expect(marks).toHaveLength(type==='combo'?1:2);
    expect(marks.every(n=>n.tagName.toLowerCase()==='polygon' && n.getAttribute('points').split(' ').length===3)).toBe(true);
    wb=(await cycle(wb)).wb;
  }
});
it('keeps marker shape and paint live through editing, copying and JSON',async()=>{
  let {wb}=await cycle(fixture('scatter'),xml=>xml.replaceAll('<c:symbol val="circle"/>','<c:symbol val="diamond"/>'));
  ch(wb).appearance.lines.forEach(line=>{line.markerFill='#22334466';line.markerStroke='#aabbcc99';});
  wb.setInput(wb.activeSheetId,1,1,'11');wb=new Workbook(wb.sheetToWorkbook(wb.activeSheetId).toJSON());
  wb=(await cycle(wb)).wb;assertShape(wb,'diamond');
  expect(chartData(wb,wb.activeSheetId,ch(wb)).series[0].values).toEqual([3,11,4]);
  const mark=draw(wb).querySelector('.chart-marker');expect(mark.getAttribute('fill')).toBe('#22334466');expect(mark.getAttribute('stroke')).toBe('#aabbcc99');
});
it('distinguishes short and long horizontal bar markers at the same size',async()=>{
  const widths=[];
  for(const symbol of ['dot','dash']){
    const {wb}=await cycle(fixture('line'),xml=>xml.replaceAll('<c:symbol val="circle"/>',`<c:symbol val="${symbol}"/>`));
    const numbers=draw(wb).querySelector('.chart-marker').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);widths.push(numbers[2]-numbers[0]);
  }
  expect(widths[0]).toBeLessThan(widths[1]);
});
it('normalizes known symbols safely while preserving older charts without a symbol',()=>{
  const chart=normalizeChart({type:'line',anchor:{r:0,c:0},range:{r1:0,c1:0,r2:2,c2:1},appearance:{lines:[{markerSymbol:'diamond'},{markerSymbol:'<script>'},{}]}});
  expect(chart.appearance.lines[0].markerSymbol).toBe('diamond');expect(chart.appearance.lines[1].markerSymbol).toBeUndefined();expect(chart.appearance.lines[2].markerSymbol).toBeUndefined();
});
it('retains an explicit automatic marker token in native export',async()=>{
  const {wb}=await cycle(fixture('line'),xml=>xml.replaceAll('<c:symbol val="circle"/>','<c:symbol val="auto"/>'));
  expect(ch(wb).appearance.lines[0].markerSymbol).toBe('auto');expect((await cycle(wb)).xml).toContain('<c:symbol val="auto"/>');
});
