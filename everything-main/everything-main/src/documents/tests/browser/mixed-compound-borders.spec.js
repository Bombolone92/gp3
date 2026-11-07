import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const folder = 'tests/fixtures/mixed-compound-borders/';
const normalize = boxes => {
  const x = Math.min(...boxes.map(b => b[0])), y = Math.min(...boxes.map(b => b[1]));
  return boxes.map(([a,b,w,h,color]) => [a-x,b-y,w,h,color]);
};
const extent = boxes => [Math.max(...boxes.map(b => b[0]+b[2])), Math.max(...boxes.map(b => b[1]+b[3]))];
const colorAt = (boxes,x,y) => boxes.findLast(([a,b,w,h]) => x>a && x<a+w && y>b && y<b+h)?.[4] || 'FFFFFF';
const near = (boxes,x,y) => boxes.some(([a,b,w,h]) =>
  x>=a-.15 && x<=a+w+.15 && y>=b-.15 && y<=b+h+.15 && Math.min(Math.abs(x-a),Math.abs(x-a-w),Math.abs(y-b),Math.abs(y-b-h))<.15);

test('matches native ink and colors at complementary compound corners and round trips edits', async ({page},info) => {
  test.setTimeout(180000);
  const reference = JSON.parse(readFileSync(folder+'reference.json','utf8')), source = readFileSync(folder+'control.docx');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(reference.sourceSha256);
  expect(hash(readFileSync(folder+'native.pdf'))).toBe(reference.pdfSha256);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const {DocxPackage}=await import('/src/engine/docx.js'), {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js'), {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
    const p=await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(p);
    const context=document.createElement('canvas').getContext('2d');
    const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(context,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
    const capture=strokes=>{
      const boxes=[], ctx={save(){},restore(){},fillRect(x,y,w,h){boxes.push([x*.75,y*.75,w*.75,h*.75,this.fillStyle.slice(1).toUpperCase()]);}};
      for(const s of strokes)paintParagraphBorder(ctx,s); return boxes;
    };
    return {pages:l.pageCount,cases:p.tables.map((table,i)=>({paragraph:capture(l.paragraphBorders.filter(s=>s.page===i)),table:capture(l.tableBorders.filter(s=>s.tableId===table.id&&!s.guide))}))};
  },[...source]);
  expect(actual.pages).toBe(reference.cases.length);
  const failures=[];
  for(const c of reference.cases){
    const paths=c.paths.map(p=>[...p.bounds,p.color.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()]);
    const horizontal=paths.filter(b=>b[2]>150&&b[3]<20).sort((a,b)=>a[1]-b[1]);
    const divide=(horizontal[3][1]+horizontal[3][3]+horizontal[4][1])/2;
    for(const context of ['paragraph','table']){
      const word=normalize(paths.filter(b=>context==='paragraph'?b[1]<divide:b[1]>divide));
      const app=normalize(actual.cases[c.page][context]), wa=extent(word), aa=extent(app); let checked=0, mismatches=0;
      for(const right of [false,true])for(const bottom of [false,true])for(let x=.24;x<20;x+=.36)for(let y=.24;y<20;y+=.36){
        const ax=right?aa[0]-x:x, ay=bottom?aa[1]-y:y, wx=right?wa[0]-x:x, wy=bottom?wa[1]-y:y;
        if(near(app,ax,ay)||near(word,wx,wy))continue;
        if(colorAt(app,ax,ay)!==colorAt(word,wx,wy))mismatches++; checked++;
      }
      expect(checked).toBeGreaterThan(100);
      if(mismatches)failures.push({page:c.page,sides:c.sides,frame:c.frame,context,mismatches});
    }
  }
  expect(failures).toEqual([]);
  await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
  const input=page.getByRole('textbox',{name:'Document text'}); await expect(input).toHaveValue(/^Small/); await expect(input).toBeEditable();
  const original=await input.inputValue(), parts=unzipSync(source);
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const saved=await save('edited'), out=unzipSync(readFileSync(saved));
  for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,saved,'Edited '+original);
});
