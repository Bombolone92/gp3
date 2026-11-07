import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

test('matches native discretionary hyphens and preserves editing and original bytes',async({page},info)=>{
 const source='public/fixtures/soft-hyphens.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync('tests/fixtures/soft-hyphens/reference.json'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);expect(createHash('sha256').update(readFileSync('tests/fixtures/soft-hyphens/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Soft hyphen control/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const actual=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.filter(l=>l.fragments.some(f=>f.text)).map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0].x*.75,y:l.baseline*.75}));
 },bytes.toString('base64'));
 // The reference PDF maps the discretionary hyphen glyph to U+FFFE. Its visible
 // hyphen was independently inspected; retain the raw mapping in the reference.
 expect(actual.map(l=>l.text)).toEqual(ref.pages[0].map(l=>l.text.replaceAll('\ufffe','-')));
 for(const [i,l]of actual.entries()){expect(Math.abs(l.x-ref.pages[0][i].glyphs[0])).toBeLessThan(.3);expect(Math.abs(l.y-ref.pages[0][i].baseline)).toBeLessThan(.3);}
 const png=await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('page.png'),Buffer.from(png.split(',')[1],'base64'));
 const original=await input.inputValue();expect(original).toContain('extra\u00adordinary');
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const parts=unzipSync(bytes),check=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out)).toEqual(Object.keys(parts));for(const n in parts)if(!edited||n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);};
 check(await save('noedit.docx'));await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Test ');await expect(input).toHaveValue('Test '+original);const edited=await save('edited.docx');check(edited,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await save('undo.docx'));
 page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect(input).toHaveValue('Test '+original);expect(errors).toEqual([]);
});
