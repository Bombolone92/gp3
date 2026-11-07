import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {readXlsxConditionalFormats} from '../src/core/xlsx-condformat.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const visibility=value=>value==null?'':` showValue="${value}"`;
const source=(base,extension)=>`<conditionalFormatting sqref="C3:C5"><cfRule type="dataBar" priority="3"><dataBar${visibility(base)}><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FF123456"/></dataBar><extLst><ext><x14:id>{BAR}</x14:id></ext></extLst></cfRule></conditionalFormatting>
<extLst><ext><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{bar}"><x14:dataBar minLength="0" maxLength="100" axisPosition="none"${visibility(extension)}><x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="num"><xm:f>100</xm:f></x14:cfvo></x14:dataBar></x14:cfRule><xm:sqref>C3:C5 E4:E6</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>`;
const read=s=>readXlsxConditionalFormats(s,{});
// Excel 16.113: base hide/extension absent or show both hide; base show/
// extension hide or absent both show. The linked extension never wins here.
it.each([undefined,'0','1','false','true'])('linked base showValue=%s controls every paint region',base=>{
 for(const extension of [undefined,'0','1','false','true']){
  for(const xml of [source(base,extension),source(base,extension).replaceAll('x14:','other:').replaceAll('xm:','excel:')]){
   const rules=read(xml);expect(rules).toHaveLength(2);
   for(const rule of rules){
    expect(rule.barMode).toBe('extended');expect(!!rule.barOnly).toBe(['0','false'].includes(base));
    expect(rule.barMinLength).toBe(0);expect(rule.barMaxLength).toBe(100);
   }
  }
 }
});
it.each([undefined,'0','1','false','true'])('standalone showValue=%s remains authoritative',value=>{
 const xml=source('0',value).replace(/<conditionalFormatting\b[^]*?<\/conditionalFormatting>/,'')
  .replace('id="{bar}"','id="{bar}" priority="2"').replace('</x14:dataBar>','<x14:fillColor rgb="FF123456"/></x14:dataBar>');
 for(const rule of read(xml))expect(!!rule.barOnly).toBe(['0','false'].includes(value));
 expect(read(xml)).toHaveLength(2);
});
it('retains base visibility when an invalid extension falls back to the legacy bar',()=>{
 for(const [base,extension] of [['0','1'],['1','0']]){
  const rules=read(source(base,extension).replace('axisPosition="none"','axisPosition="invalid"'));
  expect(rules).toHaveLength(1);expect(rules[0].barMode).toBe('legacy');
  expect(!!rules[0].barOnly).toBe(base==='0');
 }
});
const make=(base='0',extension)=>{
 const w=new Workbook(),id=w.activeSheetId;
 [0,50,100].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 for(const rule of read(source(base,extension)))w.addRule(id,rule);
 return w;
};
const look=(w,r,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
const zipOf=async w=>X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'});
const edit=(zip,path,fn)=>{const p=X.CFB.find(zip,path);p.content=new TextEncoder().encode(fn(new TextDecoder().decode(p.content)));p.size=p.content.length;};
const open=zip=>workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'linked-bars.xlsx');
it.each([['0','1'],['1','0']])('keeps base=%s/extension=%s visibility through copies, native saves and edits',async(base,extension)=>{
 let w=make(base,extension);
 for(let pass=0;pass<2;pass++){
  const id=w.activeSheetId,rows=[2,3,4];
  w.pasteCells(id,w.copyCells(id,rows,[2]),10,7,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});
  const zip=await zipOf(w);edit(zip,'/xl/workbook.xml',s=>s.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));w=await open(zip);
  for(let i=0;i<3;i++)for(const [r,c]of [[i+2,2],[i+10,7]]){
   expect(!!look(w,r,c).barOnly).toBe(base==='0');expect(look(w,r,c).bar).toBe(i/2);
  }
 }
 w.setInput(w.activeSheetId,11,7,'75');expect(look(w,11,7).bar).toBe(.75);
 expect(!!look(w,11,7).barOnly).toBe(base==='0');w.undo();expect(look(w,11,7).bar).toBe(.5);
});
it('ignores extension-only visibility changes but accepts base edits when private metadata remains',async()=>{
 const w=make('0','0'),zip=await zipOf(w),original=w.activeSheet.rules;
 edit(zip,'/xl/worksheets/sheet1.xml',s=>s.replace(/(<x14:dataBar\b[^>]*?) showValue="0"/g,'$1 showValue="1"'));
 expect((await open(zip)).activeSheet.rules).toEqual(original);
 edit(zip,'/xl/worksheets/sheet1.xml',s=>s.replace(/(<dataBar\b[^>]*?) showValue="0"/g,'$1 showValue="1"'));
 const back=await open(zip);expect(look(back,3).barOnly).toBeUndefined();
 expect(back.activeSheet.rules.some(r=>original.some(o=>o.id===r.id))).toBe(false);
});
