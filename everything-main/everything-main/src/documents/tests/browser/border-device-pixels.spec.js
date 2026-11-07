import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/border-device-pixels/';
const observations=JSON.parse(readFileSync(root+'screen-observations.json'));
const manifest=JSON.parse(readFileSync(root+'manifest.json'));
for(const mode of [14,15])test(`matches native device widths and keeps all solid corners connected: mode ${mode}`,async({page})=>{
 for(const name of [`control-${mode}.docx`,'screen-observations.json'])expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(manifest[name]);
 await page.goto('/playground.html');
 const results=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{paintTableBorder}=await import('/src/engine/canvas-table-borders.js');
  const {deviceTableBorders}=await import('/src/engine/border-device-layout.js'); const p=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(p);const m=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(m,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables),before=JSON.stringify(l.tableBorders),out=[];
  for(const scale of [1,2]){
   const canvas=document.createElement('canvas');canvas.width=900*scale;canvas.height=450*scale;const c=canvas.getContext('2d');c.scale(scale,scale);for(const s of deviceTableBorders(c,l.tableBorders))if(!s.guide)paintTableBorder(c,s);
   const d=c.getImageData(0,0,canvas.width,canvas.height).data,seen=new Set(),components=[];const opaque=i=>d[i*4+3]===255&&d[i*4]===109&&d[i*4+1]===127&&d[i*4+2]===145;
   for(let i=0;i<canvas.width*canvas.height;i++)if(opaque(i)&&!seen.has(i)){let size=0;const todo=[i];seen.add(i);while(todo.length){const j=todo.pop();size++;for(const k of [j-1,j+1,j-canvas.width,j+canvas.width])if(k>=0&&k<canvas.width*canvas.height&&!seen.has(k)&&opaque(k)){seen.add(k);todo.push(k);}}components.push(size);}
   const widths=[];for(const s of l.tableBorders.filter(s=>!s.guide&&s.horizontal)){
    const x=Math.floor((s.x+s.width/2)*scale),y=Math.max(0,Math.floor(s.y*scale)-2),h=Math.ceil(s.height*scale)+5;let coverage=0,max=0;for(let j=y;j<y+h;j++){const a=d[(j*canvas.width+x)*4+3];coverage+=a/255;max=Math.max(max,a);}widths.push({size:s.border.size,coverage,max});
   }out.push({scale,components,widths});
  }return {results:out,unchanged:before===JSON.stringify(l.tableBorders)};
 },[...readFileSync(root+`control-${mode}.docx`)]);
 expect(results.unchanged).toBe(true);
 for(const r of results.results){expect(r.components).toHaveLength(6);const ref=mode===15&&r.scale===1?{...observations.cases[0],pixels:observations.modern100.pixels}:observations.cases.find(c=>c.zoom===r.scale*100);for(const w of r.widths){const native=ref.pixels[ref.widthsEighthPoints.indexOf(w.size)];if(native!==undefined){expect(w.coverage).toBe(native);expect(w.max).toBe(255);}}}
});

test('uses device borders in the editor while retaining authored widths across edit, undo and reopen',async({page},info)=>{
 const source=root+'control-15.docx',original=unzipSync(readFileSync(source)),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Border 2\/8 pt/);await expect(input).toBeEditable();
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(1);expect(await page.locator('canvas.canvas-page').evaluate(c=>{const d=c.getContext('2d').getImageData(200,45,1,8).data;let rows=0;for(let i=0;i<d.length;i+=4)if(d[i]===109&&d[i+1]===127&&d[i+2]===145)rows++;return rows;})).toBe(1);};
 await check();const text=await input.inputValue();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(original);
 await input.press('ControlOrMeta+End');await input.press('!');await expect(input).toHaveValue(text+'!');
 const edited=await save('edited'),parts=unzipSync(readFileSync(edited));expectBodyEditParts(parts,original);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(text);expect(unzipSync(readFileSync(await save('undo')))).toEqual(original);
 await reopenDocx(page,input,edited,text+'!');await check();expect(errors).toEqual([]);
});
