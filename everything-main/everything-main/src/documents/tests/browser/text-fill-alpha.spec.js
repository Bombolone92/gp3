import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/text-fill-alpha/',ref=JSON.parse(readFileSync(root+'reference.json'));
test('matches native translucent fill interiors in body and WPS text and survives editing',async({page},info)=>{
 test.setTimeout(180000);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Text opacity control 1/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
 await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
 const pixels=await page.locator('canvas.canvas-page').evaluateAll((canvases,refs)=>canvases.flatMap((c,i)=>{
  const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data,scale=c.width/612;
  return refs.pages[i].regions.map(r=>{
   const [l,t,rr,b]=r.boxPt.map(v=>Math.round(v*scale)),bg=r.colors[0].rgb,ink=r.colors[1]?.rgb;
   let matches=0,changed=0;
   for(let y=t;y<b;y++)for(let x=l;x<rr;x++){
    const at=(y*c.width+x)*4;
    if(bg.some((v,k)=>Math.abs(v-d[at+k])>2))changed++;
    if(ink&&ink.every((v,k)=>Math.abs(v-d[at+k])<=2))matches++;
   }
   return {page:i+1,region:r.name,transparent:!ink,matches,changed};
  });
 }),ref);
 for(const r of pixels){if(r.transparent)expect(r.changed,JSON.stringify(r)).toBe(0);else expect(r.matches,JSON.stringify(r)).toBeGreaterThan(500);}
 const parts=unzipSync(readFileSync(root+'control.docx')),original=await input.inputValue();
 const same=after=>{expect(Object.keys(after).sort()).toEqual(Object.keys(parts).sort());for(const[n,v]of Object.entries(parts))expect(Buffer.from(after[n]).equals(Buffer.from(v)),n).toBe(true);};
 const save=async n=>{const p=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(n+'.docx');await(await p).saveAs(path);return path;};
 same(unzipSync(readFileSync(await save('noedit'))));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edit ');const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 expectBodyEditParts(out,parts);
 await input.press('ControlOrMeta+z');same(unzipSync(readFileSync(await save('undo'))));
 await reopenDocx(page,input,edited,'Edit '+original);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(12);await expect(page.locator('#playground-error')).toBeEmpty();
});
