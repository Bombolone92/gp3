import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/drawing-text-fields/control.docx';
test.setTimeout(180000);

test('drawing page fields retain native envelopes while neighboring rich text edits, repaints, saves and undoes',async({page},info)=>{
 await page.goto('/playground.html');
 const previous=await page.getByRole('textbox',{name:'Document text',exact:true}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);await expect.poll(()=>previous.evaluate(e=>e.isConnected)).toBe(false);
 const bodyInput=page.getByRole('textbox',{name:'Document text',exact:true}),body=await bodyInput.inputValue();
 const geometry=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return editor.layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({x:f.x+20,y:l.baseline-f.ascent+15})));}
  finally{editor.destroy();host.remove();for(const b of images.values())b.close();}
 },[...readFileSync(source)]);
 const open=async(drawing,frame)=>{
  const b=await page.locator('canvas.canvas-page').first().boundingBox();await page.mouse.click(b.x+geometry[drawing].x,b.y+geometry[drawing].y,{button:'right'});
  await page.getByRole('menuitem',{name:'Edit drawing text',exact:true}).hover();await page.getByRole('menuitem',{name:`Text frame ${frame}`,exact:true}).click();
  return page.getByRole('dialog',{name:'Edit drawing text',exact:true});
 };
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
 for(const[drawing,frame]of [[0,1],[1,1],[1,2]]){
  const dialog=await open(drawing,frame),input=dialog.getByRole('textbox',{name:'Drawing text'}),original=await input.inputValue();
  expect(original).toContain('Before \ufffc after');
  const at=original.indexOf('Before');await input.evaluate((e,at)=>{e.setSelectionRange(at,at+6);e.dispatchEvent(new Event('select'));},at);
  await page.keyboard.insertText('Edited');
  await input.evaluate(e=>{const at=e.value.indexOf('\ufffc');e.setSelectionRange(at,at+1);e.dispatchEvent(new Event('select'));});
  await dialog.getByRole('button',{name:'Bold',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Page-field formatting cannot be changed');
  await expect(input).toHaveValue(original.replace('Before','Edited'));
  await page.screenshot({path:info.outputPath(`field-draft-${drawing}-${frame}.png`),fullPage:true});
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog).toBeHidden();expect(await bodyInput.inputValue()).toBe(body);
 }
 const saved=await save('drawing-fields-edited.docx'),original=unzipSync(readFileSync(source)),parts=unzipSync(readFileSync(saved));
 for(const name of Object.keys(original).filter(n=>n!=='word/document.xml'))expect(parts[name]).toEqual(original[name]);
 const details=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const pkg=await DocxPackage.open(new Uint8Array(bytes));
  return pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).flatMap(r=>pkg.drawingTextFrames(r.image)).map(f=>({reason:f.reason,text:f.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'),fields:f.paragraphs.flatMap(p=>p.runs).filter(r=>r.field).map(r=>r.field)}));
 },[...readFileSync(saved)]);
 expect(details.map(f=>f.reason)).toEqual([null,null,null]);expect(details.map(f=>f.fields.length)).toEqual([1,1,3]);expect(details.every(f=>f.text.includes('Edited \ufffc after'))).toBe(true);
 for(let i=0;i<3;i++)await bodyInput.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('drawing-fields-undo.docx')))).toEqual(original);
 for(let i=0;i<3;i++)await bodyInput.press('ControlOrMeta+Shift+z');expect(unzipSync(readFileSync(await save('drawing-fields-redo.docx')))).toEqual(parts);
 await reopenDocx(page,bodyInput,saved,body);await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
