import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/cell-controls.docx';
test('renders native cell controls and preserves cell structure through typing, export and undo',async({page},info)=>{
 test.setTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const readLayout=async path=>page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.lines.map(l=>({text:l.fragments.map(f=>f.text||'').join(''),x:l.stops[0].x*.75,y:l.baseline*.75}));
 },readFileSync(path).toString('base64'));
 const lines=await readLayout(source),baseline=await readLayout('public/fixtures/cell-controls-baseline.docx');
 expect(lines).toEqual(baseline);
 // Native reference controlled/unwrapped pages are pixel-identical. Exact engine
 // baseline equality isolates controls from the documented legacy table x offset.
 const refs=JSON.parse(readFileSync('tests/fixtures/cell-controls/native-lines.json'))[0];
 for(const text of ['Temporary cell controls','Cell alpha','Second paragraph','Spanning delta','After table']){
  const actual=lines.find(l=>l.text===text),expected=refs.find(l=>l.text===text);expect(actual).toBeTruthy();
  expect(Math.abs(actual.y-expected.baseline)).toBeLessThan(.15);
 }
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Temporary cell controls/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const original=await input.inputValue();
 const png=await page.locator('canvas.canvas-page').evaluate(el=>el.toDataURL());writeFileSync(info.outputPath('cell-controls.png'),Buffer.from(png.split(',')[1],'base64'));
 const download=async name=>{const p=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await p).saveAs(path);return path;};
 const unchanged=await download('unchanged.docx');expect(unzipSync(readFileSync(unchanged))).toEqual(unzipSync(readFileSync(source)));
 await input.evaluate(el=>{const at=el.value.indexOf('Cell beta')+2;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});await page.keyboard.insertText('New beta');
 await expect(input).toHaveValue(original.replace('Cell beta','New beta'));
 const edited=await download('edited.docx'),parts=unzipSync(readFileSync(edited)),before=unzipSync(readFileSync(source));
 expect(strFromU8(parts['word/document.xml']).match(/<w:sdt(?:\s|>)/g)).toHaveLength(5);
 expectBodyEditParts(parts,before);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const undo=await download('undo.docx');expect(unzipSync(readFileSync(undo))).toEqual(before);
 await reopenDocx(page,input,edited,original.replace('Cell beta','New beta'));expect(errors).toEqual([]);
});
