import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/script-line-boxes/',source=root+'script-line-boxes.docx';
const ref=JSON.parse(readFileSync(root+'reference.json'));
test('allocates native script lines using declared font metrics and explicit position',async({page},info)=>{
 test.setTimeout(120000);
 for(const [p,h]of [[source,ref.sourceSha256],[root+'script-line-boxes-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(p)).digest('hex')).toBe(h);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(30);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(p);const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.pages.map((_,i)=>Object.fromEntries(l.lines.filter(l=>l.page===i).flatMap(l=>{const t=l.fragments.map(f=>f.text).join('').trim();return ['Before','After'].includes(t)||t.startsWith('Start')?[[t.startsWith('Start')?'Start':t,l.baseline*.75]]:[];})));
 },[...readFileSync(source)]);
 writeFileSync(info.outputPath('baselines.json'),JSON.stringify(actual,null,2));
 for(const [i,r]of ref.pages.entries())for(const [key,value]of Object.entries(r))expect(Math.abs(actual[i][key]-value),`page ${i+1} ${key}`).toBeLessThan(.2);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)expectBodyEditParts(out,parts);else for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');same(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));await reopenDocx(page,input,edited,'Edited '+original);expect(errors).toEqual([]);
});
