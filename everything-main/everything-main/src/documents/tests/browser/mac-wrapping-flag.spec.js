import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/mac-wrapping-flag/',ref=JSON.parse(readFileSync(root+'reference.json'));
for(const name of ['empty','false','true','zero','one'])test(`preserves Mac wrapping flag ${name} without changing paint`,async({page},info)=>{
 test.setTimeout(90000);
 for(const variant of ['absent',name]){
  const r=ref.variants[variant];expect(r.rasterSha256).toEqual(ref.variants.absent.rasterSha256);
  for(const [file,sha]of [[variant+'.docx',r.sourceSha256],[variant+'-native.pdf',r.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(sha);
 }
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const input=page.getByRole('textbox',{name:'Document text'});
 const open=async path=>{const old=await input.elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(path);await expect.poll(()=>old.evaluate(el=>el.isConnected)).toBe(false);await old.dispose();await expect(input).toHaveJSProperty('readOnly',false);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 const pixels=()=>page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()));
 await open(root+'absent.docx');const baseline=await pixels();await open(root+name+'.docx');expect(await pixels()).toEqual(baseline);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.variants[name].rasterSha256.length);
 writeFileSync(info.outputPath('page2.png'),Buffer.from(baseline[1].split(',')[1],'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(root+name+'.docx'));
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 const sameParts=(path,edited=false)=>{const out=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(out,parts);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const [n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 sameParts(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');sameParts(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);sameParts(await save('undo'));
 await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
