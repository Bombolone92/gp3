import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { NATIVE_ICON_SETS } from '../src/core/native-icons.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const read = xml => readXlsxConditionalFormats(xml, { dxfs: [] });
const range = {r1:1,c1:0,r2:6,c2:0};
function cf({set='3Stars', attrs='', ruleAttrs='', active='', choices=null, sqref='A2:A7', count=NATIVE_ICON_SETS[set].count}={}) {
  return `<x14:conditionalFormatting><x14:cfRule type="iconSet" priority="2" ${ruleAttrs}>${active ? `<xm:f>${active}</xm:f>` : ''}<x14:iconSet iconSet="${set}" ${attrs} ${choices ? 'custom="1"' : ''}>`+
    Array.from({length:count},(_,i)=>`<x14:cfvo type="percent"><xm:f>${Math.floor(i*100/count)}</xm:f></x14:cfvo>`).join('')+
    (choices||[]).map(([name,id])=>`<x14:cfIcon iconSet="${name}" iconId="${id}"/>`).join('')+`</x14:iconSet></x14:cfRule><xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`;
}
const choices=[['3Arrows',2],['NoIcons',0],['5Boxes',4]];
function make(options) {
  const wb=new Workbook(),id=wb.activeSheetId;
  [0,20,40,60,80,100].forEach((v,i)=>wb.setInput(id,i+1,0,String(v)));
  for(const rule of read(cf(options)))wb.addRule(id,rule);
  return wb;
}
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
async function roundtrip(wb, mutate=x=>x) {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const xml=path=>new TextDecoder().decode(X.CFB.find(zip,path).content);
  for(const path of ['/xl/workbook.xml','/xl/worksheets/sheet1.xml']) {
    const part=X.CFB.find(zip,path);
    part.content=new TextEncoder().encode(path.includes('workbook.xml') ? xml(path).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'') : mutate(xml(path)));
    part.size=part.content.length;
  }
  return {xml:xml('/xl/worksheets/sheet1.xml'),wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'extended.xlsx')};
}
it.each(['3Stars','3Triangles','5Boxes'])('natively exports and reopens %s with live range thresholds',async set=>{
  let wb=make({set}); const expected=[1,2,3,4,5,6].map(r=>look(wb,r).iconImage);
  expect(expected[0]).toBe(NATIVE_ICON_SETS[set].images[0]);expect(expected.at(-1)).toBe(NATIVE_ICON_SETS[set].images.at(-1));
  for(let i=0;i<2;i++) {const result=await roundtrip(wb);wb=result.wb;expect(result.xml).toContain('<x14:iconSet');expect(result.xml).not.toContain('<iconSet');expect([1,2,3,4,5,6].map(r=>look(wb,r).iconImage)).toEqual(expected);}
  wb.setInput(wb.activeSheetId,6,0,'200');expect(look(wb,5).iconImage).not.toBe(expected[4]);
});
it('honors custom icons, ignores reverse for custom rules, and hides NoIcons values independently',async()=>{
  let wb=make({set:'3Arrows',choices,attrs:'reverse="1" showValue="0"'});
  for(let i=0;i<3;i++) {
    expect(look(wb,1)).toMatchObject({iconImage:NATIVE_ICON_SETS['3Arrows'].images[2],iconOnly:true});
    expect(look(wb,3)).toMatchObject({icon:'',iconImage:null,iconOnly:true});
    expect(look(wb,6).iconImage).toBe(NATIVE_ICON_SETS['5Boxes'].images[4]);
    const result=await roundtrip(wb);expect(result.xml).toContain('iconSet="NoIcons" iconId="0"');wb=result.wb;
  }
});
it("uses the base family’s category count, normalizing surplus entries",async()=>{
  const wb=make({set:'3Arrows',count:4,choices:[...choices,['3Stars',1]]});
  expect(wb.activeSheet.rules[0].icon3Set).toBeUndefined();expect(look(wb,6).iconImage).toBe(NATIVE_ICON_SETS['5Boxes'].images[4]);
  const back=(await roundtrip(wb)).wb;expect(back.activeSheet.rules[0].icon3Set).toBeUndefined();expect(look(back,6)).toEqual(look(wb,6));
});
it('keeps a NoIcons category ahead of later icon rules but permits other formatting',()=>{
  const wb=make({choices}),id=wb.activeSheetId;
  wb.addRule(id,{range,type:'icons',set:'arrows',lo:33,hi:67,stopIfTrue:false});
  wb.addRule(id,{range,type:'gt',value:0,style:{bg:'#123456'},stopIfTrue:false});
  expect(look(wb,3)).toMatchObject({icon:'',iconImage:null,bg:'#123456'});
});
it('evaluates live activation predicates at each candidate and respects priority',async()=>{
  const wb=make({active:'B2',ruleAttrs:'activePresent="1"'}),id=wb.activeSheetId;
  [1,0,-2,'=1/0','text',true].forEach((v,i)=>wb.setInput(id,i+1,1,String(v)));
  expect([1,2,3,4,5,6].map(r=>!!look(wb,r)?.icon)).toEqual([true,false,true,false,false,true]);
  wb.setInput(id,2,1,'1');expect(look(wb,2).icon).toBeTruthy();wb.undo();expect(look(wb,2)?.icon).toBeFalsy();
  const back=(await roundtrip(wb)).wb;expect([1,2,3,4,5,6].map(r=>!!look(back,r)?.icon)).toEqual([true,false,true,false,false,true]);
});
it('rebases disjoint activation formulas and copies partial rules relative to their source corner',async()=>{
  const wb=make({active:'B2',sqref:'A6:A7 A2:A4',choices}),id=wb.activeSheetId;
  expect(wb.activeSheet.rules.map(r=>r.iconActiveFormula)).toEqual(['B6','B2']);
  wb.setInput(id,2,1,'1');wb.setInput(id,5,1,'1');
  const rows=[2,3];wb.pasteCells(id,wb.copyCells(id,rows,[0,1]),8,3,{r:2,c:0},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[0,1])});
  expect(look(wb,8,3)?.icon).toBeTruthy();expect(look(wb,9,3)?.icon).toBeFalsy();
  const back=(await roundtrip(wb)).wb;expect(look(back,8,3)).toEqual(look(wb,8,3));expect(look(back,5)).toEqual(look(wb,5));
});
it('follows activation dependencies through cuts, row insertion, deletion and undo',()=>{
  const wb=make({active:'B2'}),id=wb.activeSheetId;
  wb.setInput(id,2,1,'1');const before=wb.toJSON();
  wb.moveRange(id,{r1:2,c1:1,r2:2,c2:1},8,3);
  expect(look(wb,2)?.icon).toBeTruthy();expect(look(wb,1)?.icon).toBeFalsy();
  wb.setInput(id,8,3,'0');expect(look(wb,2)?.icon).toBeFalsy();wb.undo();wb.undo();expect(wb.toJSON()).toEqual(before);
  wb.insertRows(id,2,1);expect(look(wb,3)?.icon).toBeTruthy();expect(look(wb,2)?.icon).toBeFalsy();wb.undo();expect(wb.toJSON()).toEqual(before);
  wb.deleteRows(id,1,1);expect(look(wb,1)?.icon).toBeTruthy();wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('rejects malformed extensions without inventing substitute icons',()=>{
  for(const xml of [cf({choices:choices.slice(1)}),cf({choices:[['NoIcons',1],...choices.slice(1)]}),cf({choices:[['__proto__',0],...choices.slice(1)]}),cf({choices:[['3Stars',3],...choices.slice(1)]}),cf({choices:[['3Stars',''],...choices.slice(1)]}),cf().replace('priority="2"',''),cf().replace('priority="2"','priority="0"'),cf().replace('<xm:f>33</xm:f>','<xm:f>101</xm:f>')]) expect(read(xml)).toEqual([]);
});
it('merges priorities across legacy and extension rules without requiring GUIDs',()=>{
  const legacy='<conditionalFormatting sqref="A2:A7"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>';
  const rules=read(cf()+legacy);expect(rules.map(r=>r.type)).toEqual(['formula','icons']);
});
it('preserves stop-if-true when requested, including native-only exports',async()=>{
  for(const set of ['3Stars','3Arrows']) {
    const wb=make({set,ruleAttrs:'stopIfTrue="1"'});wb.addRule(wb.activeSheetId,{range,type:'formula',value:'TRUE',style:{bg:'#ff0000'},stopIfTrue:false});
    expect(look(wb,2)?.bg).toBeUndefined();const result=await roundtrip(wb);expect(result.xml).toContain('stopIfTrue="1"');expect(look(result.wb,2)?.bg).toBeUndefined();
  }
});
