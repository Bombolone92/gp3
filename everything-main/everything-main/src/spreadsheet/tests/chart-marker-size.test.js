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
const chart = wb => wb.activeSheet.charts[0];
function draw(wb) {
  const ch=chart(wb), svg=renderChartSvg(chartData(wb,wb.activeSheetId,ch),ch,800,500);
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  return new JSDOM(svg).window.document;
}
const diameter = node => Number(node.getAttribute('r'))*2;
async function sized(type,size,table=false){
  return (await cycle(fixture(type),xml=>xml.replace(/<c:size val="[^"]+"\/>/g,`<c:size val="${size}"/>`)
    .replace('</c:plotArea>',(table?'<c:dTable><c:showKeys val="1"/></c:dTable>':'')+'</c:plotArea>'))).wb;
}
it.each(['line','scatter','combo','radar'].flatMap(type=>[2,5,9,72].map(size=>[type,size])))('renders %s native marker size %s in points and retains it through native cycles',async(type,size)=>{
  let wb=await sized(type,size);
  for(let pass=0;pass<3;pass++){
    const ch=chart(wb),doc=draw(wb), marks=[...doc.querySelectorAll('.chart-marker,.chart-radar-marker')];
    expect(marks.length).toBeGreaterThan(0);marks.forEach(n=>expect(diameter(n)).toBeCloseTo(size*4/3,1));
    const keys=[...doc.querySelectorAll('.chart-legend-marker,.chart-radar-legend-marker')];
    expect(keys.length).toBeGreaterThan(0);keys.forEach(n=>expect(diameter(n)).toBeCloseTo(Math.min(size*4/3,ch.appearance.legendStyle.size),1));
    expect(ch.appearance.lines.every(l=>l.markerSizeUnit==='pt')).toBe(true);
    const result=await cycle(wb);expect([...result.xml.matchAll(/<c:size val="([^"]+)"/g)].map(m=>+m[1])).toEqual(Array(keys.length).fill(size));wb=result.wb;
  }
});
it.each([5,9,72])('uses consistent marker size %s in native data-table keys',async size=>{
  const wb=await sized('line',size,true),doc=draw(wb),ch=chart(wb);
  const marks=[...doc.querySelectorAll('.chart-table-marker')];expect(marks).toHaveLength(2);
  marks.forEach(n=>expect(diameter(n)).toBeCloseTo(Math.min(size*4/3,ch.appearance.dataTable.style.size),1));
});
it.each([
  [false,undefined,9,9],[true,undefined,12,9],[true,'pt',12,12],[false,'px',12,9],
  [false,undefined,NaN,5],[false,'pt',-2,2],[false,'pt',100,72],[true,'px',96,72],
])('normalizes marker units once: mixed=%s unit=%s value=%s', (mixed,unit,size,expected)=>{
  const raw={type:'combo',anchor:{r:0,c:0},range:{r1:0,c1:0,r2:2,c2:1},appearance:{
    ...(mixed?{seriesTypes:['line','scatter']}:{}),lines:[{markerSize:size,...(unit?{markerSizeUnit:unit}:{})}],
  }};
  const before=JSON.stringify(raw),ch=normalizeChart(raw);
  expect(ch.appearance.lines[0]).toMatchObject({markerSize:expected,markerSizeUnit:'pt'});
  expect(normalizeChart(ch)).toEqual(ch);expect(JSON.stringify(raw)).toBe(before);
});
it('retains old mixed-series pixel sizes through JSON and sheet copy without shrinking twice',()=>{
  const json=fixture('combo').toJSON();json.sheets[0].charts[0].appearance={seriesTypes:['line','scatter'],lines:[{markerSize:12},{markerSize:20}]};
  let wb=new Workbook(json);for(let i=0;i<3;i++){
    const marks=[...draw(wb).querySelectorAll('.chart-marker')];expect(diameter(marks[0])).toBe(12);expect(diameter(marks[3])).toBe(20);
    expect(chart(wb).appearance.lines.map(l=>l.markerSize)).toEqual([9,15]);
    wb=new Workbook(wb.sheetToWorkbook(wb.activeSheetId).toJSON());
  }
});
it('keeps point sizes unchanged when chart type or series grouping changes',async()=>{
  let wb=await sized('line',9),json=wb.toJSON();json.sheets[0].charts[0].type='combo';
  json.sheets[0].charts[0].appearance.seriesTypes=['line','scatter'];wb=new Workbook(json);
  expect(chart(wb).appearance.lines.map(l=>l.markerSize)).toEqual([9,9]);
  expect(diameter(draw(wb).querySelector('.chart-marker'))).toBe(12);
});
it('keeps sizes and live values through metadata, editing and sheet copying',async()=>{
  let wb=await sized('scatter',9);wb.setInput(wb.activeSheetId,1,1,'11');
  wb=await workbookFromFile(await workbookToXlsx(wb));wb=new Workbook(wb.sheetToWorkbook(wb.activeSheetId).toJSON());
  wb=(await cycle(wb)).wb;
  expect(diameter(draw(wb).querySelector('.chart-marker'))).toBe(12);
  expect(chartData(wb,wb.activeSheetId,chart(wb)).series[0].values).toEqual([3,11,4]);
});
it.each([2,9,72])('retains size %s through native mixed-series groups without double conversion',async size=>{
  const json=fixture('combo').toJSON();json.sheets[0].charts[0].appearance={
    seriesTypes:['area','line'],seriesGroups:[{id:0,grouping:'standard'},{id:1,grouping:'standard'}],
    lines:[{marker:false},{marker:true,markerSize:size,markerSizeUnit:'pt'}],
  };
  let wb=new Workbook(json);
  for(let pass=0;pass<3;pass++){
    const result=await cycle(wb);expect(result.xml).toContain(`<c:size val="${size}"/>`);wb=result.wb;
    expect(chart(wb).appearance.seriesTypes).toEqual(['area','line']);
    expect(chart(wb).appearance.lines[1]).toMatchObject({markerSize:size,markerSizeUnit:'pt'});
    expect(diameter(draw(wb).querySelector('.chart-marker'))).toBeCloseTo(size*4/3,1);
  }
});
it.each([[0,2],[100,72],['invalid',5]])('bounds malformed native marker size %s to %s points',async(value,expected)=>{
  const wb=await sized('line',value);
  expect(chart(wb).appearance.lines[0]).toMatchObject({markerSize:expected,markerSizeUnit:'pt'});
  expect(diameter(draw(wb).querySelector('.chart-marker'))).toBeCloseTo(expected*4/3,1);
});
