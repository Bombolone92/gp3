import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

async function open(condition, quote='"') {
  const encoded=condition.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(quote==='"'?/"/g:/'/g,quote==='"'?'&quot;':'&apos;');
  const xml=`<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet><table:content-validations><table:content-validation table:name="Rule" table:condition=${quote}${encoded}${quote} table:base-cell-address="$Data.$A$1"><table:error-message table:display="true" table:message-type="stop"><text:p>Choose again</text:p></table:error-message></table:content-validation></table:content-validations><table:table table:name="Data"><table:table-column/><table:table-row><table:table-cell table:content-validation-name="Rule"/></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  return workbookFromFile(new TextEncoder().encode(xml),'attributes.fods');
}
it.each(['"',"'"])('reads a greater-than comparison inside a %s-quoted attribute',async quote=>{
  const wb=await open('of:is-true-formula([.A1]>0)',quote),id=wb.activeSheetId;
  expect(wb.validationAt(id,0,0)).toMatchObject({type:'formula',strict:true,message:'Choose again'});
  expect(wb.validateValue(id,0,0,3).ok).toBe(true);expect(wb.validateValue(id,0,0,-1).ok).toBe(false);
});
it.each(['"',"'"])('keeps literal greater-than text inside a %s-quoted list attribute',async quote=>{
  const wb=await open('of:cell-content-is-in-list("A>B";"Second")',quote),id=wb.activeSheetId;
  const rule=wb.validationAt(id,0,0);expect(rule).not.toBeNull();
  expect(wb.listOptionsFor(id,rule)).toEqual(['A>B','Second']);
});
