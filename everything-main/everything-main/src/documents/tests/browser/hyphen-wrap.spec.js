import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source='public/fixtures/hyphen-wrap.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/hyphen-wrap/reference.json','utf8'));
test('matches native authored-hyphen lines and preserves editing, reopen and exact undo',async({page},info)=>{
 test.setTimeout(90000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/CASE ascii/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async path=>{
  const result=await page.evaluate(async data=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
   const pkg=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
   const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,pkg.styles.fontAlternatives);
   const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
   let arial=false;try{await new FontFace('reference probe','local("Arial")').load();arial=true;}catch{}
   return {arial,lines:pkg.paragraphs.filter((p,i)=>i%2).map(p=>layout.lines.filter(l=>l.paragraphId===p.id).map(l=>l.fragments.map(f=>f.text).join('').trimEnd().replaceAll('\u2011','\u2010')))};
  },readFileSync(path).toString('base64'));
  if(result.arial)expect(result.lines).toEqual(reference.cases.map(c=>c.lines));
  else test.info().annotations.push({type:'native reference',description:'Arial unavailable: exact native font comparison omitted; portable wrapping covered by unit tests.'});
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);await expect(page.locator('#playground-error')).toBeEmpty();
 };
 await check(source);const original=await input.inputValue();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
 const noedit=await save('noedit.docx');await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Test ');await expect(input).toHaveValue('Test '+original);
 const edited=await save('edited.docx');await check(edited);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check(await save('undo.docx'));
 const a=unzipSync(readFileSync(source));
 for(const path of [noedit,info.outputPath('undo.docx')]){const b=unzipSync(readFileSync(path));for(const name of Object.keys(a))expect(Buffer.from(b[name]).equals(Buffer.from(a[name])),name).toBe(true);}
 const e=unzipSync(readFileSync(edited));for(const name of Object.keys(a))if(name!=='word/document.xml')expect(Buffer.from(e[name]).equals(Buffer.from(a[name])),name).toBe(true);
 await reopenDocx(page,input,edited,'Test '+original);await check(edited);
});
