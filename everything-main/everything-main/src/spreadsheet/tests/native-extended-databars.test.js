import { conditionalThresholdFormula } from '../src/core/conditional-scale.js';
import {expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {dataBar} from '../src/core/condformat.js';
import {readXlsxConditionalFormats} from '../src/core/xlsx-condformat.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const rule={type:'databar',barMode:'extended',barColor:'#638ec6',barMinLength:0,barMaxLength:100};
// Excel 16.113 for Mac, four independent matrices, 2026-09-22. Extended bars
// with signed axes sort reversed bounds; centered axes scale by the larger absolute bound.
it.each([
 ['automatic',-20,-20,40,0,1/3,1/3],['automatic',-10,-20,40,1/6,1/6,1/3],
 ['automatic',0,-20,40,1/3,0,1/3],['automatic',40,-20,40,1/3,2/3,1/3],
 ['middle',-20,-20,40,.25,.25,.5],['middle',40,-20,40,.5,.5,.5],
 ['none',-20,-20,40,0,0,undefined],['none',0,-20,40,0,1/3,undefined],
 ['none',-10,-50,-10,0,1,undefined],['none',0,0,0,0,.5,undefined],
 ['automatic',10,0,50,0,.2,undefined],['automatic',-10,-50,0,.8,.2,undefined],
 ['automatic',10,10,10,0,.5,undefined],['automatic',-10,-10,-10,.5,.5,undefined],
 ['automatic',0,0,0,.5,0,.5],['automatic',-1,0,0,0,.5,.5],
 ['automatic',0,50,50,0,0,undefined],['automatic',50,50,50,0,.5,undefined],
 ['automatic',100,50,50,0,1,undefined],['automatic',50,100,0,0,.5,undefined],
 ['automatic',-50,-100,-10,5/9,4/9,undefined],
 ['middle',0,10,50,.5,.1,.5],['middle',80,10,50,.5,.5,.5],
 ['middle',10,-100,-10,.45,.05,.5],['middle',0,50,50,.5,.5,.5],
 ['automatic',0,-Number.MAX_VALUE,Number.MAX_VALUE,0,0,undefined],
])('%s value %s bounds %s/%s starts %s length %s axis %s',(axis,value,min,max,start,length,position)=>{
 const paint=dataBar({...rule,barAxisPosition:axis},value,min,max);
 expect(paint.barStart).toBeCloseTo(start,12);expect(paint.bar).toBeCloseTo(length,12);
 if(position==null)expect(paint.barAxis).toBeUndefined();else expect(paint.barAxis).toBeCloseTo(position,12);
 expect(paint.barColor).toBe(value<0?'#ff0000':'#638ec6');
});
it.each([
 ['automatic',-20,-20,40,5/12,7/24],['automatic',0,-20,40,5/12,1/8],['automatic',40,-20,40,5/12,11/24],
 ['middle',-20,-20,40,.5,.25],['middle',40,-20,40,.5,.375],
 ['automatic',50,0,50,undefined,.625],['automatic',0,-50,0,.75,.125],
 ['automatic',-50,-50,0,.75,.625],['automatic',30,10,50,undefined,.5],
 ['none',-20,-20,40,undefined,.25],
])('honors custom lengths with %s value %s',(axis,value,min,max,position,length)=>{
 const paint=dataBar({...rule,barAxisPosition:axis,barMinLength:25,barMaxLength:75},value,min,max);
 expect(paint.bar).toBeCloseTo(length,12);
 if(position==null)expect(paint.barAxis).toBeUndefined();else expect(paint.barAxis).toBeCloseTo(position,12);
});
it('mirrors context and explicit directions while keeping fill sign independent of the clipped value',()=>{
 const base=dataBar(rule,-10,-20,40),right=dataBar({...rule,barDirection:'rightToLeft'},-10,-20,40);
 expect(right.barStart).toBeCloseTo(1-base.barStart-base.bar);expect(right.barReverse).toBe(false);
 expect(dataBar(rule,-10,-20,40,true)).toEqual(right);
 expect(dataBar({...rule,barDirection:'leftToRight'},-10,-20,40,true)).toEqual(base);
 expect(dataBar({...rule,barAxisPosition:'middle'},10,-100,-10)).toMatchObject({barColor:'#638ec6',barReverse:true});
});
it('keeps colors safe, respects distinct border flags, and rejects nonnumeric values',()=>{
 const r={...rule,barBorder:true,barNegativeColor:'#ee5555',barBorderColor:'#123456',barNegativeBorderColor:'#880088',barNegativeBorderColorSame:false,barAxisColor:'#00aa00',barGradient:false,barOnly:true};
 expect(dataBar(r,-10,-20,40)).toMatchObject({barColor:'#ee5555',barBorderColor:'#880088',barAxisColor:'#00aa00',barGradient:false,barOnly:true});
 expect(dataBar({...r,barNegativeColorSame:true,barNegativeBorderColorSame:true},-10,-20,40)).toMatchObject({barColor:'#638ec6',barBorderColor:'#123456'});
 expect(dataBar({...r,barNegativeColor:'url(evil)',barNegativeBorderColor:'url(evil)'},-10,-20,40)).toMatchObject({barColor:'#ff0000',barBorderColor:'#ff0000'});
 for(const bad of [null,true,'10',NaN,Infinity,{error:'#N/A'}]){
  expect(dataBar(rule,bad,0,10)).toBeNull();expect(dataBar(rule,5,bad,10)).toBeNull();
 }
});

const xml=(attrs='',limits='<x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/>',ranges='C3:C7')=>`
<conditionalFormatting sqref="C3:C7"><cfRule type="dataBar" priority="2"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext><x14:id>{ABC}</x14:id></ext></extLst></cfRule></conditionalFormatting>
<extLst><ext><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{abc}"><x14:dataBar minLength="0" maxLength="100" ${attrs}>${limits}<x14:negativeFillColor rgb="FFEE5555"/><x14:axisColor rgb="FF00AA00"/></x14:dataBar></x14:cfRule><xm:sqref>${ranges}</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>`;
const read=source=>readXlsxConditionalFormats(source,{});
const make=(source=xml())=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setCells(id,[-20,-10,0,10,40].map((v,r)=>({r:r+2,c:2,cell:{v}})));
 for(const r of read(source))wb.addRule(id,r);
 return wb;
};
const paint=(wb,r)=>wb.conditionalStyle(wb.activeSheetId,r,2,wb.getValue(wb.activeSheetId,r,2));
it('replaces the linked fallback once, accepts namespace aliases and preserves native priority',()=>{
 const source=xml('gradient="0" direction="rightToLeft"').replaceAll('x14:','alternate:').replaceAll('xm:','excel:')+
 '<conditionalFormatting sqref="C3:C7"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>';
 const rules=read(source);expect(rules).toHaveLength(2);expect(rules[0].type).toBe('formula');
 expect(rules[1]).toMatchObject({barMode:'extended',barGradient:false,barDirection:'rightToLeft',barMinFormulaType:'autoMin',barMaxFormulaType:'autoMax',statisticsRange:'$C$3:$C$7'});
});
it('supports standalone extended rules and falls back when the extension is invalid or unlinked',()=>{
 const standalone=xml().replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/,'').replace('id="{abc}"','id="{abc}" priority="3"').replace('<x14:negativeFillColor','<x14:fillColor rgb="FF112233"/><x14:negativeFillColor');
 expect(read(standalone)[0]).toMatchObject({barMode:'extended',barColor:'#112233'});
 expect(read(xml().replace('type="autoMin"','type="num"'))[0]).toMatchObject({barMode:'extended',barMinFormulaType:'num',barMinFormula:'0'});
 for(const source of [xml('axisPosition="bad"'),xml().replace('minLength="0"','minLength="101"'),xml().replace('type="autoMax"','type="unsupported"'),xml().replace('{ABC}','{MISSING}')])expect(read(source)[0].barMode).toBe('legacy');
});
it('shares disjoint statistics, caches them, tracks edits and preserves fixed sources in copies',()=>{
 const wb=make(xml('',undefined,'C3:C4 C6:C7')),id=wb.activeSheetId;
 wb.setInput(id,4,2,'999');const evaluate=vi.spyOn(wb,'evalRuleFormula');
 expect(paint(wb,3).bar).toBeCloseTo(1/6);expect(paint(wb,5).bar).toBeCloseTo(1/6);expect(evaluate).toHaveBeenCalledTimes(4);
 paint(wb,3);expect(evaluate).toHaveBeenCalledTimes(4);
 wb.setInput(id,6,2,'80');expect(paint(wb,3).bar).toBeCloseTo(.1);wb.undo();expect(paint(wb,3).bar).toBeCloseTo(1/6);
 wb.setInput(id,0,0,'Anchor');wb.placeSheetAt(id,wb,id,10,0);
 expect(wb.conditionalStyle(id,13,2,-10).bar).toBeCloseTo(1/6);
 wb.setInput(id,6,2,'80');expect(wb.conditionalStyle(id,13,2,-10).bar).toBeCloseTo(.1);
 wb.insertRows(id,0,1);expect(conditionalThresholdFormula(wb.activeSheet.rules[0],'barMinFormula')).toContain('$C$4:$C$5');wb.undo();
});
it.each([['num','0','num','100',.1],['percent','0','percent','100',1/6],['percentile','25','percentile','75',.5],['formula','$A$1','formula','$A$2',.25]])('evaluates %s/%s and %s/%s bounds',(a,b,c,d,length)=>{
 const wb=make(xml('',`<x14:cfvo type="${a}"><xm:f>${b}</xm:f></x14:cfvo><x14:cfvo type="${c}"><xm:f>${d}</xm:f></x14:cfvo>`));
 wb.setInput(wb.activeSheetId,0,0,'0');wb.setInput(wb.activeSheetId,1,0,'40');expect(paint(wb,5).bar).toBeCloseTo(length);
});
it('round-trips native extended rules, direction, colors and formulas without private metadata',async()=>{
 let wb=make(xml('border="1" gradient="0" showValue="0" negativeBarBorderColorSameAsPositive="0"').replace('<dataBar>', '<dataBar showValue="0">').replace('<x14:axisColor','<x14:borderColor rgb="FF123456"/><x14:negativeBorderColor rgb="FF880088"/><x14:axisColor'));
 wb.activeSheet.rightToLeft=true;
 const original=paint(wb,3);
 for(let pass=0;pass<2;pass++){
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml'),sheet=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
  expect(sheet).toContain('uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"');
  expect(sheet).toContain('rightToLeft="1"');expect(sheet).toContain('minLength="10" maxLength="90"');
  expect(sheet).toContain('<x14:dataBar minLength="0" maxLength="100"');expect(sheet.match(/<x14:cfRule /g)).toHaveLength(1);
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'bars.xlsx');
  expect(wb.activeSheet.rules).toHaveLength(1);expect(wb.activeSheet.rightToLeft).toBe(true);expect(paint(wb,3)).toEqual(original);
 }
 wb.setInput(wb.activeSheetId,6,2,'80');expect(paint(wb,3).bar).toBeCloseTo(.1);wb.undo();expect(paint(wb,3)).toEqual(original);
 const copy=new Workbook();copy.importSheets(wb);expect(copy.sheets.at(-1).rightToLeft).toBe(true);
});

it('uses externally edited native sheet direction even when private metadata remains',async()=>{
 const wb=make();wb.activeSheet.rightToLeft=true;
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const part=X.CFB.find(zip,'/xl/worksheets/sheet1.xml');
 part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace('rightToLeft="1"','rightToLeft="0"'));part.size=part.content.length;
 const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'direction.xlsx');
 expect(back.activeSheet.rightToLeft).toBe(false);expect(paint(back,3).barReverse).toBe(true);
});
