import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:2,c1:2,r2:6,c2:2};
function make(options={}) {
 const wb=new Workbook(),id=wb.activeSheetId;
 [-1,0,99,100,200].forEach((v,i)=>wb.setInput(id,i+2,2,String(v)));
 wb.addRule(id,{type:'icons',range,iconSet:'3Arrows',iconThreshold0:'99',iconThreshold0Type:'num',
  iconThreshold1:'100',iconThreshold1Type:'num',iconThreshold2:'200',iconThreshold2Type:'num',...options});return wb;
}
const look=(wb,r,c=2)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const icons=(wb,c=2,rows=[2,3,4,5,6])=>rows.map(r=>look(wb,r,c)?.icon);
async function native(wb) {
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'first.xlsx');
}
it.each([false,true])('honors the first inclusive/exclusive threshold and value hiding (extended=%s)',async extended=>{
 for(const inclusive of [false,true]) {
  let wb=make({iconOnly:true,iconThreshold0Gte:inclusive,...(extended?{iconCustom:true,
   icon0Set:'3Arrows',icon0Id:0,icon1Set:'3Arrows',icon1Id:1,icon2Set:'3Arrows',icon2Id:2}:{})});
  for(let pass=0;pass<3;pass++) {
   expect(icons(wb)).toEqual(['','',inclusive?'↓':'','→','↑']);
   for(let r=2;r<=6;r++)expect(look(wb,r).iconOnly).toBe(true);
   wb=await native(wb);
  }
 }
});
it('evaluates a live first-bound formula and invalidates errors and undo',async()=>{
 let wb=make({iconThreshold0:'$K$1',iconThreshold0Type:undefined,iconOnly:true}),id=wb.activeSheetId;
 wb.setInput(id,0,10,'99');expect(icons(wb)).toEqual(['','','↓','→','↑']);
 wb.setInput(id,0,10,'0');expect(icons(wb)).toEqual(['','↓','↓','→','↑']);
 wb.setInput(id,0,10,'=1/0');expect(icons(wb)).toEqual(Array(5).fill(undefined));
 expect(look(wb,6)).toBeNull();wb.undo();expect(icons(wb)).toEqual(['','↓','↓','→','↑']);
 wb=await native(wb);expect(icons(wb)).toEqual(['','↓','↓','→','↑']);
});
it.each(['percent','percentile'])('evaluates the first %s stop against copied and separate source statistics',async type=>{
 const wb=make({iconThreshold0:'50',iconThreshold0Type:type,iconThreshold1:'100',iconThreshold2:'200'}),id=wb.activeSheetId;
 const expected=type==='percent'?['','','','→','↑']:['','','↓','→','↑'];
 expect(icons(wb)).toEqual(expected);
 const rows=[2,3,4];wb.pasteCells(id,wb.copyCells(id,rows,[2]),10,7,{r:2,c:2},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[2])});
 const copied=type==='percent'?['','','↓']:['','↓','↓'];
 expect(icons(wb,7,[10,11,12])).toEqual(copied);
 [-1,0,99].forEach((value,i)=>wb.setInput(id,10+i,12,String(value)));
 wb.addRule(id,{...wb.activeSheet.rules[0],range:{r1:10,c1:12,r2:12,c2:12},statisticsRange:'$C$3:$C$7'});
 expect(icons(wb,12,[10,11,12])).toEqual(expected.slice(0,3));
 const back=await native(wb);expect(icons(back,7,[10,11,12])).toEqual(copied);
 expect(icons(back,12,[10,11,12])).toEqual(expected.slice(0,3));
 wb.setInput(id,6,2,'0');back.setInput(back.activeSheetId,6,2,'0');
 expect(icons(back,7,[10,11,12])).toEqual(icons(wb,7,[10,11,12]));
 expect(icons(back,12,[10,11,12])).toEqual(icons(wb,12,[10,11,12]));
});
it('retains highest-bound precedence for unordered stops and precise numeric lower bounds',()=>{
 const unordered=make({iconThreshold0:'999'});expect(icons(unordered)).toEqual(['','','','→','↑']);
 const precise=make({iconThreshold0:'1.0000000000000002'}),id=precise.activeSheetId;
 precise.setInput(id,2,2,'1');precise.setInput(id,3,2,'1.0000000000000002');
 expect(icons(precise).slice(0,2)).toEqual(['','↓']);
});
it('reserves icon priority and honors stopIfTrue below the first boundary',()=>{
 for(const stopIfTrue of [false,true]) {
  const wb=make({iconOnly:true,stopIfTrue}),id=wb.activeSheetId;
  wb.addRule(id,{...wb.activeSheet.rules[0],iconSet:'3Flags',iconOnly:false,iconThreshold0:'-10',stopIfTrue:false});
  wb.addRule(id,{type:'gt',range,value:-2,style:{bg:'#abcdef'},stopIfTrue:false});
  expect(look(wb,2)).toMatchObject({icon:'',iconImage:null,iconOnly:true});
  expect(look(wb,2).bg).toBe(stopIfTrue?undefined:'#abcdef');
 }
});
