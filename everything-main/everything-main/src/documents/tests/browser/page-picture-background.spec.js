import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/page-picture-background/',refs=JSON.parse(readFileSync(root+'reference.json'));
for(const ref of refs)test(`paints native ${ref.name} background through edit, undo and reopen`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+ref.name+'.docx');const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Page picture background/);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const check=async()=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const colors=await page.locator('canvas.canvas-page').evaluateAll((cs,samples)=>samples.map(s=>Array.from(cs[s.page].getContext('2d').getImageData(s.x,s.y,1,1).data).slice(0,3)),ref.samples);
  for(let i=0;i<colors.length;i++)expect(Math.max(...colors[i].map((v,j)=>Math.abs(v-ref.samples[i].rgb[j]))),JSON.stringify(ref.samples[i])).toBeLessThanOrEqual(48);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(readFileSync(root+ref.name+'.docx'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const preserved=(path,edited=false)=>{const out=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(out,parts);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 preserved(await save('noedit'));await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Added ');await check();const edited=await save('edited');preserved(edited,true);const text=await input.inputValue();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();preserved(await save('undo'));
 await reopenDocx(page,input,edited,text);await check();expect(errors).toEqual([]);
});
