import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/autofit-auto-growth',ref=JSON.parse(readFileSync(`${folder}/reference.json`));
for(const name of ['legacy-limit','legacy-wide','modern-wide'])test(name+': matches native automatic growth, margins and alignment',async({page},info)=>{
  await page.goto('/playground.html');
  const installed=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
  test.skip(!installed,'Native reference requires Arial.');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);
  const actual=await page.evaluate(async bytes=>{
    const{DocxPackage}=await import('/src/engine/docx.js');const{layoutDocument}=await import('/src/engine/layout.js');const{pageGeometry}=await import('/src/engine/page-settings.js');const{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
    const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
    return p.tables.map(t=>t.rows.find(r=>r.cells.length===3).cells.map(c=>{const b=l.cells.find(b=>b.id===c.id);return{x:b.x*.75,width:b.width*.75,page:b.page};}));
  },readFileSync(`${folder}/${name}.docx`).toString('base64'));
  for(let i=0;i<10;i++)for(const[j,c]of actual[i].entries()){
    expect(c.page).toBe(i);for(const key of ['x','width'])expect(Math.abs(c[key]-ref[name].pages[i][['left','spacer','right'][j]][key]),`${i}/${j}/${key}`).toBeLessThan(.35);
  }
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
  for(let i=0;i<10;i++)writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('edited.docx');await(await pending).saveAs(path);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await reopenDocx(page,input,path,'Edited '+original);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);await expect(page.locator('#playground-error')).toBeEmpty();
});
