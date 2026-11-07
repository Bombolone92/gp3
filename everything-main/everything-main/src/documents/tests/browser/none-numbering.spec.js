import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/none-numbering/',source=root+'control.docx',native=JSON.parse(readFileSync(root+'reference.json'));
test('paints native literal and suppressed markers through editing, undo and reopen',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Literal text/);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
 const check=async()=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const counts=await page.locator('canvas.canvas-page').evaluateAll((cs,rows)=>rows.map(row=>{
   const c=cs[row.page],ctx=c.getContext('2d'),scale=c.width/612,x=Math.floor(row.bodyBox.x*scale-90*scale*3/4),right=Math.floor(row.bodyBox.x*scale-3),y=Math.max(0,Math.floor(row.bodyBox.top*scale-3)),height=Math.ceil((row.bodyBox.bottom-row.bodyBox.top)*scale+6);
   const pixels=ctx.getImageData(x,y,right-x,height).data;let count=0;
   for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]>80&&pixels[i+1]>40&&pixels[i+2]>pixels[i]+30)count++;
   const bodyX=Math.floor(row.bodyBox.x*scale),body=ctx.getImageData(bodyX-2,y,8,height).data;
   let black=0;for(let i=0;i<body.length;i+=4)if(body[i]<100&&body[i+1]<100&&body[i+2]<100)black++;
   return {count,black};
  }),native.rows);
  for(let i=0;i<counts.length;i++){
   expect.soft(counts[i].count>2,native.rows[i].label+' marker').toBe(!!native.rows[i].marker);
   expect.soft(counts[i].black>2,native.rows[i].label+' native body position').toBe(true);
  }
 };
 await check();const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const preserved=(path,edited=false)=>{const out=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(out,parts);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 preserved(await save('noedit'));await input.focus();await input.evaluate(el=>{const at=el.value.indexOf('C01');el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});await page.keyboard.insertText('Added ');
 await check();const edited=await save('edited');preserved(edited,true);const expected=await input.inputValue();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);preserved(await save('undo'));await check();
 await reopenDocx(page,input,edited,expected);await check();expect(errors).toEqual([]);
});
