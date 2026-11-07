import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

for(const [fixture,selected] of [['font-alternatives','Arial'],['font-alternatives-serif','Times New Roman']])
test(`layout font audit reports the family used by actual painting: ${fixture}`,async({page})=>{
 await page.addInitScript(()=>{
  window.auditPaintFonts=[];
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...arguments_){
   if(text.startsWith('Alternate font'))window.auditPaintFonts.push(this.font);
   return original.call(this,text,...arguments_);
  };
 });
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {recordLayoutFontSelection}=await import('/tools/record-layout-font-selection.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);let editor;
  try{
   editor=new CanvasEditor(host,{...pkg,images});editor.paint();
   const before=JSON.stringify(editor.layout.lines);
   const choices=recordLayoutFontSelection(editor,pkg.styles.fontAlternatives);
   return {choices,unchanged:before===JSON.stringify(editor.layout.lines),paint:window.auditPaintFonts};
  }finally{editor?.destroy();host.remove();}
 },[...readFileSync(`public/fixtures/${fixture}.docx`)]);
 const missing=result.choices.filter(r=>r.declared.startsWith('AltProbeMissing'));
 expect(missing.length).toBeGreaterThan(0);
 expect(missing.every(r=>r.selected===selected&&r.available===false)).toBe(true);
 expect(result.paint.length).toBeGreaterThan(0);
 expect(result.paint.every(font=>font.includes(selected))).toBe(true);
 expect(result.unchanged).toBe(true);
 expect(result.choices.every(r=>!Object.hasOwn(r,'text'))).toBe(true);
});
