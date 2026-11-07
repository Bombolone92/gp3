import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
for(const name of ['legacy-table-indent', 'legacy-table-indent-12', 'legacy-table-indent-15', 'legacy-table-origin', 'legacy-table-origin-no-styles', 'legacy-table-origin-custom-style', 'table-style-origin-properties','legacy-table-indent-no-styles','legacy-table-origin-asymmetric','legacy-table-origin-no-styles-asymmetric','legacy-table-origin-left-asymmetric'])test(name+' follows native reference table origins through editing',async({page},info)=>{
 test.setTimeout(90000);
 const source=`public/fixtures/${name}.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/${name}/reference.json`));
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
  expect(images).toHaveLength(ref.pictures.length);
  for(const [i,p]of images.entries()){expect(p.page).toBe(ref.pictures[i].page);expect(p.x).toBeCloseTo(ref.pictures[i].x,1);expect(p.width).toBeCloseTo(ref.pictures[i].width,1);}
 };
 await verify(source);const original=await input.inputValue();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 const sourceParts=unzipSync(readFileSync(source)),editedParts=unzipSync(readFileSync(edited));
 expectBodyEditParts(editedParts,sourceParts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await verify(edited);await expect(page.locator('#playground-error')).toBeEmpty();
});
