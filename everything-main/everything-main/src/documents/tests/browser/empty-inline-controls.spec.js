import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test('fills an empty inline control while retaining neighboring empty wrappers',async({page},info)=>{
  test.setTimeout(120000);
  const source='tests/fixtures/empty-inline-controls/control.docx',parts=unzipSync(readFileSync(source)),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  const original='Start suffix\nMiddle prefix  suffix\nEnd prefix\n\nAdjacent  suffix';
  await expect(input).toHaveValue(original);await expect(input).toHaveJSProperty('readOnly',false);
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const at=original.indexOf('Middle prefix ')+'Middle prefix '.length;
  await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},at);
  await page.keyboard.insertText('Entered');
  const edited=original.slice(0,at)+'Entered'+original.slice(at);await expect(input).toHaveValue(edited);
  const editedPath=await save('edited'),out=unzipSync(readFileSync(editedPath));
  for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(data);
  const controls=await page.evaluate(xml=>{const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',d=new DOMParser().parseFromString(xml,'application/xml');return [...d.getElementsByTagNameNS(w,'sdt')].map(c=>({name:c.getElementsByTagNameNS(w,'alias')[0].getAttributeNS(w,'val'),text:[...c.getElementsByTagNameNS(w,'t')].map(t=>t.textContent).join('')}));},strFromU8(out['word/document.xml']));
  expect(controls).toEqual(['start','middle','end','alone','left','right'].map(name=>({name,text:name==='middle'?'Entered':''})));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,editedPath,edited);await expect(input).toHaveJSProperty('readOnly',false);
  expect(errors).toEqual([]);
});

for(const name of ['filled','showing'])test(`restores the declared ${name} glossary at a crossed block boundary`,async({page},info)=>{
  test.setTimeout(120000);
  const source='tests/fixtures/empty-inline-controls/glossary/control.docx';
  const ref=JSON.parse(readFileSync('tests/fixtures/empty-inline-controls/glossary/native-results.json','utf8').replace(/^\uFEFF/,'')).find(r=>r.name===name&&r.replacement==='X');
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Before filled/);
  const original=await input.inputValue();
  await input.evaluate((el,name)=>{const start=el.value.indexOf('Before '+name+'\n')+('Before '+name+'\n').length,end=el.value.indexOf('\nAfter '+name,start);el.focus();el.setSelectionRange(start-1,end);el.dispatchEvent(new Event('select'));},name);
  await page.keyboard.insertText('X');const expected=ref.after.replace(/\r$/,'').replaceAll('\r','\n');
  await expect(input).toHaveValue(expected);
  const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await pending).saveAs(path);return path;};
  const edited=await save('glossary-edited');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('glossary-undo')))).toEqual(unzipSync(readFileSync(source)));
  await reopenDocx(page,input,edited,expected);await expect(input).toHaveJSProperty('readOnly',false);
});
