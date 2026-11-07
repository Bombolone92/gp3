import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const source='public/fixtures/local-font-face.docx',bytes=readFileSync(source);
test('the document toolbar refreshes existing pages after font access',async({page,context},info)=>{
 test.setTimeout(120000);await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^LOCAL FACE HEADING/);
 const pixels=()=>page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()));
 const before=await pixels();await context.grantPermissions(['local-fonts']);
 await page.getByRole('button',{name:'Latin font family',exact:true}).click();
 await page.getByRole('button',{name:'Browse installed fonts',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'installed font families available'})).toBeVisible();
 expect(await pixels()).not.toEqual(before);
 await page.keyboard.press('Escape');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const path=info.outputPath('toolbar-noedit.docx');await(await download).saveAs(path);expect(unzipSync(readFileSync(path))).toEqual(unzipSync(bytes));
});

test('browsing installed fonts refreshes the current editor without an edit',async({page,context},info)=>{
 test.setTimeout(120000);await page.goto('/playground.html');
 await page.evaluate(async data=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {openFontPicker}=await import('/src/views/font-picker.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(data));
  const host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images});editor.setZoom(1.25);
  editor.model.select(0,0);editor.execute(()=>editor.model.replace('Edit '));editor.model.select(2,4);editor.syncInput();editor.paint();
  const state=()=>JSON.stringify({snapshot:editor.model.snapshot(),history:editor.model.history,future:editor.model.future,revision:editor.model.revision,zoom:editor.zoom});
  const pixels=()=>editor.canvases.map(c=>c.toDataURL());
  const anchor=document.createElement('button');anchor.textContent='Test fonts';document.body.append(anchor);
  window.fontRefreshTest={editor,pkg,state,pixels,before:state(),beforePixels:pixels()};
  openFontPicker({anchor,value:'Franklin Gothic Demi',apply:()=>{throw Error('Unexpected formatting edit');},onFontsAvailable:()=>editor.refreshFonts()});
 },[...bytes]);
 await context.grantPermissions(['local-fonts']);
 await page.getByRole('button',{name:'Browse installed fonts',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'installed font families available'})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const t=window.fontRefreshTest,e=t.editor;
  const before=JSON.parse(t.before),after=JSON.parse(t.state()),changed=JSON.stringify(t.pixels())!==JSON.stringify(t.beforePixels);
  const refreshed=t.pixels();await e.refreshFonts();const stable=JSON.stringify(refreshed)===JSON.stringify(t.pixels());
  const exportBytes=async()=>[...new Uint8Array(await t.pkg.export(e.model.paragraphs,e.model.pageSettings,e.model.numbering,e.model.styles,e.model.tables,e.model.assets).arrayBuffer())];
  const edited=await exportBytes();e.undo();const undone=await exportBytes();
  const {openCanvasDocument}=await import('/src/engine/open-document.js');const reopened=await openCanvasDocument(new Uint8Array(edited));
  for(const image of reopened.images.values())image.close?.();e.destroy();
  return {before,after,changed,stable,edited,undone,reopenedText:reopened.pkg.paragraphs[0].runs.map(r=>r.text).join('')};
 });
 expect(result.after).toEqual(result.before);expect(result.changed).toBe(true);expect(result.stable).toBe(true);expect(result.reopenedText).toMatch(/^Edit /);
 const parts=unzipSync(bytes),edited=unzipSync(new Uint8Array(result.edited));
 expect(unzipSync(new Uint8Array(result.undone))).toEqual(parts);
 for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(edited[name]).toEqual(data);
 writeFileSync(info.outputPath('edited.docx'),new Uint8Array(result.edited));writeFileSync(info.outputPath('undo.docx'),new Uint8Array(result.undone));
});

test('denied font browsing does not refresh or alter the document',async({page})=>{
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  window.queryLocalFonts=async()=>{throw new DOMException('Denied','NotAllowedError');};
  window.refreshCalls=0;
  const {openFontPicker}=await import('/src/views/font-picker.js');const anchor=document.createElement('button');document.body.append(anchor);
  openFontPicker({anchor,value:'Arial',apply:()=>{},onFontsAvailable:()=>window.refreshCalls++});
 });
 await page.getByRole('button',{name:'Browse installed fonts'}).click();
 await expect(page.getByRole('status').filter({hasText:'Installed fonts could not be listed'})).toBeVisible();
 expect(await page.evaluate(()=>window.refreshCalls)).toBe(0);
});
