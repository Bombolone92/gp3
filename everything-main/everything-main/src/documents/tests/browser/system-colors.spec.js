import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/system-colors.docx',ref=JSON.parse(readFileSync('tests/fixtures/system-colors/reference.json'));
test('matches all native system-color controls and retains bindings through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^System color controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
  const actual=await page.evaluate(samples=>{const c=document.querySelector('canvas.canvas-page'),ctx=c.getContext('2d'),s=c.width/612;return samples.map(p=>Array.from(ctx.getImageData(Math.round(p.x*s),Math.round(p.y*s),1,1).data).slice(0,3));},ref.samples);
  // Existing alpha controls allow one 8-bit step for PDF/Canvas compositing.
  // Opaque base colors and tint stay exact, independently of that allowance.
  for(const [i,s] of ref.samples.entries())for(let c=0;c<3;c++)expect(Math.abs(actual[i][c]-s.color[c]),`sample ${i}, channel ${c}`).toBeLessThanOrEqual(s.translucent?1:0);
 };
 await check();writeFileSync(info.outputPath('system-colors.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const initial=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const unchanged=file=>{const out=unzipSync(readFileSync(file));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 unchanged(await save('noedit'));await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
 const shapes=b=>new TextDecoder().decode(b).match(/<wps:wsp\b[\s\S]*?<\/wps:wsp>/g);
 expect(shapes(out['word/document.xml'])).toEqual(shapes(parts['word/document.xml']));expect(shapes(out['word/document.xml'])).toHaveLength(36);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(initial);unchanged(await save('undo'));await reopenDocx(page,input,edited,'Edited '+initial);await check();expect(errors).toEqual([]);
});
