// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {openConditionalFormatting} from '../src/ui/condformat.js';
import {closeAllModals} from '../src/ui/modal.js';
import {conditionalRuleGroups,splitConditionalRanges} from '../src/core/conditional-groups.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const g=(r1,c1,r2=r1,c2=c1)=>({r1,c1,r2,c2});
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
vi.mock('../src/ui/toast.js',()=>({toast:vi.fn()}));
beforeEach(()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));document.body.innerHTML='<div id="app"></div>';});
afterEach(()=>{closeAllModals();vi.unstubAllGlobals();document.body.replaceChildren();});
function setup(){const wb=new Workbook(),id=wb.activeSheetId;
 for(const [range,value]of[[g(1,0,3),'A2>3'],[g(6,0,8),'A7>3']])wb.addRule(id,{type:'formula',range,value,style:{bg:'#ff0000'},stopIfTrue:false});
 return {wb,id};}
function open(wb){const {panel}=openConditionalFormatting({wb,sheetId:()=>wb.activeSheetId,range:()=>g(0,0),grid:{focus(){}}});
 return {panel,field:name=>panel.querySelector(`[aria-label="${name}"]`),submit:()=>panel.querySelector('form').requestSubmit()};}
it('groups rebased imported predicates and preserves an untouched save',()=>{
 const {wb}=setup(),before=wb.toJSON(),version=wb.version,{panel,field,submit}=open(wb);
 expect(panel.querySelectorAll('.names-main')).toHaveLength(1);panel.querySelector('.names-main').click();
 expect(field('Apply to range').value).toBe('A2:A4, A7:A9');expect(field('Value').value).toBe('=A2>3');submit();
 expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
});
it('edits every area with correctly rebased predicates and a single undo step',()=>{
 const {wb,id}=setup(),before=wb.toJSON(),{panel,field,submit}=open(wb);wb.clearHistory();panel.querySelector('.names-main').click();
 field('Apply to range').value='C3:C5,E8:E10';field('Value').value='=C3>7';submit();
 expect(wb.activeSheet.rules.map(rule=>rule.value)).toEqual(['=C3>7','=E8>7']);
 wb.setInput(id,8,4,'9');expect(look(wb,8,4)).toEqual({bg:'#ff0000'});wb.undo();
 expect(wb.undoLabels()).toEqual(['Edit rule']);wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('moves and deletes an entire rule group without crossing an intervening priority',()=>{
 const {wb,id}=setup();wb.addRule(id,{type:'gt',range:g(0,0,10),value:0,style:{bold:true}});
 const {panel}=open(wb),before=wb.toJSON();panel.querySelector('[data-action="down"]').click();
 expect(wb.activeSheet.rules.map(rule=>rule.type)).toEqual(['gt','formula','formula']);
 expect(document.activeElement.getAttribute('aria-label')).toBe('Move the rule for A2:A4, A7:A9 up');
 panel.querySelectorAll('[data-action="delete"]')[1].click();expect(wb.activeSheet.rules).toHaveLength(1);
 expect(document.activeElement.getAttribute('aria-label')).toBe('Delete rule for A1:A11');
 wb.undo();wb.undo();expect(wb.toJSON()).toEqual(before);
 wb.moveRule(id,wb.activeSheet.rules.at(-1).id,-1);expect(conditionalRuleGroups(wb.activeSheet.rules)).toHaveLength(3);
});
it('keeps separate statistical domains separate and updates shared domains on range edits',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 for(const range of [g(0,0,2),g(5,0,7)])wb.addRule(id,{type:'scale',range,from:'#000000',to:'#ffffff'});
 expect(conditionalRuleGroups(wb.activeSheet.rules)).toHaveLength(2);
 wb.activeSheet.rules=[];wb.setRuleAreas(id,null,{type:'scale',from:'#000000',to:'#ffffff',scaleMinType:'min',scaleMaxType:'max'},[g(0,0,2),g(5,0,7)]);
 expect(conditionalRuleGroups(wb.activeSheet.rules)).toHaveLength(1);
 wb.setInput(id,0,0,'0');wb.setInput(id,5,0,'100');wb.setInput(id,2,2,'50');wb.setInput(id,8,4,'200');
 wb.setRuleAreas(id,wb.activeSheet.rules[0].id,{},[g(2,2),g(8,4)]);
 expect(look(wb,2,2)?.bg).toBe('#000000');expect(look(wb,8,4)?.bg).toBe('#ffffff');
 expect(wb.activeSheet.rules.every(rule=>rule.statisticsRange==='($C$3:$C$3,$E$9:$E$9)')).toBe(true);
});
it('updates native duplicate domains but retains explicitly different count ranges',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.addRule(id,{type:'dup',range:g(0,0,2),duplicateRange:'$A$1:$A$3',style:{bold:true}});
 wb.setRuleAreas(id,wb.activeSheet.rules[0].id,{},[g(0,2,2,2),g(4,2)]);
 expect(wb.activeSheet.rules.every(rule=>rule.duplicateRange==='($C$1:$C$3,$C$5:$C$5)')).toBe(true);
 wb.setRuleAreas(id,wb.activeSheet.rules[0].id,{duplicateRange:'$H$1:$H$9'},[g(0,4,2,4)]);
 expect(wb.activeSheet.rules[0].duplicateRange).toBe('$H$1:$H$9');
});
it('rejects malformed and foreign apply-to areas atomically with an accessible error',()=>{
 const {wb}=setup();wb.addSheet('Other');wb.activeSheetId=wb.sheets[0].id;
 const {panel,field,submit}=open(wb);panel.querySelector('.names-main').click();const before=wb.toJSON();
 for(const text of ['A1:A3,','A1:A3,garbage','Other!A1:A3','(A1:A3,,C1:C3)']){
  field('Apply to range').value=text;submit();expect(wb.toJSON()).toEqual(before);expect(field('Apply to range').getAttribute('aria-invalid')).toBe('true');
 }
});
it('accepts quoted sheet commas and structured column commas without splitting them',()=>{
 expect(splitConditionalRanges("('A,B'!A1:A3,Sales[Cost, USD])")).toEqual(["'A,B'!A1:A3",'Sales[Cost, USD]']);
 expect(splitConditionalRanges("'O''Brien'!A1,B2")).toEqual(["'O''Brien'!A1",'B2']);
 expect(splitConditionalRanges('A1,[bad')).toBeNull();
});
it('removes overlapping coverage while preserving relative formula anchors',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;wb.setRuleAreas(id,null,{type:'formula',value:'A1>0',style:{bold:true}},[g(0,0,2,2),g(1,1,3,3)]);
 for(let r=0;r<4;r++)for(let c=0;c<4;c++)expect(wb.activeSheet.rules.filter(x=>r>=x.range.r1&&r<=x.range.r2&&c>=x.range.c1&&c<=x.range.c2).length).toBe((r<3&&c<3||r>0&&c>0)?1:0);
 wb.setInput(id,3,3,'1');expect(look(wb,3,3)).toEqual({bold:true});
});
it('refuses group edits, deletes and reorders on protected sheets',()=>{
 const {wb,id}=setup();wb.addRule(id,{type:'gt',range:g(0,2),value:0});wb.setSheetProtected(id,true);const before=wb.toJSON();
 expect(wb.setRuleAreas(id,wb.activeSheet.rules[0].id,{value:'FALSE'},[g(0,0)])).toBe(false);
 expect(wb.deleteRuleGroup(id,wb.activeSheet.rules[0].id)).toBe(false);expect(wb.moveRuleGroup(id,wb.activeSheet.rules[0].id,1)).toBe(false);expect(wb.toJSON()).toEqual(before);
});
it.each([false,true])('exports a single native applies-to union and reopens edited rules (private=%s)',async privateData=>{
 const {wb,id}=setup();wb.setInput(id,1,0,'5');wb.setInput(id,6,0,'2');
 const zip=X.CFB.read(new Uint8Array(await new Promise(async(resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(await workbookToXlsx(wb));})),{type:'array'}),part=X.CFB.find(zip,'/xl/worksheets/sheet1.xml');
 const xml=new TextDecoder().decode(part.content);expect(xml).toContain('sqref="A2:A4 A7:A9"');expect(xml.match(/<cfRule /g)).toHaveLength(1);
 if(!privateData){const book=X.CFB.find(zip,'/xl/workbook.xml');book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;}
 const reopened=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'groups.xlsx');
 expect(conditionalRuleGroups(reopened.activeSheet.rules)).toHaveLength(1);expect(look(reopened,1)?.bg).toBe('#ff0000');expect(look(reopened,6)).toBeNull();
 reopened.setInput(reopened.activeSheetId,6,0,'9');expect(look(reopened,6)?.bg).toBe('#ff0000');
});
it('retains table escape characters while splitting area lists',()=>{
 expect(splitConditionalRanges("Sales[Cost'] USD],A1:A4")).toEqual(["Sales[Cost'] USD]",'A1:A4']);
 expect(splitConditionalRanges("Sales[Literal'[bracket],A1")).toEqual(["Sales[Literal'[bracket]",'A1']);
});
it('keeps an existing repeated statistical scope intact on an untouched save',()=>{
 const wb=new Workbook(),id=wb.activeSheetId,range=g(0,0,2);
 for(let i=0;i<2;i++)wb.addRule(id,{type:'dup',range,duplicateRange:'($A$1:$A$3,$A$1:$A$3)',style:{bold:true}});
 const before=wb.toJSON(),version=wb.version;wb.setRuleAreas(id,wb.activeSheet.rules[0].id,{},[range,range]);
 expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
});
it.each([['C4>3','A2>3'],['A1>3','#REF!>3']])('rebases a native union at its bounding corner without losing %s',async(first,second)=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.addRule(id,{type:'formula',range:g(3,2,5,2),value:first,style:{bold:true}});
 wb.addRule(id,{type:'formula',range:g(1,0,2,0),value:second,style:{bold:true}});
 wb.setInput(id,0,0,'5');wb.setInput(id,3,2,'5');
 const blob=await workbookToXlsx(wb),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
 const zip=X.CFB.read(new Uint8Array(data),{type:'array'}),part=X.CFB.find(zip,'/xl/worksheets/sheet1.xml'),xml=new TextDecoder().decode(part.content);
 expect(xml.match(/<cfRule /g)).toHaveLength(first==='A1>3'?2:1);
 const book=X.CFB.find(zip,'/xl/workbook.xml');book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
 const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'union.xlsx');expect(look(back,3,2)).toEqual({bold:true});expect(look(back,1)).toBeNull();
});
