import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/font-name-spaces.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/font-name-spaces/reference.json','utf8'));
test('matches native whitespace font names without changing source declarations',async({page},info)=>{
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/font-name-spaces/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html');await expect(page.getByRole('textbox',{name:'Document text'})).toBeVisible();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Whitespace font control/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
    const {fontAvailable}=await import('/src/engine/font-availability.js');
    const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
    const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings));
    return {available:['Arial','Arial ',' Arial','  Arial  ','Times New Roman ','Courier New ','Arial\u00a0'].map(fontAvailable),pages:layout.pages.map((_,p)=>layout.lines.filter(l=>l.page===p).map(l=>({text:l.fragments.map(f=>f.text).join('').trimEnd(),baseline:l.baseline*.75,glyphs:l.stops.filter(s=>s.offset<l.end).map(s=>s.x*.75)})))};
  },readFileSync(source).toString('base64'));
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
  writeFileSync(info.outputPath('rendered.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  expect(actual.available).toEqual(Array(7).fill(true));
  expect(actual.pages.map(p=>p.map(l=>l.text))).toEqual(reference.pages.map(p=>p.map(l=>l.text)));
  for(const [i,lines] of actual.pages.entries())for(const [j,l] of lines.entries()){
    const ref=reference.pages[i][j];expect(Math.abs(l.baseline-ref.baseline),l.text).toBeLessThan(.2);

  }
  // The native reference and the browser must each make whitespace variants exactly equal
  // to their canonical family. Existing canonical-font shaping drift is separate.
  for(const [variant,canonical] of [[1,0],[2,0],[3,0],[5,4],[7,6],[8,0],[9,0],[11,10]]){
    expect(reference.pages[0][variant].glyphs).toEqual(reference.pages[0][canonical].glyphs);
    expect(actual.pages[0][variant].glyphs).toEqual(actual.pages[0][canonical].glyphs);
  }
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async n=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(n+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
