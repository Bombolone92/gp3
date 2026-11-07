import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/cell-row-context',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
for(const name of ['control','merge'])test(`${name}: matches native row-boundary contextual spacing and preserves editing`,async({page},info)=>{
  test.setTimeout(120000);await page.goto('/playground.html');
  const installed=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});test.skip(!installed,'Native reference requires Arial.');
  const source=readFileSync(`${folder}/${name}.docx`);await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^(Case|Merge)/);await expect(input).toHaveJSProperty('readOnly',false);
  const actual=await page.evaluate(async bytes=>{
    const{DocxPackage}=await import('/src/engine/docx.js');const{layoutDocument}=await import('/src/engine/layout.js');const{pageGeometry}=await import('/src/engine/page-settings.js');const{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const c=document.createElement('canvas').getContext('2d');
    return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.map(l=>({text:l.fragments.map(f=>f.text||'').join(''),page:l.page,x:l.stops[0]?.x*.75,y:l.baseline*.75}));
  },source.toString('base64'));
  for(const ref of refs[name].lines){const line=actual.find(l=>l.page===ref.page&&l.text===ref.text);expect(line,ref.text).toBeDefined();for(const key of ['x','y'])expect(Math.abs(line[key]-ref[key]),`${ref.page}/${ref.text}/${key}`).toBeLessThan(.2);}
  await expect(page.locator('canvas.canvas-page')).toHaveCount(refs[name].pages);
  for(let i=0;i<refs[name].pages;i++)writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}-edited.docx`);await(await pending).saveAs(path);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await reopenDocx(page,input,path,'Edited '+original);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(refs[name].pages);await expect(page.locator('#playground-error')).toBeEmpty();
});
