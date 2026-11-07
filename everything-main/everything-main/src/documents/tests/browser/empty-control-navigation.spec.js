import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root='tests/fixtures/empty-control-navigation/';
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
for(const ref of reference.cases)test(`empty control navigation matches the native reference: ${ref.name}`,async({page},info)=>{
  const parts=unzipSync(readFileSync(root+ref.source)),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+ref.source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue('AD');await input.focus();
  for(const key of ref.keys){if(key==='X')await page.keyboard.insertText('X');else await input.press(key==='Home'?'Control+Home':key==='Undo'?'ControlOrMeta+z':'Arrow'+key);}
  await expect(input).toHaveValue(ref.text);
  const png=await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('state.png'),Buffer.from(png.split(',')[1],'base64'));
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const saved=await save('state'),out=unzipSync(readFileSync(saved));
  for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(data);
  const control=await page.evaluate(xml=>{
    const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',d=new DOMParser().parseFromString(xml,'application/xml'),s=d.getElementsByTagNameNS(w,'sdt')[0];
    return {text:[...s.getElementsByTagNameNS(w,'t')].map(t=>t.textContent).join(''),placeholder:!!s.getElementsByTagNameNS(w,'showingPlcHdr').length};
  },strFromU8(out['word/document.xml']));
  expect(control).toEqual({text:ref.controlText,placeholder:ref.placeholder});
  if(ref.name==='exit'){
    await input.focus();await input.press('ControlOrMeta+z');await expect(input).toHaveValue('AD');
    await input.press('ControlOrMeta+y');await expect(input).toHaveValue(ref.text);
  }
  const undos=ref.name==='before'||ref.name==='inside'||ref.name==='undo'?0:ref.keys.includes('X')?2:1;
  await input.focus();for(let i=0;i<undos;i++)await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('AD');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,saved,ref.text);expect(errors).toEqual([]);
});

test('read-only navigation never restores empty control contents',async({page})=>{
  await page.goto('/playground.html');
  await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const p=await DocxPackage.open(new Uint8Array(bytes)),host=document.createElement('div');host.id='readonly-empty';document.body.append(host);
    const e=new CanvasEditor(host,{...p,readOnly:true});window.readonlyEmpty=e;e.focus();
  },[...readFileSync(root+'control.docx')]);
  const input=page.locator('#readonly-empty textarea');await expect(input).toHaveJSProperty('readOnly',true);await input.focus();
  await input.press('Control+Home');for(let i=0;i<4;i++)await input.press('ArrowRight');await expect(input).toHaveValue('AD');
  expect(await page.evaluate(()=>window.readonlyEmpty.session.history.length)).toBe(0);
});
