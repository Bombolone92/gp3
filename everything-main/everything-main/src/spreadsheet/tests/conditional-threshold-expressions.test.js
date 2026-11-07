import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { conditionalFormulaFields, conditionalThresholdFormula, readConditionalThreshold } from '../src/core/conditional-scale.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range = {r1:0,c1:0,r2:4,c2:0};
function setup(kind, type, expression='Limit') {
  const wb = new Workbook({names:[{name:'Limit',ref:'Sheet1!$B$1'}],sheets:[{name:'Sheet1',cells:{'0,1':{v:80},...Object.fromEntries([0,25,50,75,100].map((v,r)=>[`${r},0`,{v}]))}}]});
  const stops = `<cfvo type="num" val="0"/><cfvo type="${type}" val="${expression}"/>`;
  const content = kind==='scale' ? `<colorScale>${stops}<color rgb="FF000000"/><color rgb="FFFFFFFF"/></colorScale>`
    : kind==='icons' ? `<iconSet iconSet="3TrafficLights1">${stops}<cfvo type="num" val="100"/></iconSet>`
    : `<dataBar showValue="0">${stops}<color rgb="FF112233"/></dataBar>`;
  const rule = readXlsxConditionalFormats(`<conditionalFormatting sqref="A1:A5"><cfRule type="${{scale:'colorScale',icons:'iconSet',bar:'dataBar'}[kind]}" priority="1">${content}</cfRule></conditionalFormatting>`,{})[0];
  expect(rule).toBeTruthy();wb.addRule(wb.activeSheetId,rule);return wb;
}
const key = kind=>({scale:'scaleMax',icons:'iconThreshold1',bar:'barMaxFormula'}[kind]);
const paint = (wb,r=2,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const bound = (wb,kind)=>wb.evalRuleFormula(wb.activeSheetId,conditionalThresholdFormula(wb.activeSheet.rules[0],key(kind)),{r1:0,c1:0},0,0,undefined,true);
async function native(wb) {
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
 const part=X.CFB.find(zip,'/xl/workbook.xml');X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
 return {wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'})),xml};
}
it.each(['scale','icons','bar'].flatMap(kind=>['num','percent','percentile'].map(type=>[kind,type])))('retains live %s %s parameter expressions through native cycles',async(kind,type)=>{
 let wb=setup(kind,type);
 for(let cycle=0;cycle<3;cycle++){
  const k=key(kind);expect(wb.activeSheet.rules[0]).toMatchObject({[k]:'Limit',[`${k}Type`]:type});
  expect(conditionalFormulaFields(wb.activeSheet.rules[0])).toContain(k);
  expect(bound(wb,kind)).toBeCloseTo(80);const before=paint(wb);
  wb.setInput(wb.activeSheetId,0,1,'40');expect(bound(wb,kind)).toBeCloseTo(40);expect(paint(wb)).not.toEqual(before);
  wb.undo();expect(paint(wb)).toEqual(before);
  const result=await native(wb);expect(result.xml).toContain(`type="${type}" val="Limit"`);wb=result.wb;
 }
});
it.each(['num','percent','percentile'])('keeps %s expression references through structural edits and sheet copying',async type=>{
 let wb=setup('bar',type,'$B$1+0');
 wb.insertRows(wb.activeSheetId,0,1);
 expect(wb.activeSheet.rules[0].barMaxFormula).toBe('$B$2+0');
 expect(bound(wb,'bar')).toBeCloseTo(80);
 wb=wb.sheetToWorkbook(wb.activeSheetId,{sourceWorkbook:'/Source.xlsx'});
 expect(bound(wb,'bar')).toBeCloseTo(80);
 expect(bound((await native(wb)).wb,'bar')).toBeCloseTo(80);
});
it.each(['percent','percentile'])('uses the copied statistical domain for a dynamic %s parameter', type=>{
 const wb=setup('bar',type),id=wb.activeSheetId;
 wb.pasteCells(id,wb.copyCells(id,[0,1,2],[0]),0,3,{r:0,c:0},null,{conditionalFormats:wb.copyConditionalFormats(id,[0,1,2],[0])});
 // The new domain spans 0..50, so its 80% stop is 40 and the legacy
 // 25-valued bar interpolates from 10% to 90% at 25/40.
 expect(paint(wb,1,3).bar).toBeCloseTo(.1+.8*25/40);
 wb.setInput(id,0,1,'50');expect(paint(wb,1,3).bar).toBeCloseTo(.9);
});
it.each(['percent','percentile'])('does not paint invalid dynamic %s parameter values',type=>{
 const wb=setup('bar',type);
 for(const value of ['-1','101','text','=1/0']){wb.setInput(wb.activeSheetId,0,1,value);expect(paint(wb)?.bar).toBeUndefined();}
});
it('retains valid unresolved names but rejects malformed expression syntax',()=>{
 expect(readConditionalThreshold('scaleMax','num','FutureLimit',[range])).toEqual({scaleMaxType:'num',scaleMax:'FutureLimit'});
 for(const expression of ['SUM(', 'A1+', ''])expect(readConditionalThreshold('scaleMax','num',expression,[range])).toBeNull();
});
it('imports x14 numeric parameter formulas without losing the linked hidden-value setting',async()=>{
 const xml='<conditionalFormatting sqref="A1:A5"><cfRule type="dataBar" priority="1"><dataBar showValue="0"><cfvo type="num" val="0"/><cfvo type="num" val="Limit"/><color rgb="FF112233"/></dataBar><extLst><ext><x14:id>{X}</x14:id></ext></extLst></cfRule></conditionalFormatting><extLst><ext><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{X}"><x14:dataBar minLength="0" maxLength="100" gradient="0"><x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="num"><xm:f>Limit</xm:f></x14:cfvo></x14:dataBar></x14:cfRule><xm:sqref>A1:A5</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>';
 let wb=setup('bar','num');wb.activeSheet.rules=[];for(const rule of readXlsxConditionalFormats(xml,{}))wb.addRule(wb.activeSheetId,rule);
 for(let cycle=0;cycle<2;cycle++){expect(paint(wb)).toMatchObject({bar:.625,barOnly:true,barGradient:false});wb=(await native(wb)).wb;}
});
it.each(['scale','icons','bar'])('keeps an unresolved name in %s without painting a fallback',kind=>{
 const wb=setup(kind,'num','NotDefinedYet');expect(paint(wb)).toBeNull();
});
