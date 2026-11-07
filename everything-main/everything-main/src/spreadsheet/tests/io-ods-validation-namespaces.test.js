import { expect, it } from 'vitest';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
const OF='urn:oasis:names:tc:opendocument:xmlns:of:1.2';
const LEGACY='http://openoffice.org/2004/calc';
function rule(name,prefix='fx',attrs='') {
  return `<table:content-validation table:name="${name}" ${attrs} table:condition="${prefix?prefix+':':''}cell-content-is-in-list(&quot;Yes&quot;;&quot;No&quot;)" table:allow-empty-cell="false"><table:error-message table:display="true" table:message-type="stop"/></table:content-validation>`;
}
async function read({root='',container='',definitions=rule('First'),before=''}={}) {
  const xml=`<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ${root} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet>${before}<table:content-validations ${container}>${definitions}</table:content-validations><table:table table:name="Data"><table:table-column table:number-columns-repeated="2"/><table:table-row><table:table-cell table:content-validation-name="First"/><table:table-cell table:content-validation-name="Second"/></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  return workbookFromFile(new TextEncoder().encode(xml),'namespaces.fods');
}
function options(wb,c=0) {const rule=wb.validationAt(wb.activeSheetId,0,c);return rule?wb.listOptionsFor(wb.activeSheetId,rule):null;}
it.each(['fx','Formula','__proto__','form_ula'])('resolves root namespace prefix %s',async prefix=>{
  const wb=await read({root:`xmlns:${prefix}="${OF}"`,definitions:rule('First',prefix)});
  expect(options(wb)).toEqual(['Yes','No']);
  expect(wb.validateInput(wb.activeSheetId,0,0,'Other').ok).toBe(false);
});
it('resolves a declaration on the validation container',async()=>{
  const wb=await read({container:`xmlns:fx="${OF}"`});expect(options(wb)).toEqual(['Yes','No']);
});
it('resolves a declaration on the rule itself',async()=>{
  const wb=await read({definitions:rule('First','fx',`xmlns:fx="${OF}"`)});expect(options(wb)).toEqual(['Yes','No']);
});
it('restores an ancestor binding after a local redefinition ends',async()=>{
  const wb=await read({root:`xmlns:fx="${OF}"`,definitions:rule('First','fx','xmlns:fx="urn:unsupported"')+rule('Second')});
  expect(options(wb)).toBeNull();expect(options(wb,1)).toEqual(['Yes','No']);
});
it('does not apply a rule-local namespace declaration to its sibling',async()=>{
  const wb=await read({definitions:rule('First','fx',`xmlns:fx="${OF}"`)+rule('Second')});
  expect(options(wb)).toEqual(['Yes','No']);expect(options(wb,1)).toBeNull();
});
it('does not assume the conventional of prefix has its usual meaning after rebinding',async()=>{
  const wb=await read({root:`xmlns:of="${OF}"`,definitions:rule('First','of','xmlns:of="urn:unsupported"')+rule('Second','of')});
  expect(options(wb)).toBeNull();expect(options(wb,1)).toEqual(['Yes','No']);
});
it('restores the namespace after an empty preceding element',async()=>{
  const wb=await read({root:`xmlns:fx="${OF}"`,before:'<table:calculation-settings xmlns:fx="urn:unsupported"/>'});
  expect(options(wb)).toEqual(['Yes','No']);
});
it('ignores namespace-looking text in comments and quoted attributes',async()=>{
  const wb=await read({root:`office:version-note="xmlns:fx='${OF}'"`,before:`<!-- <fake xmlns:fx="${OF}"> -->`});
  expect(options(wb)).toBeNull();
});
it('retains the default condition namespace and legacy Calc namespace',async()=>{
  expect(options(await read({definitions:rule('First','')}))).toEqual(['Yes','No']);
  expect(options(await read({root:`xmlns:legacy="${LEGACY}"`,definitions:rule('First','legacy')}))).toEqual(['Yes','No']);
});
it('preserves aliased validation when saving and reopening',async()=>{
  let wb=await read({root:`xmlns:fx="${OF}"`});
  wb=await workbookFromFile(await workbookToOds(wb),'saved.ods');expect(options(wb)).toEqual(['Yes','No']);
});

it('limits a namespace on a self-closing rule to that rule',async()=>{
  const first=`<table:content-validation table:name="First" xmlns:fx="${OF}" table:condition="fx:cell-content-is-in-list(&quot;Yes&quot;;&quot;No&quot;)"/>`;
  const wb=await read({definitions:first+rule('Second')});
  expect(options(wb)).toEqual(['Yes','No']);expect(options(wb,1)).toBeNull();
});
it('decodes character references in namespace URIs',async()=>{
  const wb=await read({root:`xmlns:fx="${OF.replace('1.2','&#49;.2')}"`});
  expect(options(wb)).toEqual(['Yes','No']);
});
it('keeps colons inside unprefixed literal lists as text',async()=>{
  const wb=await read({definitions:'<table:content-validation table:name="First" table:condition="cell-content-is-in-list(&quot;https://example.com&quot;)"/>'});
  expect(options(wb)).toEqual(['https://example.com']);
});
