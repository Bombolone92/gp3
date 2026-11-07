import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const fixture='public/fixtures/shape-theme.docx';
const samples=JSON.parse(readFileSync('tests/fixtures/shape-theme/samples.json','utf8')).flat();
test('renders theme colors and outline inheritance like the native reference through editing, undo and reopen',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(fixture);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Theme shape probe/);await expect(input).toHaveJSProperty('readOnly',false);
 const text=await input.inputValue();
 const check=async()=>{
  const colors=await page.evaluate(points=>{const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),ratio=canvas.width/816;return points.map(p=>[...ctx.getImageData(Math.round(p.x*4/3*ratio),Math.round(p.y*4/3*ratio),1,1).data].slice(0,3));},samples);
  for(let i=0;i<samples.length;i++)expect(colors[i],JSON.stringify(samples[i])).toEqual(samples[i].rgb);
 };
 await check();await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('shape-theme.png')});
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('shape-theme'+suffix+'.docx');await(await pending).saveAs(path);return path;};
 const saved=await download(''),source=unzipSync(readFileSync(fixture)),parts=unzipSync(readFileSync(saved));
 expect(Object.keys(parts).sort()).toEqual(Object.keys(source).sort());for(const k of Object.keys(source))if(k!=='word/document.xml')expect(Buffer.from(parts[k]).equals(Buffer.from(source[k])),k).toBe(true);
 await check();await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);await check();
 const undo=unzipSync(readFileSync(await download('-undo')));for(const k of Object.keys(source))expect(Buffer.from(undo[k]).equals(Buffer.from(source[k])),k).toBe(true);
 await reopenDocx(page,input,saved,'Edited '+text);await check();expect(errors).toEqual([]);
});
