import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/terminal-break-metrics/reference.json','utf8'));
for(const c of reference)test(`matches native terminal break metrics: ${c.name}`,async({page},info)=>{
 const source=`public/fixtures/break-metrics-${c.name}.docx`,bytes=readFileSync(source),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`tests/fixtures/terminal-break-metrics/${c.name}.pdf`)).digest('hex')).toBe(c.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/After/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(c.pages);await expect(page.locator('#playground-error')).toBeEmpty();};
 await check();
 const actual=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables).lines.map(l=>({text:l.fragments.map(f=>f.text).join('').trim(),page:l.page,x:l.fragments[0]?.x*.75,baseline:l.baseline*.75})).filter(l=>l.text);
 },bytes.toString('base64'));
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 expect(actual.map(l=>l.text).sort()).toEqual(c.labels.map(l=>l.text).sort());
 for(const l of actual){const r=c.labels.find(r=>r.text===l.text);expect(l.page,l.text).toBe(r.page);expect(Math.abs(l.baseline-r.baseline),l.text).toBeLessThan(.15);expect(Math.abs(l.x-r.x),l.text).toBeLessThan(.1);}
 for(let i=0;i<c.pages;i++)writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await input.press('ControlOrMeta+Shift+ArrowLeft');await page.keyboard.insertText('Later');await check();
 const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.replace('After','Later'));await check();expect(errors).toEqual([]);
});
