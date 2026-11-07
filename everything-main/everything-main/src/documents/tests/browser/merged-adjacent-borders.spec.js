import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const path='tests/fixtures/merged-adjacent-borders/control.docx',bytes=readFileSync(path),reference=JSON.parse(readFileSync('tests/fixtures/merged-adjacent-borders/reference.json'));
test('matches native row padding with adjacent borders and preserves edits',async({page},info)=>{
 test.setTimeout(120000);expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js');await prepareCanvasFont('Arial');return fontAvailable('Arial');});test.skip(!available,'The native reference requires Arial.');
 const rows=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await validateCanvasLayout(p);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles}).lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join(''),x:l.fragments[0]?.x*.75,y:l.baseline*.75})).filter(l=>l.text);
 },bytes.toString('base64'));
 expect(rows).toHaveLength(reference.rows.length);
 for(const ref of reference.rows){const row=rows.find(r=>r.page===ref.page&&r.text===ref.text);expect(row).toBeDefined();expect(Math.abs(row.y-ref.y),JSON.stringify({row,ref})).toBeLessThan(.2);expect(Math.abs(row.x-ref.x)).toBeLessThan(.2);}
 await page.getByLabel('Open DOCX file').setInputFiles(path);const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Control 0/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
 const original=await input.inputValue(),parts=unzipSync(bytes),save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),exported=unzipSync(readFileSync(edited));for(const [n,data] of Object.entries(parts))if(n!=='word/document.xml')expect(exported[n]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
});
