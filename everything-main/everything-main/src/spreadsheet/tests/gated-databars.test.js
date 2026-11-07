import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {readXlsxConditionalFormats} from '../src/core/xlsx-condformat.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:1,c1:0,r2:6,c2:0};
const xml=({active='B2',sqref='A2:A7',priority='2',attrs='',limits='<x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="num"><xm:f>100</xm:f></x14:cfvo>'}={})=>`<x14:conditionalFormatting><x14:cfRule type="dataBar" priority="${priority}" ${attrs}>${active==null?'':`<xm:f>${active}</xm:f>`}<x14:dataBar minLength="0" maxLength="100" gradient="0" axisPosition="none" negativeBarColorSameAsPositive="1">${limits}<x14:fillColor rgb="FF638EC6"/></x14:dataBar></x14:cfRule><xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`;
const read=s=>readXlsxConditionalFormats(s,{dxfs:[]});
function make(options) {
 const wb=new Workbook(),id=wb.activeSheetId;
 [0,20,40,60,80,100].forEach((v,i)=>{wb.setInput(id,i+1,0,String(v));wb.setInput(id,i+1,1,String(i%2));});
 read(xml(options)).forEach(rule=>wb.addRule(id,rule));return wb;
}
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const bars=(wb,c=0,rows=[1,2,3,4,5,6])=>rows.map(r=>look(wb,r,c)?.bar);
async function back(wb,change=s=>s,strip=true) {
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 let sheetXml;
 for(const path of ['/xl/workbook.xml','/xl/worksheets/sheet1.xml']) {
  const p=X.CFB.find(zip,path);let text=new TextDecoder().decode(p.content);
  if(path.endsWith('workbook.xml')) {if(strip)text=text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'');}
  else sheetXml=text=change(text);
  p.content=new TextEncoder().encode(text);p.size=p.content.length;
 }
 return {xml:sheetXml,wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'gated.xlsx')};
}
it('imports standalone rules without GUIDs and evaluates their predicates per cell',()=>{
 const wb=make();expect(wb.activeSheet.rules).toHaveLength(1);expect(wb.activeSheet.rules[0].barActiveFormula).toBe('B2');
 expect(bars(wb)).toEqual([undefined,.2,undefined,.6,undefined,1]);
 wb.setInput(wb.activeSheetId,1,1,'1');expect(look(wb,1)?.bar).toBe(0);wb.undo();expect(look(wb,1)).toBeNull();
 for(const priority of ['', '0','-1','1.5','bad'])expect(read(xml({priority}))).toEqual([]);
});
it('keeps the predicate distinct from fixed threshold formulas and handles logical results/errors',()=>{
 const wb=make({limits:'<x14:cfvo type="formula"><xm:f>$D$1</xm:f></x14:cfvo><x14:cfvo type="formula"><xm:f>$D$2</xm:f></x14:cfvo>'}),id=wb.activeSheetId;
 wb.setInput(id,0,3,'0');wb.setInput(id,1,3,'200');
 expect(bars(wb)).toEqual([undefined,.1,undefined,.3,undefined,.5]);
 [true,false,-1,'=1/0','text','TRUE'].forEach((v,i)=>wb.setInput(id,i+1,1,String(v)));
 expect(bars(wb)).toEqual([0,undefined,.2,undefined,undefined,.5]);
 wb.setInput(id,1,3,'=1/0');expect(bars(wb)).toEqual(Array(6).fill(undefined));
});
it('preserves blank and false activation separately through native export with no ungated fallback',async()=>{
 for(const active of [null,'FALSE','B2']) {
  let wb=make({active});const expected=bars(wb);
  for(let i=0;i<2;i++){const result=await back(wb);wb=result.wb;expect(bars(wb)).toEqual(expected);
   if(active){expect(result.xml).toContain(`<formula>${active}</formula><dataBar`);expect(result.xml.match(/<formula>/g)).toHaveLength(1);}
   else expect(result.xml).toContain('<cfRule type="dataBar"');
  }
 }
});
it('joins disjoint statistical scopes while rebasing the activation at the bounding corner',async()=>{
 const wb=make({sqref:'A6:A7 A2:A4',limits:'<x14:cfvo type="min"/><x14:cfvo type="max"/>'});
 expect(wb.activeSheet.rules.map(r=>r.barActiveFormula)).toEqual(['B6','B2']);
 const result=await back(wb);expect(result.xml.match(/<x14:cfRule/g)).toHaveLength(1);expect(result.xml).toContain('<formula>B2</formula>');
 expect(bars(result.wb)).toEqual(bars(wb));
});
it('suppresses bar-only hiding when inactive and allows later bars and ordinary styles',()=>{
 const wb=make(),id=wb.activeSheetId;wb.updateRule(id,wb.activeSheet.rules[0].id,{barOnly:true});
 wb.addRule(id,{...wb.activeSheet.rules[0],id:undefined,barActiveFormula:undefined,barOnly:false,barColor:'#ff9900'});
 wb.addRule(id,{range,type:'formula',value:'TRUE',style:{bold:true},stopIfTrue:false});
 expect(look(wb,1)).toMatchObject({barColor:'#ff9900',bold:true});expect(look(wb,1)?.barOnly).toBeUndefined();
 expect(look(wb,2)).toMatchObject({barColor:'#638ec6',barOnly:true,bold:true});
});
it('respects stop-if-true only on active numeric candidates',async()=>{
 const wb=make({attrs:'stopIfTrue="1"'}),id=wb.activeSheetId;wb.addRule(id,{range,type:'formula',value:'TRUE',style:{bold:true},stopIfTrue:false});
 expect(look(wb,1)?.bold).toBe(true);expect(look(wb,2)?.bold).toBeUndefined();
 wb.setInput(id,2,0,'text');expect(look(wb,2)?.bold).toBe(true);
 const result=await back(wb);expect(look(result.wb,1)?.bold).toBe(true);expect(look(result.wb,4)?.bold).toBeUndefined();
});
it('copies partial predicates from their rule corner, follows cut dependencies and updates inserted rows',async()=>{
 const wb=make(),id=wb.activeSheetId,rows=[2,3,4];
 wb.pasteCells(id,wb.copyCells(id,rows,[0,1]),8,3,{r:2,c:0},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[0,1])});
 expect(bars(wb,3,[8,9,10])).toEqual([.2,undefined,.6]);expect(wb.activeSheet.rules[0].barActiveFormula).toBe('E9');
 wb.moveRange(id,{r1:8,c1:4,r2:8,c2:4},0,7);expect(look(wb,8,3)?.bar).toBe(.2);
 wb.setInput(id,0,7,'0');expect(look(wb,8,3)?.bar).toBeUndefined();wb.undo();wb.undo();
 wb.insertRows(id,3,1);expect(look(wb,5)?.bar).toBe(.6);wb.undo();
 const result=await back(wb);expect(bars(result.wb,3,[8,9,10])).toEqual([.2,undefined,.6]);
});
it('lets native activation edits win over unchanged private metadata',async()=>{
 const wb=make();const result=await back(wb,s=>s.replace('<formula>B2</formula>','<formula>FALSE</formula>'),false);
 expect(result.wb.activeSheet.rules[0].barActiveFormula).toBe('FALSE');expect(bars(result.wb)).toEqual(Array(6).fill(undefined));
});
it('does not use a standalone rule as a linked extension when GUIDs happen to match',()=>{
 const standalone=xml({active:'FALSE',attrs:'id="{SAME}"'});
 const legacy='<conditionalFormatting sqref="C2:C7"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF112233"/></dataBar><extLst><ext><x14:id>{SAME}</x14:id></ext></extLst></cfRule></conditionalFormatting>';
 const rules=read(legacy+standalone);expect(rules).toHaveLength(2);expect(rules[0]).toMatchObject({barMode:'legacy',barColor:'#112233'});expect(rules[1].barActiveFormula).toBe('FALSE');
});
it('reads and reexports activation on a legacy bar without changing its geometry',async()=>{
 const source='<conditionalFormatting sqref="A2:A7"><cfRule type="dataBar" priority="1"><formula>B2</formula><dataBar minLength="10" maxLength="90"><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>';
 const wb=make();wb.activeSheet.rules=read(source);
 expect(bars(wb)).toEqual([undefined,.26,undefined,.58,undefined,.9]);
 const result=await back(wb);expect(result.xml).not.toContain('<x14:dataBar');expect(result.xml).toContain('<formula>B2</formula>');expect(bars(result.wb)).toEqual(bars(wb));
});
