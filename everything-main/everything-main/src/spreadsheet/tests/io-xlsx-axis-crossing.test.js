import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

async function nativeRoundTrip(wb, inspect) {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  inspect(new TextDecoder().decode(X.CFB.find(zip,'/xl/charts/chart1_1.xml').content));
  const book=X.CFB.find(zip,'/xl/workbook.xml');
  book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');
}
it.each(['column','bar','line','scatter','combo'])('preserves %s axis crossings through native-only round trips and duplication',async type=>{
  for(const crossing of ['autoZero','min','max',0,2.5,-250,45002]) {
    const axisCrossings={x:crossing,y:crossing,...(type==='combo'?{y2:crossing}:{})};
    let wb=new Workbook({sheets:[{name:'Data',charts:[{anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},type,secondaryAxis:type==='combo',
      sourceRefs:[{name:'First',literal:{categories:[45000,45003],values:[-30,70]}}, ...(type==='combo'?[{name:'Second',literal:{categories:[45000,45003],values:[3,7]}}]:[])],
      appearance:{axisCrossings,dateAxis:type==='line',reverseCategories:true}}]}]});
    for(let pass=0;pass<2;pass++) {
      wb=await nativeRoundTrip(wb,xml=>{
        const axes=[...xml.matchAll(/<c:(catAx|dateAx|valAx)>[\s\S]*?<\/c:\1>/g)].map(m=>m[0]);
        expect(axes).toHaveLength(type==='combo'?3:2);
        for(const axis of axes) {
          expect(axis).toContain(`<c:${typeof crossing==='number'?'crossesAt':'crosses'} val="${crossing}"/>`);
          expect(axis.match(/<c:crosses(?:At)?\b/g)).toHaveLength(1);
        }
      });
      expect(wb.activeSheet.charts[0].appearance.axisCrossings).toEqual(axisCrossings);
    }
    const sheet=wb.activeSheet,original=sheet.charts[0],copy=wb.duplicateChart(sheet.id,original.id);
    expect(wb.chartById(sheet.id,copy).appearance.axisCrossings).toEqual(axisCrossings);
    wb.undo();expect(sheet.charts).toHaveLength(1);
  }
});
it('keeps legacy authored axis-position defaults when no explicit crossing exists',async()=>{
  const wb=new Workbook({sheets:[{charts:[{anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},type:'column',sourceRefs:[{name:'Values',literal:{categories:['A','B'],values:[2,4]}}],appearance:{yPosition:'r'}}]}]});
  const imported=await nativeRoundTrip(wb,xml=>expect(xml).toContain('<c:crosses val="max"/>'));
  expect(imported.activeSheet.charts[0].appearance.axisCrossings).toEqual({x:'autoZero',y:'max'});
});
it.each(['INF','-INF','NaN','','not-a-number'])('ignores malformed native crossing %j without making an invalid axis',async value=>{
  const wb=new Workbook({sheets:[{name:'Data',charts:[{anchor:{r:0,c:3},range:{r1:0,c1:0,r2:1,c2:1},type:'column',
    sourceRefs:[{name:'Values',literal:{categories:['A','B'],values:[2,4]}}],appearance:{axisCrossings:{x:25}}}]}]});
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  for(const [path,replace] of [
    ['/xl/charts/chart1_1.xml',text=>text.replace('<c:crossesAt val="25"/>',`<c:crossesAt val="${value}"/>`)],
    ['/xl/workbook.xml',text=>text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')],
  ]) {
    const part=X.CFB.find(zip,path);part.content=new TextEncoder().encode(replace(new TextDecoder().decode(part.content)));part.size=part.content.length;
  }
  const native=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');
  expect(native.activeSheet.charts[0].appearance.axisCrossings).toEqual({y:'autoZero'});
});
