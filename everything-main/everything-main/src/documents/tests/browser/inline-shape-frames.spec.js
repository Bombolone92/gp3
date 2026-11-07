import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/inline-shape-frames/',refs=JSON.parse(readFileSync(folder+'reference.json'));
for(const mode of [12,14,15])test(`mode ${mode}: native inline frames, painted shapes, editing and exact undo`,async({page},info)=>{
 test.setTimeout(120000);const source=folder+`mode-${mode}.docx`,bytes=readFileSync(source),parts=unzipSync(bytes),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.lines.flatMap(line=>line.fragments.filter(f=>f.image).map(f=>({width:f.width*.75,height:f.ascent*.75,page:line.page})));
 },[...bytes]);
 expect(actual).toHaveLength(36);
 for(const [i,c]of refs[mode].cases.entries()){expect(actual[i].page).toBe(c.page);expect(Math.abs(actual[i].width-c.inlineAdvancePt)).toBeLessThan(.1);expect(actual[i].height).toBe(actual[i].width===72?36:72);}
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^preset 0:A/,{timeout:45000});await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(4);await expect(page.locator('#playground-error')).toBeEmpty();
 // Include antialiased coverage: a one-point diagonal stroke need not contain
 // many pixels of its exact opaque source color.
 const blue=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]<180&&d[i+1]>100&&d[i+2]>150)count++;return count;}));
 for(const [i,count]of blue.entries())expect(count).toBeGreaterThan(i===3?500:30000);
 for(let i=0;i<4;i++)writeFileSync(info.outputPath(`page-${i}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const equal=(path,edited=false)=>{const p=unzipSync(readFileSync(path));expect(Object.keys(p).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))if(!edited||n!=='word/document.xml')expect(p[n]).toEqual(parts[n]);};
 equal(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');equal(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);equal(await save('undo'));
 await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('canvas.canvas-page')).toHaveCount(4);expect(errors).toEqual([]);
});
