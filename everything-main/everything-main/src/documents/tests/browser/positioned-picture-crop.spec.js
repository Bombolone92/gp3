import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const source='public/fixtures/positioned-picture-crop.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/positioned-picture-crop/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native positioned-picture-crop ink and preserves shape markup through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/positioned-picture-crop/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Positioned rectangular picture crop controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const colors=await page.evaluate(samples=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return samples.map(({x,y})=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  },reference.samples);
  for(const [i,sample] of reference.samples.entries()) {
   if(sample.case==='C6') for(let c=0;c<3;c++) expect(Math.abs(colors[i][c]-sample.color[c]),`sample ${i}, channel ${c}`).toBeLessThanOrEqual(3);
   else expect(colors[i],`sample ${i} ${sample.case}`).toEqual(sample.color);
  }
 };
 await check();writeFileSync(info.outputPath('positioned-picture-crop.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`positioned-picture-crop${suffix}.docx`);await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('-noedit')))).toEqual(unzipSync(readFileSync(source)));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const editedParts=unzipSync(readFileSync(edited));for(const name of Object.keys(a))if(name!=='word/document.xml')expect(editedParts[name],name).toEqual(a[name]);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const groups=xml=>xml.match(/<(?:[\w]+:)?pic\b[\s\S]*?<\/(?:[\w]+:)?pic>/g);
 expect(groups(sourceXml)).toHaveLength(8);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});

for(const wrap of ['wrapTopAndBottom','wrapSquare'])test(`keeps the native crop/reflection pixels under ${wrap}`,async({page})=>{
 await page.goto('/playground.html');const parts=unzipSync(readFileSync(source));
 const xml=await page.evaluate(({xml,wrap})=>{
  const d=new DOMParser().parseFromString(xml,'application/xml'),wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  for(const anchor of [...d.getElementsByTagNameNS(wp,'anchor')]){
   if(anchor.getElementsByTagNameNS(wp,'docPr')[0].getAttribute('name')!=='C2'){anchor.parentNode.remove();continue;}
   anchor.setAttribute('behindDoc','0');
   const h=anchor.getElementsByTagNameNS(wp,'positionH')[0],v=anchor.getElementsByTagNameNS(wp,'positionV')[0];
   h.setAttribute('relativeFrom','column');v.setAttribute('relativeFrom','paragraph');
   h.firstElementChild.textContent='304800';v.firstElementChild.textContent='304800';
   const w=d.createElementNS(wp,'wp:'+wrap);if(wrap==='wrapSquare')w.setAttribute('wrapText','bothSides');
   anchor.getElementsByTagNameNS(wp,'wrapNone')[0].replaceWith(w);
  }return new XMLSerializer().serializeToString(d);
 },{xml:strFromU8(parts['word/document.xml']),wrap});
 parts['word/document.xml']=strToU8(xml);const bytes=zipSync(parts);
 await page.getByLabel('Open DOCX file').setInputFiles({name:'wrap-control.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(bytes)});
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Positioned rectangular/);await expect(input).toHaveJSProperty('readOnly',false);
 const samples=reference.samples.filter(s=>s.case==='C2');
 const actual=await page.evaluate(async({bytes,samples})=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(pkg);const context=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(context,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables),f=l.floatingObjects[0];
  const c=document.querySelectorAll('canvas.canvas-page')[f.page],ctx=c.getContext('2d'),scale=c.width/l.page.width;
  return {count:l.floatingObjects.length,width:f.width*.75,height:f.height*.75,colors:samples.map(s=>Array.from(ctx.getImageData(Math.round((f.x+(s.x-60)/144*f.width)*scale),Math.round((f.y+(s.y-240)/72*f.height)*scale),1,1).data).slice(0,3))};
 },{bytes:[...bytes],samples});
 expect(actual.count).toBe(1);expect(actual.width).toBe(144);expect(actual.height).toBe(72);
 expect(actual.colors).toEqual(samples.map(s=>s.color));await expect(page.locator('#playground-error')).toBeEmpty();
});



