import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const source='public/fixtures/oversized-glyph.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/oversized-glyph/reference.json'));
test('wraps oversized graphemes like the native reference and preserves editing, grid and OPC parts',async({page},info)=>{
 test.setTimeout(120000);
 for(const[file,hash]of[[source,reference.sourceSha256],['tests/fixtures/oversized-glyph/native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^G0/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const actual=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument,caretRect,hitTest,selectionRects}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/oversized-glyph.docx')).arrayBuffer()));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return p.tables.map(t=>{
   const id=t.rows[0].cells[1].id,lines=layout.lines.filter(l=>l.cellId===id),neighbor=layout.lines.find(l=>l.cellId===t.rows[0].cells[2].id);
   return {grid:t.grid,neighbor:neighbor.stops[0].x*.75,lines:lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.stops[0].x*.75,page:l.page,baseline:l.baseline*.75,hit:hitTest(layout,l.page,l.stops[0].x+1,l.y+l.height/2),start:l.start,caret:caretRect(layout,l.start),selection:selectionRects(layout,l.start,l.start+1)}))};
  });
 });
 expect(actual).toHaveLength(11);
 const words=reference.pages.flatMap((items,page)=>items.filter(x=>x.text==='T').map(x=>({...x,page})));
 for(const[i,c]of actual.entries()){
  expect(c.grid).toEqual([1440,540,7380]);expect(c.neighbor).toBeCloseTo(171.05,0);expect(c.lines.map(l=>l.text)).toEqual(['T','T']);
  for(const[j,l]of c.lines.entries()){
   expect(l.x).toBeCloseTo(words[i*2+j].x,0);expect(l.page).toBe(words[i*2+j].page);expect(l.hit).toBe(l.start);expect(l.caret.x*.75).toBeCloseTo(l.x,0);expect(l.selection).toHaveLength(1);
  }
 }
 await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const ink=await page.evaluate(cases=>cases.flatMap(c=>c.lines.map(l=>{
  const canvas=document.querySelectorAll('canvas.canvas-page')[l.page],ctx=canvas.getContext('2d'),scale=canvas.width/612;
  const count=(left,right)=>{const x=Math.ceil(left*scale),y=Math.ceil((l.baseline-38)*scale),w=Math.floor((right-left)*scale),h=Math.max(1,Math.floor(3*scale)),d=ctx.getImageData(x,y,w,h).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.max(d[i],d[i+1],d[i+2])<100)n++;return n;};
  return {inside:count(145,170),outside:count(172,210)};
 })),actual);
 for(const pixel of ink){expect(pixel.inside).toBeGreaterThan(0);expect(pixel.outside).toBe(0);}
 expect(reference.cellClips.flat().every(r=>Math.abs(r[2]-27.024)<.01)).toBe(true);
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+original);
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`oversized-glyph-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('edited');const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));for(const name of Object.keys(a))if(name!=='word/document.xml')expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);const restored=unzipSync(readFileSync(await save('undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(restored[name])),name).toBe(true);
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();await expect(input).toHaveValue('Edited '+original);await expect(page.locator('#playground-error')).toBeEmpty();
 await page.screenshot({path:info.outputPath('oversized-glyph.png'),fullPage:true});
});
