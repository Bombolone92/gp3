import { expect, it, vi } from 'vitest';
import native from './fixtures/reference-native-duplicates.json';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { nativeDuplicateFormula, duplicateSourceAreas } from '../src/core/conditional-duplicates.js';
import { parseCellRef } from '../src/core/cell.js';

const paint={bg:'#b6e6ad'};
const look=(wb,r,c)=>!!wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c))?.bg;
const imported=(type,sqref)=>readXlsxConditionalFormats(`<conditionalFormatting sqref="${sqref}"><cfRule type="${type}" dxfId="0" priority="1"/></conditionalFormatting>`,{dxfs:[paint]});
it.each(native.pairs)('matches native duplicate and unique formatting: $label', q=>{
  for(const [column,type] of ['duplicateValues','uniqueValues'].entries()){
    const wb=new Workbook(),id=wb.activeSheetId;
    wb.setCells(id,q.values.map((v,i)=>({r:i+2,c:3,cell:v&&typeof v==='object'?v:{v}})));
    const [rule]=imported(type,'D3:D4');wb.addRule(id,rule);
    for(let i=0;i<2;i++){
      expect(look(wb,i+2,3)).toBe(q.expected[i][column]);
      expect(wb.evalRuleFormula(id,nativeDuplicateFormula(rule),rule.range,i+2,3)).toBe(q.expected[i][column]);
    }
  }
});

it.each(native.unions)('counts every source area with native multiplicity: $label',q=>{
  const wb=new Workbook(),id=wb.activeSheetId;
  wb.setCells(id,q.cells.map(({at,value})=>{const {r,c}=parseCellRef(at);return{r,c,cell:value&&typeof value==='object'?value:{v:value}}}));
  for(const rule of q.rules)for(const importedRule of imported(rule.type,rule.sqref))wb.addRule(id,importedRule);
  for(const cell of q.cells){const {r,c}=parseCellRef(cell.at);expect(look(wb,r,c)).toBe(cell.color[0]===182);}
});

it('keeps app-authored literal, trimmed identities separate from native matching',()=>{
  const wb=new Workbook(),id=wb.activeSheetId,range={r1:0,c1:0,r2:2,c2:0};
  wb.setCells(id,['a',' a ','a*'].map((v,r)=>({r,c:0,cell:{v}})));
  const rule=wb.addRule(id,{type:'dup',range,style:paint});
  expect([0,1,2].map(r=>look(wb,r,0))).toEqual([true,true,false]);
  wb.updateRule(id,rule,{duplicateRange:'$A$1:$A$3'});
  expect([0,1,2].map(r=>look(wb,r,0))).toEqual([false,false,true]);
  wb.undo();expect([0,1,2].map(r=>look(wb,r,0))).toEqual([true,true,false]);
});

it('scans a sparse whole column once, accounts for blanks, and invalidates after edits',()=>{
  const wb=new Workbook(),id=wb.activeSheetId;
  wb.ensureSize(id,10000,1);
  wb.setInput(id,2,0,'=""');wb.setInput(id,3,0,'x');
  const [rule]=imported('duplicateValues','A1:A1048576');wb.addRule(id,rule);
  const scan=vi.spyOn(wb,'_rangeValues');
  expect(look(wb,2,0)).toBe(true);expect(look(wb,3,0)).toBe(false);expect(look(wb,900000,0)).toBe(false);
  expect(scan).toHaveBeenCalledTimes(1);
  wb.setInput(id,9000,0,'x');expect(look(wb,3,0)).toBe(true);expect(look(wb,9000,0)).toBe(true);
  wb.undo();expect(look(wb,3,0)).toBe(false);
});

it('rejects incomplete sources and invalid differential-style references',()=>{
  for(const source of ['','#REF!','(A1:A2,#REF!)','SUM(A1:A2)','A1+A2','Sheet1:Sheet3!A1'])expect(duplicateSourceAreas(source)).toBeNull();
  expect(duplicateSourceAreas('(A1:A2,(C1,C1))')).toHaveLength(3);
  expect(readXlsxConditionalFormats('<conditionalFormatting sqref="A1:A2"><cfRule type="duplicateValues" dxfId="8"/></conditionalFormatting>',{dxfs:[paint]})).toEqual([]);
});
