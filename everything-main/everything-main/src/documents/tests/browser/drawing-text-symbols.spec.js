import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const root='tests/fixtures/drawing-text-symbols/';
test.setTimeout(180000);
test('draws explicit symbols like native-compatible literal glyphs and retains them through a real rich draft',async({page},info)=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async inputs=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');const {CanvasEditor}=await import('/src/engine/canvas-editor.js');const {fontAvailable,checkFontAvailability}=await import('/src/engine/font-availability.js');
  await Promise.all(['Arial','Courier New'].map(checkFontAvailability));
  const images=[],geometry=[];
  for(const bytes of inputs){const {pkg,images:decoded}=await openCanvasDocument(new Uint8Array(bytes));const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images:decoded});
   try{images.push(editor.canvases[0].toDataURL());geometry.push(editor.layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({x:f.x+20,y:l.baseline-f.ascent+15}))));}finally{editor.destroy();host.remove();}}
  return {samePixels:images[0]===images[1],geometry:geometry[0],fonts:{Arial:fontAvailable('Arial'),Courier:fontAvailable('Courier New')}};
 },[...['control.docx','literal.docx'].map(name=>[...readFileSync(root+name)])]);
 expect(result.fonts).toEqual({Arial:true,Courier:true});expect(result.samePixels).toBe(true);writeFileSync(info.outputPath('symbol-comparison.json'),JSON.stringify(result,null,2));
 const previous=await page.getByRole('textbox',{name:'Document text',exact:true}).elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');await expect.poll(()=>previous.evaluate(e=>e.isConnected)).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text',exact:true}),body=await input.inputValue(),canvas=await page.locator('canvas.canvas-page').first().boundingBox();
 await page.mouse.click(canvas.x+result.geometry[0].x,canvas.y+result.geometry[0].y,{button:'right'});await page.getByRole('menuitem',{name:'Edit drawing text',exact:true}).hover();await page.getByRole('menuitem',{name:'Text frame 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit drawing text',exact:true}),draft=dialog.getByRole('textbox',{name:'Drawing text'});
 await draft.evaluate(e=>{e.setSelectionRange(0,10);e.dispatchEvent(new Event('select'));});await page.keyboard.insertText('Updated');
 await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog).toBeHidden();expect(await input.inputValue()).toBe(body);
 const download=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
 const saved=await download('drawing-symbol-edited.docx');
 const symbol=await page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const pkg=await DocxPackage.open(new Uint8Array(bytes)),image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image;return pkg.drawingTextFrames(image)[0].paragraphs[1].runs.find(r=>r.bodySymbol);},[...readFileSync(saved)]);
 expect(symbol.bodySymbol).toEqual({font:'Arial',code:'0061'});expect(symbol.fontAscii).toBe('Courier New');
 await page.screenshot({path:info.outputPath('drawing-symbol-edited.png'),fullPage:true});await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await download('drawing-symbol-undo.docx')))).toEqual(unzipSync(readFileSync(root+'control.docx')));
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
