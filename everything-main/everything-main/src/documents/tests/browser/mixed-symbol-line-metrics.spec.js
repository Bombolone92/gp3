import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/mixed-symbol-line-metrics/',source=root+'controls.docx';
const ref=JSON.parse(readFileSync(root+'reference.json'));
const norm=s=>s.replace(/\s/g,'');

test('matches native Gothic and mixed-font baselines through editing and reopening',async({page},info)=>{
 test.setTimeout(180000);
 for(const [file,hash] of [[source,ref.sourceSha256],[root+'controls-native.pdf',ref.pdfSha256]])
  expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {fontAvailable}=await import('/src/engine/font-availability.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);
  for(const family of ['Calibri','MS Gothic','MS PGothic','MS UI Gothic'])if(!fontAvailable(family))throw Error('Missing native control font: '+family);
  const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.pages.map((_,i)=>l.lines.filter(row=>row.page===i).map(row=>({text:row.fragments.map(f=>f.text).join(''),x:row.stops[0]?.x*.75,y:row.baseline*.75})).filter(row=>row.text.trim()));
 },[...readFileSync(source)]);
 writeFileSync(info.outputPath('baselines.json'),JSON.stringify(actual,null,2));
 expect(actual).toHaveLength(ref.pages.length);
 for(const [i,p]of ref.pages.entries()){
  const native=[];
  for(const span of p.spans){const last=native.at(-1);if(last&&Math.abs(last.y-span.y)<.15)last.text+=span.text;else native.push({...span});}
  expect(actual[i].map(r=>norm(r.text)),`page ${i+1} text`).toEqual(native.map(r=>norm(r.text)));
  for(const [j,row]of actual[i].entries()){
   expect(Math.abs(row.y-native[j].y),`page ${i+1} ${row.text} baseline`).toBeLessThan(.2);
   expect(Math.abs(row.x-native[j].x),`page ${i+1} ${row.text} origin`).toBeLessThan(.1);
  }
 }
 for(const i of [2,8,25,ref.pages.length-1])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const text=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');same(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);same(await save('undo'));
 await reopenDocx(page,input,edited,'Edited '+text);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);expect(errors).toEqual([]);
});
