import {expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {dataBar} from '../src/core/condformat.js';
import {readXlsxConditionalFormats} from '../src/core/xlsx-condformat.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const rule={type:'databar',barMode:'legacy',barColor:'#638ec6'};
// ISO 29500 length interpolation, with equal and reversed thresholds checked
// against Excel 16.113 for Mac (databar-edge-oracle.xlsx, 2026-09-22).
it.each([
 [0,0,40,.1],[10,0,40,.3],[20,0,40,.5],[40,0,40,.9],
 [-20,-20,40,.1],[0,-20,40,.1+.8/3],
 [10,10,10,.5],[0,0,0,.5],[-10,-10,-10,.5],
 [-10,50,50,.1],[50,50,50,.5],[120,50,50,.9],
 [-10,100,0,.9],[50,100,0,.5],[120,100,0,.1],
 [0,-Number.MAX_VALUE,Number.MAX_VALUE,.5],
])('interpolates value %s between %s and %s to %s',(value,min,max,expected)=>{
 expect(dataBar(rule,value,min,max).bar).toBeCloseTo(expected,12);
 expect(dataBar(rule,value,min,max)).toMatchObject({barGradient:true,barFullHeight:true});
});
it('keeps native percentages, typed eligibility and invalid thresholds distinct from app bars',()=>{
 expect(dataBar({...rule,barMinLength:25,barMaxLength:75},10,0,40).bar).toBe(.375);
 for(const value of ['10',true,null,{error:'#N/A'}])expect(dataBar(rule,value,0,40)).toBeNull();
 for(const max of ['40',true,{error:'#REF!'},NaN,Infinity])expect(dataBar(rule,10,0,max)).toBeNull();
 expect(dataBar({type:'databar',barColor:'#638ec6'},10,10,40)).toEqual({bar:.25,barColor:'#638ec6'});
});
const imported=(limits,sqref='C3:C7',attrs='')=>readXlsxConditionalFormats(`<conditionalFormatting sqref="${sqref}"><cfRule type="dataBar" priority="1"><dataBar ${attrs}>${limits.map(([type,val])=>`<cfvo type="${type}"${val==null?'':` val="${val}"`}/>`).join('')}<color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>`,{});
const make=(limits,sqref,attrs)=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setCells(id,[0,10,20,30,40].map((v,r)=>({r:r+2,c:2,cell:{v}})));
 for(const rule of imported(limits,sqref,attrs))wb.addRule(id,rule);
 return wb;
};
const bars=wb=>[2,3,4,5,6].map(r=>wb.conditionalStyle(wb.activeSheetId,r,2,wb.getValue(wb.activeSheetId,r,2))?.bar);
const close=(actual,expected)=>expected.forEach((value,i)=>expect(actual[i]).toBeCloseTo(value,12));
it.each([
 [[['min'],['max']],[.1,.3,.5,.7,.9]],
 [[['num','0'],['num','100']],[.1,.18,.26,.34,.42]],
 [[['percent','20'],['percent','80']],[.1,1/6,.5,5/6,.9]],
 [[['percentile','25'],['percentile','75']],[.1,.1,.5,.9,.9]],
])('imports live native thresholds %s', (limits,expected)=>close(bars(make(limits)),expected));
it('shares statistics across disjoint areas, caches thresholds and tracks edits and undo',()=>{
 const wb=make([['min'],['max']],'C3:C4 C6:C7');
 wb.setInput(wb.activeSheetId,4,2,'1000');
 const evaluate=vi.spyOn(wb,'evalRuleFormula');
 const visible=[2,3,5,6];
 close(visible.map(r=>wb.conditionalStyle(wb.activeSheetId,r,2,wb.getValue(wb.activeSheetId,r,2)).bar),[.1,.3,.7,.9]);
 expect(evaluate).toHaveBeenCalledTimes(4);
 bars(wb);expect(evaluate).toHaveBeenCalledTimes(4);
 wb.setInput(wb.activeSheetId,6,2,'80');expect(bars(wb)[1]).toBeCloseTo(.2);
 wb.undo();expect(bars(wb)[1]).toBeCloseTo(.3);
});
it('updates fixed formula thresholds on sheet and row edits and preserves them through copies',()=>{
 const wb=make([['formula','$A$1'],['formula','$A$2']]),id=wb.activeSheetId;
 wb.setInput(id,0,0,'0');wb.setInput(id,1,0,'100');close(bars(wb),[.1,.18,.26,.34,.42]);
 wb.insertRows(id,0,2);expect(wb.activeSheet.rules[0].barMaxFormula).toBe('$A$4');wb.undo();
 const other=wb.addSheet('Other');wb.addRule(other.id,{...wb.sheet(id).rules[0],barMaxFormula:'Sheet1!$A$2'});
 wb.renameSheet(id,'Values');expect(wb.sheet(other.id).rules[0].barMaxFormula).toBe('Values!$A$2');
 const target=new Workbook(),copies=target.importSheets(wb);
 expect(target.sheet(copies[1].id).rules[0].barMaxFormula).toContain('Values!');
});
it('rejects malformed thresholds and lengths',()=>{
 for(const attrs of ['minLength="-1"','maxLength="101"','minLength="50.5"','minLength="80" maxLength="20"'])expect(imported([['min'],['max']],undefined,attrs)).toEqual([]);
 for(const limits of [[['num'],['max']],[['percent','101'],['max']],[['formula',''],['max']],[['min']]])expect(imported(limits)).toEqual([]);
});
it('round-trips native bars without private metadata and retains live thresholds and showValue',async()=>{
 let wb=make([['min'],['max']],undefined,'minLength="25" maxLength="75" showValue="0"');
 for(let pass=0;pass<2;pass++){
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml'),xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
  expect(xml).toContain('type="dataBar"');expect(xml).toContain('minLength="25" maxLength="75" showValue="0"');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'bars.xlsx');
  close(bars(wb),[.25,.375,.5,.625,.75]);expect(wb.activeSheet.rules[0].barOnly).toBe(true);
 }
 wb.setInput(wb.activeSheetId,6,2,'80');expect(bars(wb)[1]).toBeCloseTo(.3125);
 wb.undo();expect(bars(wb)[1]).toBeCloseTo(.375);
});

it('preserves fixed statistics on partial copies while tracking subsequent source edits',()=>{
 const wb=make([['min'],['max']]),id=wb.activeSheetId;
 wb.setInput(id,0,0,'Anchor');
 wb.placeSheetAt(id,wb,id,10,0);
 expect(wb.conditionalStyle(id,13,2,10).bar).toBeCloseTo(.3);
 wb.setInput(id,6,2,'80');expect(wb.conditionalStyle(id,13,2,10).bar).toBeCloseTo(.2);
 wb.undo();expect(wb.conditionalStyle(id,13,2,10).bar).toBeCloseTo(.3);
});
it('ignores error-valued thresholds and counts numeric spill results',()=>{
 const wb=make([['min'],['max']]),id=wb.activeSheetId;
 wb.setInput(id,2,2,'=SEQUENCE(5,1,0,10)');
 for(let r=3;r<7;r++)wb.setInput(id,r,2,'');
 close(bars(wb),[.1,.3,.5,.7,.9]);
 wb.updateRule(id,wb.activeSheet.rules[0].id,{barMaxFormula:'NA()'});expect(bars(wb)).toEqual([undefined,undefined,undefined,undefined,undefined]);
});
