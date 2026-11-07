import { expect, it } from 'vitest';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

const escape = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
async function read(condition, base=true) {
  const xml=`<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet><table:content-validations><table:content-validation table:name="Rule" table:condition="${escape(condition)}" table:allow-empty-cell="false" ${base?'table:base-cell-address="$Data.$C$3"':''}><table:error-message table:display="true" table:message-type="stop"><text:p>Invalid choice</text:p></table:error-message></table:content-validation></table:content-validations><table:table table:name="Data"><table:table-column table:number-columns-repeated="4"/><table:table-row table:number-rows-repeated="2"/><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/><table:table-cell table:number-columns-repeated="2" table:content-validation-name="Rule"/></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  return workbookFromFile(new TextEncoder().encode(xml),'conditions.fods');
}
const cases=[
  ['of:cell-content-is-whole-number() and cell-content-is-between(1,9)',[1,5,9],[1.5,0,10,'5',true]],
  ['of:cell-content-is-whole-number() and cell-content()>=-3',[-3,0,4],[-4,0.5,'2']],
  ['of:cell-content-is-whole-number() and is-true-formula(MOD([.C3];2)=0)',[2,4],[3,2.5,'2']],
  ['of:cell-content-is-decimal-number() and cell-content()>2',[2.1,3],[2,1,'3']],
  ['of:cell-content-is-decimal-number() and cell-content()<2',[1.9,0],[2,3,'1']],
  ['of:cell-content-is-decimal-number() and cell-content()=2',[2],[1,3,'2']],
  ['of:cell-content-is-decimal-number() and cell-content()!=2',[1,3],[2,'3']],
  ['of:cell-content-is-decimal-number() and cell-content-is-not-between(1,9)',[0,10],[1,5,9,'10']],
  ['of:cell-content-is-time() and cell-content-is-between(0.25,0.75)',[0.25,0.5,0.75],[0,1,'0.5']],
  ['of:cell-content-is-date() and cell-content()>45000',[45001],[45000,'45001']],
  ['of:cell-content-text-length()>2',['abc','😀ab'],['a','ab']],
  ['of:cell-content-text-length()<3',['ab','😀'],['abc']],
  ['of:cell-content-text-length()=2',['ab','😀a'],['a','abc']],
  ['of:cell-content-text-length()!=2',['a','abc'],['ab']],
  ['of:cell-content-text-length-is-not-between(2,4)',['a','abcde'],['ab','abc','abcd']],
  ['of:cell-content()="A, B; C"',['A, B; C'],['Other',42]],
  ['of:cell-content-is-decimal-number() and cell-content-is-between(MAX(1;2),MIN(9;10))',[2,5,9],[1,10]],
  ['of:cell-content-is-decimal-number() and cell-content()>=SUM(1;2)',[3,4],[2]],
];
it.each(cases)('enforces native condition %s',async(condition,good,bad)=>{
  const wb=await read(condition),id=wb.activeSheetId;
  expect(wb.validationAt(id,2,2)).toMatchObject({strict:true,allowBlank:false,message:'Invalid choice'});
  for(const value of good)expect(wb.validateValue(id,2,2,value).ok,`accept ${value}`).toBe(true);
  for(const value of bad)expect(wb.validateValue(id,2,2,value).ok,`reject ${value}`).toBe(false);
});
it('evaluates relative bounds for each validated cell and absolute bounds in place',async()=>{
  const wb=await read('of:cell-content-is-whole-number() and cell-content-is-between([.A3],[.$B$1])'),id=wb.activeSheetId;
  wb.setInput(id,2,0,'2');wb.setInput(id,3,0,'4');wb.setInput(id,0,1,'8');
  expect(wb.validateValue(id,2,2,3).ok).toBe(true);
  expect(wb.validateValue(id,3,2,3).ok).toBe(false);
  expect(wb.validateValue(id,3,2,6).ok).toBe(true);
  wb.setInput(id,0,1,'5');expect(wb.validateValue(id,3,2,6).ok).toBe(false);
  wb.undo();expect(wb.validateValue(id,3,2,6).ok).toBe(true);
});
it('binds predicates without formula references to their assigned cells when no base is stored',async()=>{
  const wb=await read('of:cell-content-is-whole-number() and cell-content()>0',false),id=wb.activeSheetId;
  expect(wb.validateValue(id,2,2,3).ok).toBe(true);expect(wb.validateValue(id,3,3,0.5).ok).toBe(false);
});
it.each([['ods',workbookToOds],['xlsx',workbookToXlsx]])('preserves imported predicates on %s reopening',async(ext,write)=>{
  let wb=await read('of:cell-content-is-whole-number() and cell-content()!=5');
  wb=await workbookFromFile(await write(wb),`rules.${ext}`);
  expect(wb.validateValue(wb.activeSheetId,3,3,4).ok).toBe(true);
  expect(wb.validateValue(wb.activeSheetId,3,3,5).ok).toBe(false);
  expect(wb.validateValue(wb.activeSheetId,3,3,4.5).ok).toBe(false);
});
