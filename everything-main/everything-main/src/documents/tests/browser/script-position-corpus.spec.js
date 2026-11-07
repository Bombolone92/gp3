import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test.use({permissions:['local-fonts']});
const source=process.env.DOCX_SCRIPT_REVIEW_SOURCE;
test('retains the poetry booklet while correcting its script baseline',async({page},info)=>{
 test.skip(!source||!existsSync(source),'Original corpus source supplied through DOCX_SCRIPT_REVIEW_SOURCE.');test.setTimeout(180000);
 const bytes=readFileSync(source);expect(createHash('sha256').update(bytes).digest('hex')).toBe('19a0e264973bd79e528a6962e20e572aecbd48fb69aef6b31d05b7fd9ec190d7');
 await page.addInitScript(()=>{
  window.documentPaints=new WeakMap();const fill=CanvasRenderingContext2D.prototype.fillText,rect=CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(x===0&&y===0&&w>400&&h>700&&this.canvas.classList.contains('canvas-page'))window.documentPaints.set(this.canvas,[]);return rect.call(this,x,y,w,h);};
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   const rows=window.documentPaints.get(this.canvas);
   if(rows){const m=this.getTransform(),scale=this.canvas.width/528,leading=/^\s+/.exec(String(text))?.[0]||'';rows.push({text:String(text),x:(m.a*x+m.c*y+m.e)/scale*.75,inkX:(m.a*(x+this.measureText(leading).width)+m.c*y+m.e)/scale*.75,y:(m.b*x+m.d*y+m.f)/scale*.75,font:this.font,size:Number(/([\d.]+)px/.exec(this.font)?.[1])*Math.hypot(m.a,m.b)/scale*.75});}
   return fill.call(this,text,x,y,...args);
  };
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const paints=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>window.documentPaints.get(c)));
 expect(paints.flat().some(r=>r.text==='th')).toBe(true);writeFileSync(info.outputPath('painted-origins.json'),JSON.stringify(paints,null,2));
 for(const [i,png]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]))).entries())writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png,'base64'));
 const th=await page.evaluate(()=>{
  for(const [page,c]of [...document.querySelectorAll('canvas.canvas-page')].entries()){
   const t=window.documentPaints.get(c)?.find(r=>r.text==='th');if(t)return {x:t.x,y:t.y-t.size/2,page};
  }
 });
 const target=page.locator('canvas.canvas-page').nth(th.page);await target.scrollIntoViewIfNeeded();const b=await target.boundingBox();
 await page.mouse.click(b.x+th.x/396*b.width+2,b.y+th.y/612*b.height);
 const selection=await input.evaluate(e=>({at:e.selectionStart,end:e.selectionEnd,text:e.value}));
 expect(selection.at===selection.end?selection.text.slice(selection.at-2,selection.at+2):selection.text.slice(selection.at,selection.end)).toContain('th');
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const editedText=await input.inputValue(),edited=await save('edited');
 const changed=unzipSync(readFileSync(edited));for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,editedText);expect(errors).toEqual([]);
});
