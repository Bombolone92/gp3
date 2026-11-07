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
function assertMarkers(wb, fill, stroke) {
  const ch=wb.activeSheet.charts[0];
  const markerLines=ch.appearance.lines.filter((l,i)=>l.marker && (ch.type !== 'combo' || ch.appearance.seriesTypes?.[i] === 'line' || !ch.appearance.seriesTypes && i === ch.appearance.lines.length-1));
  expect(markerLines.length).toBeGreaterThan(0);
  for(const line of markerLines) { expect(line.markerFill).toBe(fill); expect(line.markerStroke).toBe(stroke); }
  const doc=new JSDOM(renderChartSvg(chartData(wb,wb.activeSheetId,ch),ch,640,420)).window.document;
  const marks=[...doc.querySelectorAll('circle')].filter(n=>n.getAttribute('fill')===fill && n.getAttribute('stroke')===stroke);
  expect(marks.length).toBeGreaterThanOrEqual(3);
}
it.each(['line','scatter','combo','radar'])('preserves native %s marker fill and outline transparency through editing, copying and native cycles',async type=>{
  let {wb}=await cycle(fixture(type),xml=>xml.replace(/<c:marker>[\s\S]*?<\/c:marker>/g,
    '<c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="123456"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:ln><a:solidFill><a:srgbClr val="ABCDEF"><a:alpha val="60000"/></a:srgbClr></a:solidFill></a:ln></c:spPr></c:marker>'));
  assertMarkers(wb,'#12345666','#abcdef99');
  wb.setInput(wb.activeSheetId,1,1,'9');
  wb=new Workbook(wb.sheetToWorkbook(wb.activeSheetId).toJSON());
  for(let i=0;i<2;i++) {
    const result=await cycle(wb);wb=result.wb;
    expect(result.xml).toContain('<a:alpha val="40000"/>');expect(result.xml).toContain('<a:alpha val="60000"/>');
    assertMarkers(wb,'#12345666','#abcdef99');
    expect(chartData(wb,wb.activeSheetId,wb.activeSheet.charts[0]).series[0].values).toEqual([3,9,4]);
  }
});
it.each([['#12345600','#abcdef00'],['none','none'],['#123456','#abcdef']])('retains marker paint %s without substituting the series color',async (fill,stroke)=>{
  let wb=fixture('radar'); const json=wb.toJSON();
  json.sheets[0].charts[0].appearance={lines:[{marker:true,markerFill:fill,markerStroke:stroke},{marker:true,markerFill:fill,markerStroke:stroke}]};
  wb=new Workbook(json);wb=(await cycle(wb)).wb;assertMarkers(wb,fill.endsWith('00') ? 'none' : fill,stroke.endsWith('00') ? 'none' : stroke);
});
it('rejects unsafe marker paint while normalizing valid alpha colors',()=>{
  const ch=normalizeChart({type:'line',anchor:{r:0,c:0},range:{r1:0,c1:0,r2:2,c2:1},appearance:{lines:[
    {markerFill:'#ABCDEF66',markerStroke:'#12345699'},
    {markerFill:'url(https://example.com)',markerStroke:'red" onload="bad'},
  ]}});
  expect(ch.appearance.lines[0]).toMatchObject({markerFill:'#abcdef66',markerStroke:'#12345699'});
  expect(ch.appearance.lines[1]).toMatchObject({markerFill:null,markerStroke:null});
});

it('applies ordered native marker alpha transforms before quantizing opacity', async () => {
  const {wb}=await cycle(fixture('radar'),xml=>xml.replace(/<c:marker>[\s\S]*?<\/c:marker>/g,
    '<c:marker><c:symbol val="circle"/><c:spPr><a:solidFill><a:srgbClr val="123456"><a:alpha val="80000"/><a:alphaMod val="50000"/><a:alphaOff val="20000"/></a:srgbClr></a:solidFill><a:ln><a:solidFill><a:srgbClr val="ABCDEF"><a:alpha val="50000"/><a:alphaOff val="80000"/></a:srgbClr></a:solidFill></a:ln></c:spPr></c:marker>'));
  assertMarkers(wb,'#12345699','#abcdef');
  assertMarkers((await cycle(wb)).wb,'#12345699','#abcdef');
});
