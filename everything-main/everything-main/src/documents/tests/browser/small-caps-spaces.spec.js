import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/small-caps-spaces/',source=readFileSync(root+'control.docx');
const ref=JSON.parse(readFileSync(root+'reference.json'));

test('small-cap spaces match native glyph positions across runs and wrapping',async({page},info)=>{
 expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {paragraphText}=await import('/src/engine/model.js');
  const {fontAvailable}=await import('/src/engine/font-availability.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
  for(const f of ['Arial','Constantia','Calibri Light'])if(!fontAvailable(f))throw Error('Missing control font '+f);
  const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  const text=p.paragraphs.map(paragraphText).join('\n');
  return l.pages.map((_,pi)=>l.lines.filter(line=>line.page===pi).flatMap(line=>line.stops.slice(0,-1).map((stop,i)=>({text:text.slice(stop.offset,line.stops[i+1].offset).toUpperCase(),x:stop.x*.75,y:line.baseline*.75})).filter(c=>c.text.trim())));
 },source.toString('base64'));
 writeFileSync(info.outputPath('origins.json'),JSON.stringify(actual,null,2));
 const deltas=[];
 expect(actual).toHaveLength(ref.pages.length);
 for(const [i,native]of ref.pages.entries()){
  const expected=native.filter(c=>c.text.trim());
  expect(actual[i].map(c=>c.text),`page ${i+1} glyphs`).toEqual(expected.map(c=>c.text));
  for(const [j,c]of actual[i].entries())deltas.push({page:i,text:c.text,x:c.x-expected[j].x,y:c.y-expected[j].y});
 }
 writeFileSync(info.outputPath('deltas.json'),JSON.stringify(deltas,null,2));
 expect(Math.max(...deltas.map(d=>Math.abs(d.x))),'maximum glyph horizontal difference').toBeLessThan(.35);
 expect(Math.max(...deltas.map(d=>Math.abs(d.y))),'maximum glyph baseline difference').toBeLessThan(.35);
});

test('small-cap spaces preserve source text through editing and reopening',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^S00/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 const original=await input.inputValue(),parts=unzipSync(source);
 const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await next).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await page.keyboard.insertText(' extra words');const edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original+' extra words');expect(errors).toEqual([]);
});
