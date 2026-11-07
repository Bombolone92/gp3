import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/selawik-face/',source=root+'control.docx';
const bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));

async function measure(page,path) {
 return page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{fontAvailable}=await import('/src/engine/font-availability.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {available:fontAvailable('Selawik Semibold'),pictures:layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({page:l.page,x:f.x*.75,width:f.width*.75}))),baselines:layout.lines.filter(l=>l.fragments.some(f=>f.text?.startsWith('Measured typography'))).map(l=>l.baseline*.75)};
 },[...readFileSync(path)]);
}

test('loads missing Selawik Semibold lazily and retains native advances through editing',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 const requests=[];page.on('request',r=>{if(r.url().includes('Selawik-Semibold.ttf'))requests.push(r.url());});
 await page.goto('/playground.html');await expect(page.getByRole('textbox',{name:'Document text'})).toBeVisible();expect(requests).toEqual([]);
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Selawik Semibold/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async path=>{
  const actual=await measure(page,path);expect(actual.available).toBe(true);
  writeFileSync(info.outputPath(path===source?'advances.json':'edited-advances.json'),JSON.stringify(actual,null,2));
  expect(actual.pictures).toHaveLength(8);
  for(const [i,p]of actual.pictures.entries()){expect(p.page).toBe(ref.pictures[i].page);expect(Math.abs(p.x-ref.pictures[i].x),`style ${i}`).toBeLessThan(.15);expect(p.width).toBeCloseTo(ref.pictures[i].width,1);}
 };
 await verify(source);for(const url of requests)expect(new URL(url).origin).toBe(new URL(page.url()).origin);
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await event).saveAs(p);return p;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await verify(edited);
});

test.describe('Selawik high-resolution ink',()=>{
 test.use({deviceScaleFactor:4});
 test('matches native ink for regular, bold and synthesized italic styles',async({page},info)=>{
  const ink=JSON.parse(readFileSync(root+'ink-reference.json'));
  expect(ink.sourceSha256).toBe(ref.sourceSha256);expect(ink.pdfSha256).toBe(ref.pdfSha256);
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^Selawik Semibold/);
  const actual=await measure(page,source);expect(actual.baselines).toHaveLength(8);
  const samples=ink.lines.map((l,i)=>({...l,dy:Math.round((actual.baselines[i]-l.baseline)*16/3)}));
  const ratios=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
   if(canvas.width!==3264||canvas.height!==4224)throw Error('Expected 384dpi canvas');
   const ctx=canvas.getContext('2d');return lines.map(l=>{const [x,y,r,b]=l.box,p=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let coverage=0;for(let i=0;i<p.length;i+=4)coverage+=1-(p[i]+p[i+1]+p[i+2])/765;return coverage/l.ink;});
  },samples);
  writeFileSync(info.outputPath('ink-ratios.json'),JSON.stringify(ratios,null,2));
  for(const [i,r]of ratios.entries()){expect(r,`style ${i}`).toBeGreaterThan(.95);expect(r,`style ${i}`).toBeLessThan(1.05);}
 });
});
