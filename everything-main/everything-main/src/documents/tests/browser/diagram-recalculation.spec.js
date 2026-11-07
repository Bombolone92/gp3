import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/diagram-styling',source=unzipSync(readFileSync(`${folder}/control.docx`));
const ref=JSON.parse(readFileSync(`${folder}/reference.json`));
test('recalculates native diagram colors and preserves models through edit, undo and reopen',async({page},info)=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/control.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^style-reference/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
 const original=await input.inputValue();
 const check=async()=>{
  const samples=ref.pages.map(paths=>paths.filter(p=>p.fillMode).map(p=>({x:p.x+p.width/2,y:p.y+p.height/2,rgb:p.fill.slice(0,3)})));
  const differences=await page.locator('canvas.canvas-page').evaluateAll((cs,samples)=>cs.flatMap((c,i)=>{const ctx=c.getContext('2d'),scale=c.width/612;return samples[i].flatMap(p=>{const rgb=[...ctx.getImageData(Math.round(p.x*scale),Math.round(p.y*scale),1,1).data].slice(0,3);return rgb.some((v,j)=>Math.abs(v-p.rgb[j])>2)?[{page:i+1,...p,actual:rgb}]:[];});}),samples);
  expect(differences).toEqual([]);
 };
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const preserve=(path,edited=false)=>{const parts=unzipSync(readFileSync(path));expect(Object.keys(parts).sort()).toEqual(Object.keys(source).sort());for(const key of Object.keys(source))if(!edited||key!=='word/document.xml')expect(Buffer.from(parts[key]).equals(Buffer.from(source[key])),key).toBe(true);};
 await check();preserve(await download('noedit'));
 for(const [i,data]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await download('edited');preserve(edited,true);await check();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);preserve(await download('undo'));await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();expect(errors).toEqual([]);
});
