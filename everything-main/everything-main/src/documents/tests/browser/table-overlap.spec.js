import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/table-overlap/';
for(const name of ['probe','width','gap','words'])test(`matches native table collision placement through edit and export: ${name}`,async({page},info)=>{
 const source=folder+name+'.docx',ref=JSON.parse(readFileSync(folder+name+'-reference.json'));
 test.setTimeout(120000);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
 test.skip(!available,'Requires installed Arial; the reference font is not redistributed.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^(A row|Before)/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const pkg=await DocxPackage.open(new Uint8Array(bytes));
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');await loadCanvasFonts(pkg);
  const {layoutDocument,caretRect,hitTest}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const hits=[];
  for(const line of l.lines.filter(l=>!l.virtual&&l.fragments.some(f=>f.text))){const c=caretRect(l,line.start);if((l.floatingTables.filter(f=>f.page===line.page).length<2||l.floatingTables.filter(f=>f.page===line.page).some(f=>f.overlap==='never')) && hitTest(l,c.page,c.x,c.y+c.height/2)!==line.start)hits.push(line.start);}
  return {hits,pages:l.pages.map((_,i)=>l.lines.filter(l=>l.page===i).map(l=>({text:l.fragments.map(f=>f.text).join('').replace(/\s/gu,''),x:l.stops[0].x*.75,y:l.baseline*.75})).filter(l=>l.text))};
 },[...readFileSync(source)]);
 expect(actual.hits).toEqual([]);expect(actual.pages).toHaveLength(ref.pages.length);
 for(const [i,lines] of ref.pages.entries()){
  const a=actual.pages[i].toSorted((a,b)=>a.text.localeCompare(b.text)),expected=lines.toSorted((a,b)=>a.text.localeCompare(b.text));
  expect(a.map(l=>l.text)).toEqual(expected.map(l=>l.text));
  for(const [j,l] of expected.entries()){expect(Math.abs(a[j].y-l.y)).toBeLessThan(.2);expect(Math.abs(a[j].x-l.x)).toBeLessThan(.35);}
 }
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
});

test('keeps an unbroken word below a floating table when no side interval fits it',async({page})=>{
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
 test.skip(!available,'Requires installed Arial; the reference font is not redistributed.');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(bytes));
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');await loadCanvasFonts(p);
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.lines.filter(l=>l.page===11&&!l.cellId).map(l=>({text:l.fragments.map(f=>f.text).join('').replace(/\s/gu,''),y:l.baseline*.75}));
 },[...readFileSync(folder+'width.docx')]);
 const ref=JSON.parse(readFileSync(folder+'width-reference.json')).pages[11].filter(l=>l.text.startsWith('Anchor'));
 expect(actual.map(l=>l.text)).toEqual(ref.map(l=>l.text));
 for(const [i,l] of ref.entries())expect(Math.abs(actual[i].y-l.y)).toBeLessThan(.2);
});
