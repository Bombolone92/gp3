import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { conditionalThresholdFormula, conditionalFormulaFields } from '../src/core/conditional-scale.js';
import { conditionalFormatSignature, reconcileConditionalFormats } from '../src/core/xlsx-condformat-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';
const g=(r1,c1,r2=r1,c2=c1)=>({r1,c1,r2,c2});
const scale=(limits,sqref='A2:A6')=>`<conditionalFormatting sqref="${sqref}"><cfRule type="colorScale" priority="1"><colorScale>${limits.map(([type,val])=>`<cfvo type="${type}"${val==null?'':` val="${val}"`}/>`).join('')}<color rgb="FF000000"/><color rgb="FFFFFFFF"/></colorScale></cfRule></conditionalFormatting>`;
const setup=(limits,sqref)=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 [0,25,50,75,100].forEach((v,i)=>wb.setInput(id,i+1,0,String(v)));
 for(const rule of readXlsxConditionalFormats(scale(limits,sqref),{dxfs:[]}))wb.addRule(id,rule);
 return wb;
};
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const paste=(wb,rows=[2,3,4],c=2,target=null)=>wb.pasteCells(wb.activeSheetId,wb.copyCells(wb.activeSheetId,rows,[0]),rows[0],c,{r:rows[0],c:0},target,{conditionalFormats:wb.copyConditionalFormats(wb.activeSheetId,rows,[0])});
async function roundtrip(wb,privateData=false){
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
 if(!privateData){const p=X.CFB.find(zip,'/xl/workbook.xml');p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;}
 return {xml,wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'thresholds.xlsx')};
}
it.each([
 [['min'],['max']], [['percent',0],['percent',100]], [['percentile',0],['percentile',100]],
].map(limits=>[limits]))('copies native %j thresholds onto the copied statistical domain', async limits=>{
 let wb=setup(limits);
 for(let pass=0;pass<2;pass++){
  paste(wb);expect(look(wb,2,2)?.bg).toBe('#000000');expect(look(wb,4,2)?.bg).toBe('#ffffff');
  const back=await roundtrip(wb);expect(back.xml).toContain(`cfvo type="${limits[0][0]}"`);wb=back.wb;
 }
 const id=wb.activeSheetId;wb.setInput(id,1,0,'-100');expect(look(wb,2,2)?.bg).toBe('#000000');
 wb.setInput(id,2,2,'0');expect(look(wb,3,2)?.bg).toBe('#aaaaaa');
 wb.undo();expect(look(wb,3,2)?.bg).toBe('#7f7f7f');
});
it.each(['num','formula'])('keeps explicit %s bounds fixed while copying',type=>{
 const wb=setup([[type,0],[type,100]]);paste(wb);
 expect([2,3,4].map(r=>look(wb,r,2)?.bg)).toEqual(['#3f3f3f','#7f7f7f','#bfbfbf']);
});
it('retains native types across disjoint scopes, partial replacement, undo and native-only export',async()=>{
 const wb=setup([['percentile',0],['percentile',100]],'A2:A3 A5:A6'),id=wb.activeSheetId;
 wb.setInput(id,3,0,'999');
 wb.pasteCells(id,[[{v:null}]],4,0,null,null,{conditionalFormats:[]});
 expect(look(wb,2)?.bg).toBe('#3f3f3f');expect(look(wb,5)?.bg).toBe('#ffffff');
 const back=await roundtrip(wb);
 expect(back.xml).toContain('sqref="A2:A3 A6:A6"');
 expect((back.xml.match(/<cfRule\b/g)||[])).toHaveLength(1);
 expect(back.xml).toContain('type="percentile" val="100"');
 expect(look(back.wb,2)).toEqual(look(wb,2));
 wb.undo();expect(look(wb,4)?.bg).toBe('#bfbfbf');
});
it('preserves a shared domain across repeated paste and app HTML-compatible scalar settings',async()=>{
 const wb=setup([['min'],['max']]);paste(wb,[2,3,4],2,g(2,2,7,2));
 expect(wb.activeSheet.rules[0]).toMatchObject({scaleMinType:'min',scaleMaxType:'max',range:g(2,2,7,2)});
 const back=await roundtrip(wb,true);expect(back.wb.activeSheet.rules[0].id).toBe(wb.activeSheet.rules[0].id);
 expect(look(back.wb,5,2)?.bg).toBe('#000000');
});
it('tracks structural changes in native scopes without treating percentage values as formulas',()=>{
 const wb=setup([['percent',25],['percentile',75]]),id=wb.activeSheetId;
 expect(conditionalFormulaFields(wb.activeSheet.rules[0])).toEqual(['statisticsRange']);
 wb.insertRows(id,2,2);expect(conditionalThresholdFormula(wb.activeSheet.rules[0],'scaleMax')).toContain('$A$2:$A$8');
 wb.undo();const before=wb.toJSON();wb.updateRule(id,wb.activeSheet.rules[0].id,{scaleMin:'$E$1'});
 expect(wb.activeSheet.rules[0].scaleMinType).toBeUndefined();expect(conditionalFormulaFields(wb.activeSheet.rules[0])).toContain('scaleMin');
 wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('reads version-one fingerprints using their old formula projection, while new fingerprints distinguish native types',async()=>{
 const native=readXlsxConditionalFormats(scale([['min'],['max']]),{dxfs:[]})[0];
 const {scaleMinType,scaleMaxType,statisticsRange,...rest}=native;
 const old={...rest,scaleMin:'AGGREGATE(5,6,$A$2:$A$6)',scaleMax:'AGGREGATE(4,6,$A$2:$A$6)'};
 const signature=await conditionalFormatSignature(old,1),saved=[{...native,id:'retained'}];
 expect(await conditionalFormatSignature(native,1)).toBe(signature);
 expect(await reconcileConditionalFormats(saved,{version:1,entries:[{start:0,end:0,signatures:[signature]}]},[native])).toEqual(saved);
 expect(await conditionalFormatSignature(native)).not.toBe(await conditionalFormatSignature(old));
});
it('does not coalesce disjoint threshold rules across an intervening priority',async()=>{
 const wb=setup([['min'],['max']],'A2:A3 A5:A6'),id=wb.activeSheetId;
 const rule=wb.activeSheet.rules[1];wb.activeSheet.rules.splice(1,0,{id:'middle',type:'formula',range:g(1,0,5,0),value:'FALSE',style:{bold:true},stopIfTrue:true});
 const back=await roundtrip(wb);expect((back.xml.match(/<cfRule\b/g)||[])).toHaveLength(3);
 expect(back.xml).toContain('type="formula" val="_xlfn.AGGREGATE');
 expect(look(back.wb,4)).toEqual(look(wb,4));expect(rule.scaleMinType).toBe('min');
});
it.each(['legacy','extended'])('copies %s bar bounds and retains their native types through a save',async mode=>{
 const limits=mode==='legacy'?'<cfvo type="min"/><cfvo type="max"/>':'';
 const source=mode==='legacy'?`<conditionalFormatting sqref="A2:A6"><cfRule type="dataBar" priority="1"><dataBar>${limits}<color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>`
 : '<extLst><ext><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{TEST}" priority="1"><x14:dataBar minLength="0" maxLength="100"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:fillColor rgb="FF638EC6"/></x14:dataBar></x14:cfRule><xm:sqref>A2:A6</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>';
 let wb=new Workbook();[0,25,50,75,100].forEach((v,r)=>wb.setInput(wb.activeSheetId,r+1,0,String(v)));
 for(const rule of readXlsxConditionalFormats(source,{dxfs:[]}))wb.addRule(wb.activeSheetId,rule);
 paste(wb);expect(look(wb,2,2)?.bar).toBeCloseTo(mode==='legacy'?.1:1/3);
 expect(look(wb,4,2)?.bar).toBeCloseTo(mode==='legacy'?.9:1);
 const back=await roundtrip(wb);expect(back.xml).toContain(`type="${mode==='legacy'?'min':'autoMin'}"`);
 wb=back.wb;expect(look(wb,2,2)?.bar).toBeCloseTo(mode==='legacy'?.1:1/3);
 wb.setInput(wb.activeSheetId,1,0,'-1000');expect(look(wb,2,2)?.bar).toBeCloseTo(mode==='legacy'?.1:1/3);
});
it('rejects malformed percentages and unsupported native stop types',()=>{
 for(const limits of [[['percent',-1],['max']],[['min'],['percentile',101]],[['unknown'],['max']],[['autoMin'],['max']],[['num','SUM('],['max']]])expect(readXlsxConditionalFormats(scale(limits),{dxfs:[]})).toEqual([]);
});

it('updates a native rule’s counting range when its applies-to rectangle is edited',()=>{
 const wb=setup([['min'],['max']]),id=wb.activeSheetId,rule=wb.activeSheet.rules[0];
 wb.updateRule(id,rule.id,{range:g(2,0,4,0)});
 expect(wb.activeSheet.rules[0].statisticsRange).toBe('$A$3:$A$5');
 expect(look(wb,2)?.bg).toBe('#000000');expect(look(wb,4)?.bg).toBe('#ffffff');
 wb.undo();expect(look(wb,2)?.bg).toBe('#3f3f3f');
});
