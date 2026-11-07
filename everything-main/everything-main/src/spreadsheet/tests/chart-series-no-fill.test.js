import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const make = type => ({ type, legend: false, colors: ['none'],
  anchor:{r:0,c:2},range:{r1:0,c1:0,r2:2,c2:0},
  sourceRefs:[{literal:{categories:['A','B','C'],values:[4,9,6]}}],
  appearance:{bars:[{invertIfNegative:false,stroke:'#224466',strokeWidth:2}],
    pointColors:[[{index:1,color:'#aa4400'}]]} });
const native = async wb => {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const p=X.CFB.find(zip,'/xl/workbook.xml');p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'paint.xlsx');
};
it('distinguishes no fill from automatic color and invalid paint',()=>{
  expect(normalizeChart({...make('bar'),colors:['none',null,' #AaBBcc ','transparent','url(x)']}).colors).toEqual(['none',null,'#aabbcc']);
});
it.each(['column','bar'])('retains %s no-fill, point overrides and independent outlines through duplication/export',async type=>{
  const wb=new Workbook({sheets:[{name:'Data',charts:[make(type)]}]}),id=wb.activeSheetId;
  const copy=wb.duplicateChart(id,wb.activeSheet.charts[0].id);
  expect(wb.chartById(id,copy).colors).toEqual(['none']);
  let book=wb;
  for(let i=0;i<2;i++){
    book=await native(book);
    for(const ch of book.activeSheet.charts){
      expect(ch.colors).toEqual(['none']);
      const svg=renderChartSvg(chartData(book,book.activeSheetId,ch),ch,500,300);
      const dom=new JSDOM(svg),bars=[...dom.window.document.querySelectorAll('.chart-bar,.chart-column')];
      expect(bars.map(n=>n.getAttribute('fill'))).toEqual(['none','#aa4400','none']);
      expect(bars[0].getAttribute('stroke')).toBe('#224466');
      expect(bars[2].getAttribute('stroke')).toBe('#224466');
    }
  }
});
