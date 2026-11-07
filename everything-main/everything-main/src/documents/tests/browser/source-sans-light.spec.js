import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const name of ['source-sans-light','source-sans-family'])test(name+' matches native advances through editing',async({page},info)=>{
 test.setTimeout(90000);
 const source=`tests/fixtures/${name}/control.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/${name}/reference.json`));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`tests/fixtures/${name}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/\ufffc/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async path=>{
  const images=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{TextDocument}=await import('/src/engine/model.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
   const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),ctx=document.createElement('canvas').getContext('2d');
   const placed=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
   return placed.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({page:l.page,x:f.x*.75,width:f.width*.75})));
  },readFileSync(path).toString('base64'));
  writeFileSync(info.outputPath(path===source?'native-comparison.json':'edited-comparison.json'),JSON.stringify(images.map((p,i)=>({...p,nativeX:ref.pictures[i].x,delta:p.x-ref.pictures[i].x})),null,2));
  expect(images).toHaveLength(ref.pictures.length);
  for(const [i,p]of images.entries()){expect(p.page).toBe(ref.pictures[i].page);
   // All regular-family and Black origins match tightly. Remaining Light
   // italic-version and synthetic-bold advance gaps are documented.
   const tight=name==='source-sans-family'?[0,1,2,3,4,5,6,7]:[0,1,2,3,4];
   expect(Math.abs(p.x-ref.pictures[i].x)).toBeLessThan(tight.includes(i)?.1:1.25);expect(p.width).toBeCloseTo(ref.pictures[i].width,1);}
 };
 await verify(source);const original=await input.inputValue();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await verify(edited);await expect(page.locator('#playground-error')).toBeEmpty();
});
