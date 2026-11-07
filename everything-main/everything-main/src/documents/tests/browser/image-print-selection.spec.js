import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {downloadDocx} from './helpers/editor-tools.js';

const controls=[
 ['behind and inline pictures','tests/fixtures/image-interaction/control.docx'],
 ['front/behind cropped pictures','public/fixtures/positioned-picture-crop.docx'],
 ['custom picture paths','public/fixtures/floating-picture-crop.docx'],
];
for(const [name,source] of controls)test(`prints ${name} without image selection tint`,async({page},info)=>{
 test.setTimeout(180000);await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const {decodeImages}=await import('/src/engine/images.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
  const images=await decodeImages(pkg.assets,pkg.styles.fontAlternatives),host=document.createElement('div');document.body.append(host);
  const errors=[],editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  try {
   const positions=[...editor.model.text.matchAll(/\ufffc/g)].map(m=>m.index);
   const baseline=editor.printSheets().map(c=>c.toDataURL()),rows=[];
   for(const at of positions) {
    editor.model.select(0,0);editor.input.blur();editor.paint();const screen=editor.canvases.map(c=>c.toDataURL());
    editor.model.select(at,at+1);editor.focus();const selected=editor.canvases.map(c=>c.toDataURL());
    const before=JSON.stringify(editor.session.capture()),printed=editor.printSheets().map(c=>c.toDataURL());
    rows.push({at,screenChanged:screen.some((png,i)=>png!==selected[i]),printSame:printed.every((png,i)=>png===baseline[i]),stateSame:JSON.stringify(editor.session.capture())===before});
   }
   editor.model.select(0,editor.model.text.length);editor.setZoom(.75);
   const allSelected=editor.printSheets().map(c=>c.toDataURL());
   const exported=new Uint8Array(await editor.export(pkg).arrayBuffer());
   return {rows,allSame:allSelected.every((png,i)=>png===baseline[i]),pages:baseline.length,history:editor.session.history.length,errors,exported:[...exported]};
  } finally {editor.destroy();host.remove();}
 },[...readFileSync(source)]);
 expect(result.rows.length).toBeGreaterThan(0);for(const row of result.rows)expect(row,`image at ${row.at}`).toMatchObject({screenChanged:true,printSame:true,stateSame:true});
 expect(result.allSame).toBe(true);expect(result.history).toBe(0);expect(result.errors).toEqual([]);
 expect(unzipSync(new Uint8Array(result.exported))).toEqual(unzipSync(readFileSync(source)));
 writeFileSync(info.outputPath('selection-noedit.docx'),new Uint8Array(result.exported));
});

test('Ctrl/Cmd+P excludes the selected image overlay and preserves the live selection',async({page},info)=>{
 test.setTimeout(180000);const source='tests/fixtures/image-interaction/control.docx',errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.print=()=>{window.printCalls=(window.printCalls||0)+1;};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Editable text/);
 const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await input.press('ControlOrMeta+p');
 await expect.poll(()=>page.evaluate(()=>window.printCalls)).toBe(1);
 const baseline=await page.locator('.print-stage canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()));expect(baseline.length).toBeGreaterThan(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('.print-stage')).toHaveCount(0);
 await input.focus();const at=original.indexOf('\ufffc');expect(at).toBeGreaterThanOrEqual(0);
 await input.evaluate((el,at)=>{el.setSelectionRange(at,at+1);el.dispatchEvent(new Event('select',{bubbles:true}));},at);
 await expect(page.getByRole('button',{name:'Move selected image',exact:true})).toBeVisible();
 await input.press('ControlOrMeta+p');await expect.poll(()=>page.evaluate(()=>window.printCalls)).toBe(2);
 expect(await page.locator('.print-stage canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).toEqual(baseline);
 await page.pdf({path:info.outputPath('selected-picture.pdf'),preferCSSPageSize:true,printBackground:true});
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('.print-stage')).toHaveCount(0);
 expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([at,at+1]);await expect(input).toHaveValue(original);
 await expect(page.getByRole('button',{name:'Move selected image',exact:true})).toBeVisible();
 const pending=page.waitForEvent('download');await downloadDocx(page);
 const exported=info.outputPath('shortcut-noedit.docx');await(await pending).saveAs(exported);
 expect(unzipSync(readFileSync(exported))).toEqual(unzipSync(readFileSync(source)));expect(errors).toEqual([]);
});
