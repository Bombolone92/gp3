import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
test('sequential script input retains complex formatting while batch input follows its own classification',async({page},info)=>{
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  const{CanvasEditor}=await import('/src/engine/canvas-editor.js'),{paragraph}=await import('/src/engine/model.js');
  const p=paragraph('AB');Object.assign(p.runs[0],{cs:true,fontSize:10,fontSizeCs:16});
  const host=document.createElement('div');host.id='context-control';document.body.append(host);
  window.contextErrors=[];window.contextEditor=new CanvasEditor(host,{paragraphs:[p],onError:e=>window.contextErrors.push(String(e))});
  const e=window.contextEditor;e.model.select(1);e.syncInput();e.focus();
 });
 const input=page.locator('#context-control textarea');
 const insert=async text=>input.evaluate((el,data)=>el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data})),text);
 const flags=()=>page.evaluate(()=>window.contextEditor.model.paragraphs[0].runs.flatMap(r=>[...r.text].map(text=>[text,!!r.cs,!!r.rtl])));
 await insert('क');await input.pressSequentially('1 ');await expect(input).toHaveValue('Aक1 B');
 expect(await flags()).toEqual([['A',true,false],['क',true,false],['1',true,false],[' ',true,false],['B',true,false]]);
 const saved=await page.evaluate(async()=>{const{createDocx,DocxPackage}=await import('/src/engine/docx.js');const e=window.contextEditor;const bytes=new Uint8Array(await createDocx(e.model.paragraphs).export().arrayBuffer());const out=await DocxPackage.open(bytes,{bestEffort:true});return{bytes:[...bytes],flags:out.paragraphs[0].runs.flatMap(r=>[...r.text].map(text=>[text,!!r.cs,!!r.rtl])),readOnly:out.readOnly};});
 expect(saved.flags).toEqual(await flags());expect(saved.readOnly).not.toBe(true);writeFileSync(info.outputPath('sequential.docx'),Buffer.from(saved.bytes));
 for(let i=0;i<3;i++)await input.press('Control+z');await expect(input).toHaveValue('AB');
 await insert('क1 ');await expect(input).toHaveValue('Aक1 B');
 expect(await flags()).toEqual([['A',true,false],['क',true,false],['1',false,false],[' ',false,false],['B',true,false]]);
 await input.press('Control+z');await input.press('Control+y');await expect(input).toHaveValue('Aक1 B');
 expect(await page.evaluate(()=>window.contextErrors)).toEqual([]);
 await page.evaluate(()=>{window.contextEditor.destroy();document.getElementById('context-control').remove();});
});
