import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = 'tests/fixtures/filled-control-delete/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
async function open(page, readOnly = false) {
  await page.goto('/playground.html');
  await page.evaluate(async ({ bytes, readOnly }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const host = document.createElement('div'); host.id = 'drag-editor';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:1000';
    document.body.append(host);
    window.dragPackage = await DocxPackage.open(new Uint8Array(bytes)); window.dragErrors = [];
    window.dragEditor = new CanvasEditor(host, { ...window.dragPackage, readOnly, onError: e => window.dragErrors.push(e.message) });
  }, { bytes: [...readFileSync(root + reference.source)], readOnly });
  return page.locator('#drag-editor textarea');
}
async function point(page, position, dx = 0) {
  return page.evaluate(async ({ position, dx }) => {
    const { caretRect } = await import('/src/engine/layout.js'), e = window.dragEditor;
    const c = caretRect(e.selectionLayout, position), r = e.canvases[c.page].getBoundingClientRect();
    return { x: r.left + c.x * e.zoom + dx, y: r.top + (c.y + c.height / 2) * e.zoom };
  }, { position, dx });
}
async function save(page, info, name) {
  const bytes = new Uint8Array(await page.evaluate(async () => [...new Uint8Array(await window.dragEditor.export(window.dragPackage).arrayBuffer())]));
  writeFileSync(info.outputPath(name + '.docx'), bytes); return unzipSync(bytes);
}
for(const c of reference.cases)for(const readOnly of [false,true])test(`${c.key} preserves a filled inside boundary; readOnly=${readOnly}`,async({page},info)=>{
 const input=await open(page,readOnly),parts=unzipSync(readFileSync(root+reference.source));await input.focus();
 await input.press(c.key==='Backspace'?'Control+Home':'Control+End');
 const arrow=c.key==='Backspace'?'ArrowRight':'ArrowLeft';await input.press(arrow);await input.press(arrow);
 expect(await page.evaluate(()=>window.dragEditor.model.selection.controlCaret?.side)).toBe('inside');
 for(let i=0;i<3;i++)await input.press(c.key);
 await expect(input).toHaveValue('ABCD');expect(await page.evaluate(()=>window.dragEditor.session.history.length)).toBe(0);
 expect(await save(page,info,'unchanged')).toEqual(parts);
 expect(await page.evaluate(()=>window.dragEditor.model.selection.controlCaret?.side)).toBe('inside');
 if(!readOnly){
  await page.keyboard.insertText('X');await expect(input).toHaveValue(c.text);
  expect(await page.evaluate(async()=>{const {contentControlRanges}=await import('/src/engine/content-controls.js');const m=window.dragEditor.model,r=contentControlRanges(m.paragraphs)[0];return m.text.slice(r.start,r.end);})).toBe(c.controlText);
  const edited=await save(page,info,'edited');for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(edited[n]).toEqual(b);
  expect(await page.evaluate(async bytes=>{const{DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(bytes));return p.paragraphs.flatMap(p=>p.runs.map(r=>r.text)).join('');},[...readFileSync(info.outputPath('edited.docx'))])).toBe(c.text);
  await input.press('Control+z');await expect(input).toHaveValue('ABCD');expect(await save(page,info,'undo')).toEqual(parts);
  await input.press('Control+y');await expect(input).toHaveValue(c.text);
 }
 expect(await page.evaluate(()=>window.dragErrors)).toEqual([]);
});
