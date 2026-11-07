import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

async function native(wb, position, inject = false) {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const chart=X.CFB.find(zip,'/xl/charts/chart1_1.xml');let xml=new TextDecoder().decode(chart.content);
  if(inject) {
    xml=xml.replace(/<c:valAx>([\s\S]*?)<\/c:valAx>/g,(all,body)=>body.includes('<c:axId val="3"/>')
      ? '<c:valAx>'+body.replace(/<c:tickLblPos[^>]*\/>/,`<c:tickLblPos val="${position}"/>`)+'</c:valAx>':all);
    chart.content=new TextEncoder().encode(xml);chart.size=chart.content.length;
  }
  const axes=[...xml.matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g)].map(m=>m[1]);
  expect(axes.find(a=>a.includes('<c:axId val="2"/>'))).toContain('<c:tickLblPos val="high"/>');
  expect(axes.find(a=>a.includes('<c:axId val="3"/>'))).toContain(`<c:tickLblPos val="${position}"/>`);
  const book=X.CFB.find(zip,'/xl/workbook.xml');book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'secondary.xlsx');
}
it.each(['nextTo','low','high','none'])('retains native secondary %s labels through edits, copies and metadata-free exports',async position=>{
  let wb=new Workbook({sheets:[{name:'Data',charts:[{type:'combo',secondaryAxis:true,anchor:{r:0,c:3},range:{r1:0,c1:0,r2:2,c2:1},
    sourceRefs:[{name:'Columns',literal:{categories:['A','B','C'],values:[20,80,40]}},{name:'Line',literal:{categories:['A','B','C'],values:[2,8,4]}}],
    appearance:{yLabelPosition:'high',reverseCategories:true,reverseSecondaryValues:true,axisCrossings:{y2:2}}}]}]});
  wb=await native(wb,position,true);
  for(let pass=0;pass<2;pass++) {
    const sheet=wb.activeSheet,chart=sheet.charts[0];
    expect(chart.appearance).toMatchObject({yLabelPosition:'high',y2LabelPosition:position,reverseCategories:true,reverseSecondaryValues:true,axisCrossings:{y2:2}});
    const copy=wb.duplicateChart(sheet.id,chart.id);expect(wb.chartById(sheet.id,copy).appearance).toEqual(chart.appearance);
    wb.undo();expect(sheet.charts).toHaveLength(1);
    wb.updateChart(sheet.id,chart.id,{appearance:{...chart.appearance,y2LabelPosition:position==='none'?'low':'none'}});
    expect(sheet.charts[0].appearance.y2LabelPosition).not.toBe(position);
    wb.undo();expect(sheet.charts[0].appearance.y2LabelPosition).toBe(position);
    expect(new Workbook(wb.toJSON()).activeSheet.charts[0].appearance.y2LabelPosition).toBe(position);
    wb=await native(wb,position);
  }
});
