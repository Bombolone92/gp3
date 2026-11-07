import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/autofit-span-floor';
for(const name of ['narrow','wide']) test(`native crossing spans retain writing floors and noWrap minima: ${name}`,async({page},info)=>{
  const source=readFileSync(`${folder}/${name}.docx`);
  const ref=JSON.parse(readFileSync(`${folder}/${name}-native.json`));
  const cases=JSON.parse(readFileSync(`${folder}/${name}-cases.json`));
  expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/${ref.pdf}`)).digest('hex')).toBe(ref.pdfSha256);
  await page.goto('/playground.html');
  expect(await page.evaluate(async()=>{try{await new FontFace('Reference Arial','local("Arial")').load();return true;}catch{return false;}}),'Arial required for native comparison').toBe(true);
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const p=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(p);
    const ctx=document.createElement('canvas').getContext('2d');
    const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
    return {pages:l.pages.length,tables:p.tables.map(t=>t.rows.flatMap(r=>r.cells.map(c=>{const b=l.cells.find(b=>b.id===c.id);return {width:b.width*.75,page:b.page};})))};
  },[...source]);
  expect(actual.pages).toBe(cases.length);expect(actual.tables).toHaveLength(ref.tables.length);
  for(const [i,cells] of actual.tables.entries()){
    expect(cells).toHaveLength(ref.tables[i].length);
    for(const [j,c] of cells.entries()){
      expect(c.page).toBe(i);
      const delta=Math.abs(Math.round(c.width*20)-Math.round(ref.tables[i][j].width*20));
      expect(delta,`table ${i+1}, cell ${j+1}, twips`).toBeLessThanOrEqual(cases[i].nowrap?0:1);
    }
  }
  writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Span writing floor/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(cases.length);
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('edited.docx');await(await pending).saveAs(path);
  const before=unzipSync(source),after=unzipSync(readFileSync(path));
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for(const part of Object.keys(before))if(part!=='word/document.xml')expect(after[part],part).toEqual(before[part]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  await reopenDocx(page,input,path,'Edited '+original);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(cases.length);await expect(page.locator('#playground-error')).toBeEmpty();
});
