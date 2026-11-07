import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const bounds=boxes=>[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[0]+b[2])),Math.max(...boxes.map(b=>b[1]+b[3]))];
const colorAt=(boxes,x,y)=>boxes.findLast(([a,b,w,h])=>x>a&&x<a+w&&y>b&&y<b+h)?.[4]||'FFFFFF';
const near=(boxes,x,y)=>boxes.some(([a,b,w,h])=>x>=a-.15&&x<=a+w+.15&&y>=b-.15&&y<=b+h+.15&&Math.min(Math.abs(x-a),Math.abs(x-a-w),Math.abs(y-b),Math.abs(y-b-h))<.15);
for(const mode of [12,15])test(`compound outer edges retain native extents and corner colors in mode ${mode}`,async({page},info)=>{
 test.setTimeout(120000);
 const folder=`tests/fixtures/compound-outer-edges/mode${mode}/`,source=readFileSync(folder+'control.docx'),reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
 const hash=data=>createHash('sha256').update(data).digest('hex');expect(hash(source)).toBe(reference.sourceSha256);expect(hash(readFileSync(folder+'native.pdf'))).toBe(reference.pdfSha256);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return p.tables.map(table=>{const boxes=[],capture={save(){},restore(){},fillRect(x,y,w,h){boxes.push([x*.75,y*.75,w*.75,h*.75,this.fillStyle.slice(1).toUpperCase()]);}};for(const s of l.tableBorders.filter(s=>s.tableId===table.id&&!s.guide))paintParagraphBorder(capture,s);return boxes;});
 },[...source]);
 expect(actual).toHaveLength(32);
 for(const [i,c]of reference.cases.entries()){
  const app=actual[i],word=c.boxes,a=bounds(app),w=bounds(word);
  for(let j=0;j<4;j++)expect(Math.abs(a[j]-w[j]),JSON.stringify({mode,i,c:[c.style,c.size,c.rule],edge:j,app:a[j],word:w[j]})).toBeLessThan(.09);
  let checked=0;const failures=[];
  for(const right of [false,true])for(const bottom of [false,true])for(let dx=.24;dx<14;dx+=.36)for(let dy=.24;dy<14;dy+=.36){
   const ax=right?a[2]-dx:a[0]+dx,ay=bottom?a[3]-dy:a[1]+dy,wx=right?w[2]-dx:w[0]+dx,wy=bottom?w[3]-dy:w[1]+dy;
   if(near(app,ax,ay)||near(word,wx,wy))continue;
   if(colorAt(app,ax,ay)!==colorAt(word,wx,wy))failures.push({right,bottom,dx,dy});checked++;
  }
  expect(failures,`mode ${mode}, case ${i+1}`).toEqual([]);expect(checked).toBeGreaterThan(100);
 }
 await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/After 32/);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(32);
 const original=await input.inputValue(),parts=unzipSync(source);
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await input.inputValue(),file=await save('edited'),out=unzipSync(readFileSync(file));for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,file,edited);await expect(input).toBeEditable();
});
