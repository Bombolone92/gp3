import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shading-spacing/';
for(const name of ['mode14-before6','mode14-before30','mode15-before6','mode15-before30'])test(`native paragraph-shading spacing: ${name}`,async({page},info)=>{
 test.setTimeout(120000);const source=root+name+'.docx',ref=JSON.parse(readFileSync(root+name+'-reference.json'));
 for(const [file,hash]of [[source,ref.sourceSha256],[root+name+'-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{paragraphBackgrounds}=await import('/src/engine/paragraph-backgrounds.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);const c=document.createElement('canvas').getContext('2d'),g=pageGeometry(pkg.pageSettings),l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(c,t,s),g,pkg.numbering,pkg.tables);
  return l.pages.map((_,i)=>{
   const lines=l.lines.filter(l=>l.page===i),backgrounds=paragraphBackgrounds(lines,g,l.cells),baselines={};
   for(const line of lines){const text=line.fragments.map(f=>f.text).join('').trim();if(['Before','Shaded','Following','After'].includes(text))baselines[text]=line.baseline*.75;}
   const bands=[...new Set([...backgrounds.values()].map(b=>b.rect).filter(Boolean))].map(b=>({color:b.color.slice(1),y:b.y*.75,height:b.height*.75})).sort((a,b)=>a.y-b.y);
   return {bands,baselines};
  });
 },[...readFileSync(source)]);
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));expect(actual).toHaveLength(ref.pages.length);
 for(const [i,r]of ref.pages.entries()){
  expect(actual[i].bands).toHaveLength(r.bands.length);
  for(const [j,b]of r.bands.entries()){const a=actual[i].bands[j];expect(a.color).toBe(b.color);for(const key of ['y','height'])expect(Math.abs(a[key]-b[key]),`page ${i+1} band ${j+1} ${key}`).toBeLessThan(.2);}
  for(const [text,y]of Object.entries(r.baselines))expect(Math.abs(actual[i].baselines[text]-y),`page ${i+1} ${text}`).toBeLessThan(.2);
 }
 for(const i of [3,6])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 expectBodyEditParts(changed,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
