import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/styles-with-effects';
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
for(const control of reference.cases)test(`companion styles preserve native table geometry through edits: ${control.name}`,async({page},info)=>{
 for(const [file,hash]of Object.entries(control.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
 const source=`${folder}/${control.name}.docx`;
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^EffectsParagraph/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async path=>{
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js');
   const {layoutDocument}=await import('/src/engine/layout.js');
   const {pageGeometry}=await import('/src/engine/page-settings.js');
   const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
   const ctx=document.createElement('canvas').getContext('2d');
   const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
   return layout.lines.flatMap(line=>line.fragments.filter(f=>f.image).map(f=>({page:line.page,x:f.x*.75,y:(line.baseline-f.ascent)*.75,width:f.image.width/12700,height:f.image.height/12700})));
  },[...readFileSync(path)]);
  expect(actual).toHaveLength(control.pictures.length);
  for(const [i,picture]of actual.entries()){
   expect(picture.page).toBe(control.pictures[i].page);
   for(const key of ['x','y','width','height'])expect(Math.abs(picture[key]-control.pictures[i][key]),`picture ${i} ${key}`).toBeLessThan(.15);
  }
 };
 await verify(source);
 const png=await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]);writeFileSync(info.outputPath('page.png'),Buffer.from(png,'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),parts=unzipSync(readFileSync(edited));
 expectBodyEditParts(parts,unzipSync(readFileSync(source)));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await verify(edited);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
