import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';
const reference=JSON.parse(readFileSync('tests/fixtures/oversized-inline/reference.json','utf8'));
const name='oversized-inline';
test('renders and edits oversized inline pictures with lossless undo and reopen',async({page},info)=>{
 expect(createHash('sha256').update(readFileSync('public/fixtures/oversized-inline.docx')).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/oversized-inline/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await showAllTools(page);await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${name}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/\ufffc/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
 const original=await input.inputValue();
 if(name==='oversized-inline'){
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  const images=await page.evaluate(async()=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{TextDocument}=await import('/src/engine/model.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/oversized-inline.docx')).arrayBuffer()));await loadCanvasFonts(p);const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),ctx=document.createElement('canvas').getContext('2d');
   const placed=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
   return placed.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({page:l.page,pageWidth:placed.page.width,x:f.x,y:l.baseline-f.ascent,width:f.width,height:f.ascent,start:f.start})));
  });
  for(const [i,image] of images.entries()){expect(image.x*.75).toBeCloseTo(reference.pictures[i].x,1);expect(image.width*.75).toBeCloseTo(reference.pictures[i].width,1);}
  expect(images).toHaveLength(6);
  for(const [i,image] of images.entries()){
   const visible=await page.locator('canvas.canvas-page').nth(image.page).evaluate((c,image)=>{
    const scale=c.width/image.pageWidth,y=Math.floor((image.y+image.height/2)*scale);
    const pixels=c.getContext('2d').getImageData(0,y,c.width,1).data,xs=[];
    for(let x=0;x<c.width;x++){const [r,g,b]=pixels.slice(x*4,x*4+3);if(r<100&&g<160&&b>120||r>180&&g>50&&g<160&&b<100)xs.push(x);}
    return {x:Math.min(...xs)/scale*.75,width:(Math.max(...xs)-Math.min(...xs)+1)/scale*.75};
   },image);
   expect(Math.abs(visible.x-reference.pictures[i].visibleX)).toBeLessThan(.8);
   expect(Math.abs(visible.width-reference.pictures[i].visibleWidth)).toBeLessThan(.8);
  }
  // Full drawing extents survive, but the portion outside the cell is hidden.
  const image=images[3],canvas=page.locator('canvas.canvas-page').nth(3);
  await canvas.click({position:{x:image.x+image.width-2,y:image.y+image.height/2}});
  expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).not.toEqual([image.start,image.start+1]);
  const right=(reference.pictures[3].visibleX+reference.pictures[3].visibleWidth)/.75;
  await canvas.click({position:{x:right-2,y:image.y+image.height/2}});
  expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([image.start,image.start+1]);
 }
 await page.locator('canvas.canvas-page').first().screenshot({path:info.outputPath(`${name}.png`)});
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+original);
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await download('-edited');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const a=unzipSync(readFileSync(`public/fixtures/${name}.docx`)),b=unzipSync(readFileSync(await download('-undo')));for(const key of Object.keys(a))expect(Buffer.from(a[key]).equals(Buffer.from(b[key])),key).toBe(true);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
