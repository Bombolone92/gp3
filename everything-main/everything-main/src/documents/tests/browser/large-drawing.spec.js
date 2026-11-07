import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';

test('opens a wide drawing tree and preserves its paths and alternatives through edits and undo',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/playground.html');await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/large-drawing.docx');
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/Grouped drawings/, {timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const original=await input.inputValue();
 const geometry=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/large-drawing.docx')).arrayBuffer()));
  const shapes=[];const visit=n=>{if(n.paths)shapes.push(n.paths.map(p=>p.points.length));n.children?.forEach(visit);};
  Object.values(p.assets).filter(a=>a.scene).forEach(a=>visit(a.scene));return shapes;
 });
 expect(geometry.flat().filter(n=>n===7001)).toHaveLength(10);
 await page.locator('canvas.canvas-page').first().screenshot({path:info.outputPath('large-drawing.png')});
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+original);
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`large-drawing${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const source=unzipSync(readFileSync('public/fixtures/large-drawing.docx')),out=unzipSync(readFileSync(await save('-undo')));
 for(const [name,bytes] of Object.entries(source))expect(Buffer.from(out[name]).equals(Buffer.from(bytes)),name).toBe(true);
 const previous=await input.elementHandle();page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
});
