import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/body-overflow-indents';
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
test('off-paper signed paragraph indents match native wrapping and alignment',async({page},info)=>{
 for(const [name,hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {layoutDocument,caretRect,selectionRects,hitTest}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  const hidden=l.lines.find(line=>line.fragments.map(f=>f.text).join('')==='Right aligned text');
  return {pages:l.pageCount,lines:l.lines.map(line=>({text:line.fragments.map(f=>f.text).join('').trim(),page:line.page,x:line.stops[0].x*.75,y:line.baseline*.75})),
   caret:caretRect(l,hidden.start),hiddenSelection:selectionRects(l,hidden.start,hidden.end),hiddenStart:hidden.start,hiddenEnd:hidden.end,hit:hitTest(l,hidden.page,815,hidden.y+hidden.height/2),
   rects:selectionRects(l,0,l.lines.at(-1).end)};
 },readFileSync(`${folder}/control.docx`).toString('base64'));
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 expect(actual.pages).toBe(6);
 for(const row of reference.lines){const match=actual.lines.find(l=>l.page===row.page && l.text===row.text);expect(match,row.text).toBeTruthy();expect(Math.abs(match.x-row.x),row.text+' x').toBeLessThan(.15);expect(Math.abs(match.y-row.y),row.text+' y').toBeLessThan(.2);}
 expect(actual.caret.x).toBe(815);expect(actual.hiddenSelection).toEqual([]);
 expect(actual.hit<actual.hiddenStart || actual.hit>actual.hiddenEnd).toBe(true);
 for(const rect of actual.rects){expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(816);}
});

test('edits visible overflow text and preserves signed indents through undo and reopen',async({page},info)=>{
 const {unzipSync}=await import('fflate');
 const source=`${folder}/control.docx`,parts=unzipSync(readFileSync(source));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/Short contact line/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const original=await input.inputValue();
 const save=async name=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}.docx`);await(await download).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const canvas=page.locator('canvas.canvas-page').first(),box=await canvas.boundingBox(),scale=box.width/816;
 await canvas.click({position:{x:100*scale,y:124*scale}});
 const at=await input.evaluate(e=>e.selectionStart),start=original.indexOf('Short contact line');
 expect(at).toBeGreaterThanOrEqual(start);expect(at).toBeLessThanOrEqual(start+18);
 await page.keyboard.insertText('EDIT ');await expect(input).toHaveValue(/EDIT /);
 const editedText=await input.inputValue(),edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts)) if(name!=='word/document.xml') expect(changed[name],name).toEqual(parts[name]);
 const indents=bytes=>new TextDecoder().decode(bytes).match(/<w:ind\b[^>]*\/>/g);
 expect(indents(changed['word/document.xml'])).toEqual(indents(parts['word/document.xml']));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await page.waitForFunction(e=>!e.isConnected,previous);await previous.dispose();
 await expect(input).toHaveValue(editedText);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
