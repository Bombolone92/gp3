import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/numbering-style-bindings/',source=folder+'control.docx';
const ref=JSON.parse(readFileSync(folder+'reference.json'));

test('matches native list ownership and geometry through typing, undo and reopen',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^N00 /);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const verify=async path=>{
  const rows=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js');
   const {TextDocument}=await import('/src/engine/model.js');
   const {layoutDocument}=await import('/src/engine/layout.js');
   const {pageGeometry}=await import('/src/engine/page-settings.js');
   const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
   const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles);
   const ctx=document.createElement('canvas').getContext('2d');
   const result=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering);
   return d.paragraphs.map((p,index)=>{
    const l=result.lines.find(l=>l.paragraphId===p.id);
    return {index,page:l.page,textX:l.stops[0].x*.75,baselineY:l.baseline*.75,marker:l.marker?.text??'',markerX:l.marker?.x*.75};
   });
  },readFileSync(path).toString('base64'));
  expect(rows).toHaveLength(ref.positions.length);
  for(const native of ref.positions){
   const actual=rows[native.index];expect(actual.page,`row ${native.index}`).toBe(native.page);expect(actual.marker).toBe(native.marker);
   for(const key of ['textX','baselineY',...(native.marker?['markerX']:[])])expect(Math.abs(actual[key]-native[key]),`row ${native.index} ${key}: ${actual[key]} / ${native[key]}`).toBeLessThan(.2);
  }
 };
 await verify(source);
 const images=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]));
 images.forEach((png,i)=>writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png,'base64')));
 const original=await input.inputValue();
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const initial=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(initial);
 await input.evaluate(el=>{const start=el.value.indexOf('N24 ');el.setSelectionRange(start,start);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await expect(page.getByRole('button',{name:'Numbered list',exact:true})).toHaveAttribute('aria-pressed','false');
 await input.focus();await input.press('End');await page.keyboard.insertText(' Edited');
 const editedText=await input.inputValue(),edited=await save('edited');await verify(edited);
 const parts=unzipSync(readFileSync(edited));for(const[name,bytes]of Object.entries(initial))if(name!=='word/document.xml')expect(parts[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(initial);
 await reopenDocx(page,input,edited,editedText);await verify(edited);expect(errors).toEqual([]);
});

test('saves paragraph formatting when a style suppresses the inherited list marker', async ({ page }, info) => {
 test.setTimeout(120000);
 await page.goto('/playground.html', { waitUntil: 'domcontentloaded' }); await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^N00 /);
 const select = async () => input.evaluate(el => { const at = el.value.indexOf('N24 '); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); });
 await select();
 await expect(page.getByRole('button', { name: 'Numbered list', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await page.getByRole('button', { name: 'Align right', exact: true }).click();
 const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
 const saved = info.outputPath('inactive-list-format.docx'); await (await download).saveAs(saved);
 const bytes = unzipSync(readFileSync(saved)), original = unzipSync(readFileSync(source));
 for (const [name, data] of Object.entries(original)) if (name !== 'word/document.xml') expect(bytes[name]).toEqual(data);
 await reopenDocx(page, input, saved, await input.inputValue()); await showAllTools(page); await select();
 await expect(page.getByRole('button', { name: 'Align right', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect(page.getByRole('button', { name: 'Numbered list', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
