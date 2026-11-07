import { JSDOM } from 'jsdom';
const { DOMParser, XMLSerializer } = new JSDOM('').window;
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range = { r1: 1, c1: 0, r2: 3, c2: 0 };
function setup(rule) {
  return new Workbook({ sheets: [{ name: 'Data', cells: { '0,1': { v: 2 }, '1,1': { v: 4 }, '2,1': { v: 6 }, '3,1': { v: 8 } }, validations: [{ range, strict: true, ...rule }] }] });
}
const xmlDoc = text => new DOMParser().parseFromString(text, 'application/xml');
async function saved(wb) {
  const blob = await workbookToXlsx(wb), bytes = new Uint8Array(await blob.arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const xml = new TextDecoder().decode(entry.content), doc = xmlDoc(xml);
  expect(doc.querySelector('parsererror')).toBeNull();
  return { bytes, zip, doc, xml };
}
async function native(wb) {
  const result = await saved(wb), book = X.read(result.bytes, { type: 'array' });
  for (const [index, name] of book.SheetNames.entries()) {
    if (!/^_puter_meta\d*$/.test(name)) continue;
    const entry = X.CFB.find(result.zip, `/xl/worksheets/sheet${index+1}.xml`);
    const doc = xmlDoc(new TextDecoder().decode(entry.content));
    for (const cell of doc.querySelectorAll('c')) if (/^A\d+$/.test(cell.getAttribute('r'))) cell.remove();
    entry.content = new TextEncoder().encode(new XMLSerializer().serializeToString(doc)); entry.size = entry.content.length;
  }
  return workbookFromFile(X.CFB.write(result.zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}
it.each([
  [{ type: 'number', min: 2, max: 6 }, 4, 9],
  [{ type: 'number', min: 2 }, 4, 1], [{ type: 'number', max: 6 }, 4, 9],
  [{ type: 'number' }, 4, 'abc'], [{ type: 'date', min: 40000, max: 50000 }, 45000, 50001],
  [{ type: 'date' }, 45000, -1], [{ type: 'text', min: 2, max: 4 }, 'abc', 'abcde'],
  [{ type: 'checkbox' }, true, 'TRUE'], [{ type: 'formula', source: '  =A2>B2' }, 5, 3],
])('exports native %j validation with live rejection', async (rule, good, bad) => {
  const wb = setup(rule), {doc} = await saved(wb);
  expect(doc.querySelector('dataValidations dataValidation')).not.toBeNull();
  const copy = await native(wb), id = copy.sheets[0].id;
  expect(copy.validateValue(id, 1, 0, good).ok).toBe(true);
  expect(copy.validateValue(id, 1, 0, bad).ok).toBe(false);
});
it.each([['Red','Blue'], ['Comma, inside', 'A "quote"', 'Line\nbreak', '_x0041_ & 😀'], Array.from({length:70},(_,i)=>`Option ${i}`), [2, true, '03']])('exports exact dropdown values %j', async (...source) => {
  const wb = setup({ type: 'list', source });
  const copy = await native(wb), id = copy.sheets[0].id, rule = copy.validationAt(id, 1, 0);
  expect(rule).not.toBeNull();
  expect(copy.listOptionsFor(id, rule, {typed: true})).toEqual(source);
  expect(copy.validateValue(id, 1, 0, 'Missing').ok).toBe(false);
});
it.each([false,true])('retains fixed or relative range sources (relative=%s)', async relativeSource => {
  const copy = await native(setup({ type:'list', source:'=B1:B2', relativeSource })), id = copy.sheets[0].id;
  expect(copy.validateValue(id, 2, 0, relativeSource ? 6 : 2).ok).toBe(true);
  expect(copy.validateValue(id, 2, 0, relativeSource ? 2 : 6).ok).toBe(false);
});
it('exports error and prompt strings as safe Xstrings', async () => {
  const wb = setup({ type:'number', min:2, allowBlank:false, strict:false, message:'Bad <tag> & _x0041_\n😀', prompt:'Pick "one"\t_x0042_' });
  const {doc} = await saved(wb), node = doc.querySelector('dataValidation');
  expect(node).not.toBeNull(); expect(node.getAttribute('errorStyle')).toBe('warning');
  const copy = await native(wb), v = copy.validationAt(copy.sheets[0].id,1,0);
  expect(v).toMatchObject({allowBlank:false,strict:false,message:wb.activeSheet.validations[0].message,prompt:wb.activeSheet.validations[0].prompt});
});
it('exports disjoint regions with last-rule precedence and rebased custom formulas', async () => {
  const wb = setup({type:'formula',source:'A2>B2'});
  wb.addValidation(wb.activeSheetId, {type:'number',max:0,range:{r1:2,c1:0,r2:2,c2:0}});
  const copy = await native(wb), id=copy.sheets[0].id;
  expect(copy.validateValue(id,1,0,3).ok).toBe(false);
  expect(copy.validateValue(id,2,0,-1).ok).toBe(true);
  expect(copy.validateValue(id,2,0,7).ok).toBe(false);
  expect(copy.validateValue(id,3,0,7).ok).toBe(false);
  expect(copy.validateValue(id,3,0,9).ok).toBe(true);
  const {doc}=await saved(wb); expect(doc.querySelectorAll('dataValidation')).toHaveLength(3);
});
it('keeps empty sheets with large rule ranges compact', async () => {
  const wb=new Workbook({sheets:[{name:'Data',validations:[{type:'number',min:0,range:{r1:0,c1:0,r2:19999,c2:701}}]}]});
  const {xml,doc}=await saved(wb); expect(doc.querySelector('dataValidation')?.getAttribute('sqref')).toBe('A1:ZZ20000');
  expect(doc.querySelectorAll('sheetData c')).toHaveLength(0); expect(xml.length).toBeLessThan(3000);
});
it('preserves the workbook and hides helper data after repeated app reopening', async () => {
  let wb=setup({type:'list',source:['A,B','😀'.repeat(140)]});
  const before=wb.toJSON(); await saved(wb); expect(wb.toJSON()).toEqual(before);
  for(let i=0;i<2;i++) wb=await workbookFromFile(await workbookToXlsx(wb),'saved.xlsx');
  expect(wb.sheets).toHaveLength(1); expect(wb.names).toEqual([]);
  expect(wb.activeSheet.validations[0].source).toEqual(['A,B','😀'.repeat(140)]);
  expect((await saved(wb)).doc.querySelector('dataValidation')).not.toBeNull();
});
it('avoids user names and sidecar names, and reuses identical literal lists', async () => {
  const wb=setup({type:'list',source:['A,B','C']});
  wb.addSheet('_puter_meta'); wb.defineName('_puter_validation_1', '99');
  wb.addValidation(wb.sheets[0].id,{type:'list',source:['A,B','C'],range:{r1:1,c1:2,r2:2,c2:2}});
  const {bytes,doc}=await saved(wb), book=X.read(bytes,{type:'array'});
  const values=[...doc.querySelectorAll('dataValidation formula1')].map(n=>n.textContent);
  expect(values[0]).toBe(values[1]); expect(values[0]).not.toBe('_puter_validation_1');
  expect(book.SheetNames).toEqual(['Data','_puter_meta','_puter_meta2']);
  const copy=await workbookFromFile(bytes,'saved.xlsx');
  expect(copy.sheets.map(s=>s.name)).toEqual(['Data','_puter_meta']);
  expect(copy.names.map(n=>n.name)).toEqual(['_puter_validation_1']);
});
it('keeps numeric text acceptance and rejects logical values for number rules', async () => {
  const copy=await native(setup({type:'number',min:2,max:6})), id=copy.sheets[0].id;
  expect(copy.validateValue(id,1,0,'4').ok).toBe(true);
  expect(copy.validateValue(id,1,0,'8').ok).toBe(false);
  expect(copy.validateValue(id,1,0,true).ok).toBe(false);
});
it('preserves quoted custom formula text and prefixes modern calls', async () => {
  const wb=setup({type:'formula',source:'A2=CONCAT("_x0041_", " & <tag>")'});
  const {doc}=await saved(wb);
  expect(doc.querySelector('formula1').textContent).toBe('A2=_xlfn.CONCAT("_x0041_", " & <tag>")');
  const copy=await native(wb),id=copy.sheets[0].id;
  expect(copy.validateValue(id,1,0,'_x0041_ & <tag>').ok).toBe(true);
  expect(copy.validateValue(id,1,0,'Other').ok).toBe(false);
});
it('retains empty-list rejection and permits allowed blanks', async () => {
  const copy=await native(setup({type:'list',source:[]})),id=copy.sheets[0].id;
  expect(copy.validateValue(id,1,0,'Any').ok).toBe(false);
  expect(copy.validateValue(id,1,0,'').ok).toBe(true);
});
it('exports a live cross-sheet dropdown using a defined name', async () => {
  const wb=setup({type:'list',source:"'Other Data'!B1:B2"});
  const sheet=wb.addSheet('Other Data'); wb.setInput(sheet.id,0,1,'Red');wb.setInput(sheet.id,1,1,'Blue');
  const {doc,bytes}=await saved(wb), formula=doc.querySelector('formula1').textContent;
  expect(formula).not.toContain('!');
  expect(X.read(bytes,{type:'array'}).Workbook.Names.some(n=>n.Name===formula && n.Ref.includes("'Other Data'!$B$1:$B$2"))).toBe(true);
  const copy=await native(wb), id=copy.sheets[0].id;
  expect(copy.validateValue(id,2,0,'Red').ok).toBe(true);
  const other=copy.sheetByName('Other Data');copy.setInput(other.id,0,1,'Green');
  expect(copy.validateValue(id,2,0,'Red').ok).toBe(false);
  expect(copy.validateValue(id,2,0,'Green').ok).toBe(true);
});
it('ignores malformed helper-name metadata while preserving user definitions', async () => {
  const wb=setup({type:'list',source:['A,B','C']}); wb.defineName('Limit','5');
  const {bytes}=await saved(wb), book=X.read(bytes,{type:'array'}), cell=book.Sheets._puter_meta.A1;
  const meta=JSON.parse(cell.v); meta.validationNames=[null,42,{},...(meta.validationNames||[])];cell.v=JSON.stringify(meta);
  const copy=await workbookFromFile(X.write(book,{type:'array',bookType:'xlsx'}),'edited.xlsx');
  expect(copy.names.map(n=>n.name)).toEqual(['Limit']);
  expect(copy.activeSheet.validations[0].source).toEqual(['A,B','C']);
});
it('exports pasted validation and destination fragments as live native rules', async () => {
  const wb=setup({type:'formula',source:'A2>B2'}),id=wb.activeSheetId;
  wb.addValidation(id,{type:'formula',source:'D1<100',range:{r1:0,c1:3,r2:9,c2:3},strict:true});
  wb.pasteCells(id,wb.copyCells(id,[2,3],[0]),4,3,null,null,{validations:wb.copyValidations(id,[2,3],[0])});
  const back=await native(wb),sheet=back.sheets[0];
  expect(back.validationAt(sheet.id,4,3).source).toBe('=D5>E5');
  expect(back.validationAt(sheet.id,6,3).source).toBe('=D7<100');
  expect(back.validateValue(sheet.id,4,3,5).ok).toBe(true);
  expect(back.validateValue(sheet.id,4,3,-1).ok).toBe(false);
  expect(back.validateValue(sheet.id,6,3,101).ok).toBe(false);
});
