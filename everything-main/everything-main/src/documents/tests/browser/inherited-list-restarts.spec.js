import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/inherited-list-restarts.docx',refs=JSON.parse(readFileSync('tests/fixtures/inherited-list-restarts/reference.json'));
test('paints all native reference sequences and preserves numbering through edit, export and undo',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.fillText,clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(/^(?:\d+\.)+$/.test(text))(this.canvas.__markers ||= []).push(text);return original.call(this,text,...args);};
  CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){const t=this.getTransform();if(x===0&&y===0&&w*t.a>=this.canvas.width-1&&h*t.d>=this.canvas.height-1)this.canvas.__markers=[];return fill.call(this,x,y,w,h);};
  CanvasRenderingContext2D.prototype.clearRect=function(...args){this.canvas.__markers=[];return clear.apply(this,args);};
 });
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
 await expect(input).toHaveValue(/^Numbering control 0/);await expect(canvases).toHaveCount(refs.length);
 const check=async()=>{for(const ref of refs){const c=canvases.nth(ref.case);await c.scrollIntoViewIfNeeded();await expect.poll(()=>c.evaluate(el=>el.__markers||[])).toEqual(ref.markers);}};
 await check();const original=await input.inputValue();
 const download=async name=>{const p=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await p).saveAs(path);return path;};
 const unchanged=await download('unchanged.docx');expect(unzipSync(readFileSync(unchanged))).toEqual(unzipSync(readFileSync(source)));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await download('edited.docx'),parts=unzipSync(readFileSync(edited)),before=unzipSync(readFileSync(source));
 expectBodyEditParts(parts,before);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const undo=await download('undo.docx');expect(unzipSync(readFileSync(undo))).toEqual(before);
 await reopenDocx(page,input,edited,'Edited '+original);await check();expect(errors).toEqual([]);
});
