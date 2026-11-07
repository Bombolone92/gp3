import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

const folder='tests/fixtures/nonempty-control-shift-selection/';
const references=JSON.parse(readFileSync(folder+'reference.json')).cases;
for(const startMode of ['selection','caret'])for(const zoom of [1,.75])for(const direction of ['right','left'])for(const drag of [false,true])
test(`pointer extension keeps the ${direction} control anchor at ${zoom}, drag=${drag}, start=${startMode}`,async({page},info)=>{
 const ref=references.find(r=>r.name===direction+'-twice');
 for(const kind of ['source','result'])expect(createHash('sha256').update(readFileSync(folder+ref[kind])).digest('hex')).toBe(ref[kind+'Sha256']);
 const source=readFileSync(folder+ref.source),parts=unzipSync(source);
 await page.goto('/playground.html');
 await page.evaluate(async({bytes,zoom})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const host=document.createElement('div');host.id='pointer-control-probe';
  host.style.cssText='position:fixed;inset:0;overflow:auto;background:white;z-index:1000';document.body.append(host);
  window.pointerPackage=await DocxPackage.open(new Uint8Array(bytes));window.pointerErrors=[];
  window.pointerEditor=new CanvasEditor(host,{...window.pointerPackage,onError:e=>window.pointerErrors.push(e.message)});
  window.pointerEditor.zoom=zoom;window.pointerEditor.relayout();window.pointerEditor.focus();
 },{bytes:[...source],zoom});
 const input=page.locator('#pointer-control-probe textarea');
 for(const key of ref.setup)await input.press(key);
 if(startMode==='selection')await input.press(direction==='right'?'Shift+ArrowRight':'Shift+ArrowLeft');
 const before=await page.evaluate(()=>structuredClone(window.pointerEditor.model.selection));
 const owner=before.controlSelection || {id:before.controlCaret.id,direction:direction==='right'?1:-1};
 if(startMode==='selection')expect(before.controlSelection).toBeDefined();
 else expect(before.controlCaret.side).toBe('inside');
 const target=direction==='right'?4:0;
 const point=await page.evaluate(async position=>{
  const {caretRect}=await import('/src/engine/layout.js');const e=window.pointerEditor;
  const caret=caretRect(e.selectionLayout,position),rect=e.canvases[caret.page].getBoundingClientRect();
  return {x:rect.left+caret.x*e.zoom,y:rect.top+(caret.y+caret.height/2)*e.zoom};
 },target);
 await page.keyboard.down('Shift');
 if(drag){
  const start=await page.evaluate(async position=>{
   const {caretRect}=await import('/src/engine/layout.js');const e=window.pointerEditor;
   const c=caretRect(e.selectionLayout,position),r=e.canvases[c.page].getBoundingClientRect();
   return {x:r.left+c.x*e.zoom,y:r.top+(c.y+c.height/2)*e.zoom};
  },before.focus);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(point.x,point.y,{steps:3});await page.mouse.up();
 }else await page.mouse.click(point.x,point.y);
 await page.keyboard.up('Shift');
 const selection=await page.evaluate(()=>structuredClone(window.pointerEditor.model.selection));
 expect(selection).toMatchObject({anchor:before.anchor,focus:target,controlSelection:{id:owner.id,direction:owner.direction}});
 await page.keyboard.insertText('x');
 const inspect=()=>page.evaluate(async()=>{
  const {contentControlRanges}=await import('/src/engine/content-controls.js');const d=window.pointerEditor.model;
  return {text:d.text,controls:contentControlRanges(d.paragraphs).map(r=>({text:d.text.slice(r.start,r.end),placeholder:!!r.control.placeholder}))};
 });
 expect(await inspect()).toEqual({text:ref.text,controls:ref.controls});
 const save=async name=>{
  const bytes=new Uint8Array(await page.evaluate(async()=>[...new Uint8Array(await window.pointerEditor.export(window.pointerPackage).arrayBuffer())]));
  writeFileSync(info.outputPath(name+'.docx'),bytes);return bytes;
 };
 const edited=await save('edited'),editedParts=unzipSync(edited);
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(editedParts[name]).toEqual(bytes);
 expect(await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {TextDocument}=await import('/src/engine/model.js');
  const {contentControlRanges}=await import('/src/engine/content-controls.js');const p=await DocxPackage.open(new Uint8Array(bytes));
  const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  return {text:d.text,controls:contentControlRanges(d.paragraphs).map(r=>({text:d.text.slice(r.start,r.end),placeholder:!!r.control.placeholder}))};
 },[...edited])).toEqual({text:ref.text,controls:ref.controls});
 await input.press('Control+z');expect(unzipSync(await save('undo'))).toEqual(parts);
 await input.press('Control+y');expect(unzipSync(await save('redo'))).toEqual(editedParts);
 // Returning to the keyboard anchor restores its inside caret. A fresh click
 // then clears that ownership before typing into the ordinary neighbor.
 await input.press('Control+z');
 const anchorPoint=await page.evaluate(async position=>{
  const {caretRect}=await import('/src/engine/layout.js');const e=window.pointerEditor;
  const c=caretRect(e.selectionLayout,position),r=e.canvases[c.page].getBoundingClientRect();
  return {x:r.left+c.x*e.zoom,y:r.top+(c.y+c.height/2)*e.zoom};
 },before.anchor);
 await page.keyboard.down('Shift');await page.mouse.click(anchorPoint.x,anchorPoint.y);await page.keyboard.up('Shift');
 expect(await page.evaluate(()=>window.pointerEditor.model.selection)).toMatchObject({anchor:before.anchor,focus:before.anchor,controlCaret:{id:owner.id,side:'inside'}});
 await page.keyboard.insertText('z');
 expect(await inspect()).toEqual(direction==='right'?{text:'ABCzD',controls:[{text:'BCz',placeholder:false}]}:{text:'AzBCD',controls:[{text:'zBC',placeholder:false}]});
 await input.press('Control+z');
 await page.mouse.click(point.x,point.y);
 expect(await page.evaluate(()=>window.pointerEditor.model.selection.controlSelection)).toBeUndefined();
 await page.keyboard.insertText('q');
 expect(await inspect()).toEqual({text:direction==='right'?'ABCDq':'qABCD',controls:[{text:'BC',placeholder:false}]});
 await input.press('Control+z');expect(unzipSync(await save('final-undo'))).toEqual(parts);
 expect(await page.evaluate(()=>window.pointerErrors)).toEqual([]);
});
