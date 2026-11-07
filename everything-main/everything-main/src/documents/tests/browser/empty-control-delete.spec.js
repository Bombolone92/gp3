import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = 'tests/fixtures/empty-control-delete/';
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
for (const key of ['Backspace', 'Delete']) for (const readOnly of [false, true]) test(`${key} at an empty inside caret preserves surrounding text; readOnly=${readOnly}`, async ({page},info)=>{
 const input=await open(page,readOnly),parts=unzipSync(readFileSync(root+reference.source));
 const entry=await point(page,1);await page.mouse.click(entry.x,entry.y);
 expect(await page.evaluate(()=>window.dragEditor.model.selection.controlCaret?.side)).toBe('inside');
 await input.press(key);await expect(input).toHaveValue('AD');
 const controls=()=>page.evaluate(async()=>{const {contentControlRanges}=await import('/src/engine/content-controls.js');return contentControlRanges(window.dragEditor.model.paragraphs).length;});
 expect(await controls()).toBe(readOnly?1:0);
 const edited=await save(page,info,'deleted');
 for(const [name,bytes]of Object.entries(parts))if(readOnly||name!=='word/document.xml')expect(edited[name]).toEqual(bytes);
 if(!readOnly){
  expect(await page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const {contentControlRanges}=await import('/src/engine/content-controls.js');return contentControlRanges((await DocxPackage.open(new Uint8Array(bytes))).paragraphs).length;},[...readFileSync(info.outputPath('deleted.docx'))])).toBe(0);
  await input.press('Control+z');expect(await controls()).toBe(1);expect(await save(page,info,'undo')).toEqual(parts);
  expect(await page.evaluate(()=>window.dragEditor.model.selection.controlCaret?.side)).toBe('inside');
  await input.press('Control+y');expect(await controls()).toBe(0);
  await page.keyboard.insertText('X');await expect(input).toHaveValue('AXD');
  await input.press(key);await expect(input).toHaveValue(key==='Backspace'?'AD':'AX');
 }
 expect(await page.evaluate(()=>window.dragErrors)).toEqual([]);
});
