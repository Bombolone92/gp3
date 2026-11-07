import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

function xmlFrom(bytes) {
  const zip=X.CFB.read(new Uint8Array(bytes),{type:'array'});
  return new TextDecoder().decode(X.CFB.find(zip,'content.xml').content);
}
async function reopen(wb) {return workbookFromFile(await workbookToOds(wb),'rules.ods');}
const range={r1:0,c1:3,r2:2,c2:3};
it.each([true, false])('retains validation message titles, bodies and visibility=%s in ODS', async enabled => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addValidation(id, { range, type: 'list', source: 'Ready, Done', promptTitle: 'Status & <choice>', prompt: 'Choose a status\nfrom the list.', showInputMessage: enabled, errorTitle: 'Check "status"', message: 'Choose Ready or Done', strict: true });
  const copy = await reopen(wb), rule = copy.validationAt(copy.activeSheetId, 0, 3);
  expect(rule).toMatchObject({ promptTitle: 'Status & <choice>', prompt: 'Choose a status\nfrom the list.', errorTitle: 'Check "status"', message: 'Choose Ready or Done', strict: true });
  expect(rule.showInputMessage !== false).toBe(enabled);
  expect(copy.validateValue(copy.activeSheetId, 0, 3, 'Other').ok).toBe(false);
});
it.each([
  [{type:'list',source:['Red','Green']},'Green','Blue'],
  [{type:'list',source:['Acme, Inc.','Say "yes"','A&B <C>']},'A&B <C>','Bad'],
  [{type:'number',min:2,max:9},5,10],
  [{type:'number',min:2},3,1],
  [{type:'text',min:2,max:4},'abc','a'],
  [{type:'text',max:4},'abc','abcdef'],
  [{type:'date',min:45000,max:46000},45500,47000],
  [{type:'formula',source:'=D1>A1'},10,1],
  [{type:'checkbox'},true,'TRUE'],
])('writes and restores native $0.type validation',async(rule,good,bad)=>{
  const wb=new Workbook(),id=wb.activeSheetId; wb.setInput(id,0,0,'5');
  wb.addValidation(id,{...rule,range,strict:true,allowBlank:false,prompt:'Choose <carefully> & "well"',message:'Try another\nvalue'});
  const blob=await workbookToOds(wb),xml=xmlFrom(await blob.arrayBuffer());
  expect(xml).toContain('<table:content-validations>');
  expect(xml).toContain('table:content-validation-name=');
  const copy=await workbookFromFile(blob,'rules.ods'),out=copy.activeSheetId;
  expect(copy.validateValue(out,0,3,good).ok).toBe(true);
  expect(copy.validateValue(out,0,3,bad).ok).toBe(false);
  expect(copy.validateValue(out,0,3,'').ok).toBe(false);
  expect(copy.validationAt(out,0,3)).toMatchObject({type:rule.type,strict:true,prompt:'Choose <carefully> & "well"',message:'Try another\nvalue'});
  expect(copy.sheets.map(s=>s.name)).toEqual(['Sheet1']);
});
it('preserves named sources and worksheet-qualified references',async()=>{
  const wb=new Workbook({sheets:[{name:"Data & 'Lists' v2"},{name:'Form'}],names:[{name:'Options',ref:"'Data & ''Lists'' v2'!A1:A2"}]});
  const id=wb.sheets[0].id;wb.setInput(id,0,0,'Red');wb.setInput(id,1,0,'Green');
  wb.addValidation(wb.sheets[1].id,{type:'list',source:'=Options',range,strict:false,allowBlank:true});
  const copy=await reopen(wb),sheet=copy.sheets[1];
  expect(copy.listOptionsFor(sheet.id,copy.validationAt(sheet.id,0,3))).toEqual(['Red','Green']);
  expect(copy.validationAt(sheet.id,0,3)).toMatchObject({strict:false,allowBlank:true});
});
it('exports large empty validation areas compactly and imports them sparsely',async()=>{
  const wb=new Workbook(),id=wb.activeSheetId;
  wb.addValidation(id,{type:'list',source:'Yes, No',range:{r1:0,c1:0,r2:1048575,c2:16383},strict:true});
  const blob=await workbookToOds(wb),xml=xmlFrom(await blob.arrayBuffer());
  expect(xml.length).toBeLessThan(20000);
  expect(xml).toContain('table:number-rows-repeated=');
  const copy=await workbookFromFile(blob,'all.ods');
  expect(copy.validationAt(copy.activeSheetId,1048575,16383)).toMatchObject({type:'list'});
  expect(copy.activeSheet.cells.size).toBe(0);
});
it('preserves last-rule precedence and rebases custom formulas when regions split',async()=>{
  const wb=new Workbook(),id=wb.activeSheetId;
  wb.setInput(id,0,0,'2');wb.setInput(id,1,0,'4');wb.setInput(id,2,0,'6');
  wb.addValidation(id,{type:'formula',source:'=D1>A1',range,strict:true});
  wb.addValidation(id,{type:'list',source:'Override',range:{r1:1,c1:3,r2:1,c2:3},strict:false});
  const copy=await reopen(wb),out=copy.activeSheetId;
  expect(copy.validateValue(out,0,3,3).ok).toBe(true);
  expect(copy.validateValue(out,1,3,'Override').ok).toBe(true);
  expect(copy.validateValue(out,2,3,5).ok).toBe(false);
  expect(copy.validateValue(out,2,3,7).ok).toBe(true);
});
it.each([false,true])('imports native repeated empty cells with dense=%s',async(dense)=>{
  const xml=`<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet><table:content-validations><table:content-validation table:name="__proto__" table:condition="of:cell-content-is-in-list(&quot;Yes&quot;;&quot;No&quot;)" table:allow-empty-cell="false" table:base-cell-address="$Data.$C$3"><table:error-message table:display="true" table:message-type="stop"><text:p>Choose one</text:p></table:error-message></table:content-validation></table:content-validations><table:table table:name="Data"><table:table-row table:number-rows-repeated="2"/><table:table-row table:number-rows-repeated="100"><table:table-cell table:number-columns-repeated="2"/><table:table-cell table:number-columns-repeated="3" table:content-validation-name="__proto__"/></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  const raw=X.read(xml,{type:'string',dense});
  expect(raw.Sheets.Data['!validations']).toHaveLength(1);
  const copy=await workbookFromFile(new TextEncoder().encode(xml),'native.fods');
  expect(copy.validationAt(copy.activeSheetId,101,4)).toMatchObject({type:'list',message:'Choose one',allowBlank:false});
  expect(copy.validateValue(copy.activeSheetId,2,2,'Yes').ok).toBe(true);
  expect(copy.validateValue(copy.activeSheetId,2,2,'Other').ok).toBe(false);
  expect(copy.activeSheet.cells.size).toBe(0);
});

it('keeps literal option types and preserves a source range as absolute ODF references',async()=>{
  const wb=new Workbook(),id=wb.activeSheetId;
  const values=[5,'5',true,'TRUE',-2,'A;B'];
  wb.addValidation(id,{type:'list',source:values,range,strict:true});
  wb.addValidation(id,{type:'list',source:'Sheet1!A1:A2',range:{r1:0,c1:5,r2:1,c2:5}});
  const blob=await workbookToOds(wb),xml=xmlFrom(await blob.arrayBuffer());
  expect(xml).toContain('[$Sheet1.$A$1:.$A$2]');
  const copy=await workbookFromFile(blob,'typed.ods');
  expect(copy.listOptionsFor(copy.activeSheetId,copy.validationAt(copy.activeSheetId,0,3),{typed:true})).toEqual(values);
});
