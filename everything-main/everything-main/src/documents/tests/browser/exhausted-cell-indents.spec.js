import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const reference=JSON.parse(readFileSync('tests/fixtures/exhausted-cell-indents/reference.json','utf8'));
test('matches native exhausted-cell lines, clipping, edit/export and exact undo',async({page},info)=>{
 test.setTimeout(120000);
 const source='public/fixtures/exhausted-cell-indents.docx',bytes=readFileSync(source),errors=[];
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/exhausted-cell-indents/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/after zero\nEnd$/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const data=await page.evaluate(async encoded=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
   const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
   return {lines:l.lines.map(line=>({page:line.page,y:line.baseline*.75,fragments:line.fragments.filter(f=>!f.image).map(f=>({text:f.text,x:f.x*.75}))})),cells:pkg.tables[0].rows.map(row=>{
    const cell=l.cells.find(c=>c.id===row.cells[1].id),lines=l.lines.filter(line=>line.cellId===cell.id);
    return {x:cell.x,width:cell.width,count:lines.length,clips:lines.filter(line=>line.textClip).map(line=>line.textClip)};
   })};
  },bytes.toString('base64'));
  const remaining=structuredClone(reference.spans),norm=s=>s.replace(/\s/g,'').toUpperCase();let matched=0;
  for(const line of data.lines){
   const fs=line.fragments.filter(f=>f.text.trim()),label=norm(fs.map(f=>f.text).join(''));if(!label)continue;
   let match;
   for(let i=0;i<remaining.length&&!match;i++){
    const n=remaining[i];if(n.page!==line.page)continue;let text='';
    for(let j=i;j<remaining.length;j++){
     if(remaining[j].page!==n.page||Math.abs(remaining[j].y-n.y)>.15)break;
     text+=norm(remaining[j].text);if(text===label){match={i,j,n};break;}if(!label.startsWith(text))break;
    }
   }
   expect(match,`native line ${label}`).toBeTruthy();
   expect(Math.abs(fs[0].x-match.n.x),`${label} x`).toBeLessThan(.2);
   expect(Math.abs(line.y-match.n.y),`${label} baseline`).toBeLessThan(.2);
   remaining.splice(match.i,match.j-match.i+1);matched++;
  }
  expect(matched).toBe(58);expect(remaining).toEqual([]);
  expect(data.cells.map(c=>c.count)).toEqual([1,1,5,1,1,2,2,5,1,2,2,2,4,4]);
  // Row 3's clipped letters lie beyond the middle cell; their later lines must
  // not paint over the neighboring cell. Its label occupies only the first line.
  const clean=await page.locator('canvas.canvas-page').evaluate(canvas=>{
   const ctx=canvas.getContext('2d'),scale=canvas.width/816;
   const p=ctx.getImageData(Math.round(300*scale),Math.round(165*scale),Math.round(25*scale),Math.round(50*scale)).data;
   for(let i=0;i<p.length;i+=4)if(p[i]<100&&p[i+1]<100&&p[i+2]<100)return false;
   return true;
  });expect(clean).toBe(true);
 };
 await verify();const original=await input.inputValue(),parts=unzipSync(bytes);
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await download('noedit')))).toEqual(parts);
 // Insert into the previously empty exhausted cell, not merely the body.
 const offset=original.indexOf('\n')+1;
 await input.evaluate((el,offset)=>{el.focus();el.setSelectionRange(offset,offset);el.dispatchEvent(new Event('select',{bubbles:true}));},offset);
 await page.keyboard.insertText('XY');await expect(input).toHaveValue(original.slice(0,offset)+'XY'+original.slice(offset));
 const edited=await download('edited'),editedParts=unzipSync(readFileSync(edited));
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(editedParts[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await download('undo')))).toEqual(parts);await verify();
 page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect(input).toHaveValue(original.slice(0,offset)+'XY'+original.slice(offset));await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 expect(errors).toEqual([]);
});
