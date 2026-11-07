import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/group-reflections/',source=root+'control.docx';
test('matches native group reflections including nested rotation, overflow and editing',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
 for(const [name,hash] of Object.entries(ref))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Independent group reflection/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const result=await page.locator('canvas.canvas-page').evaluate(async(c,{png,cases})=>{
   const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();
   const native=document.createElement('canvas');native.width=im.width;native.height=im.height;native.getContext('2d').drawImage(im,0,0);
   if(c.width!==im.width||c.height!==im.height)throw new Error('Reference dimension mismatch');
   const w=c.width,h=c.height,a=c.getContext('2d').getImageData(0,0,w,h).data,b=native.getContext('2d').getImageData(0,0,w,h).data;
   return cases.map(t=>{
    const rgb=t.color.match(/../g).map(x=>parseInt(x,16));
    const mask=data=>{const v=new Uint8Array(w*h);for(let i=0;i<v.length;i++)v[i]=rgb.every((x,k)=>Math.abs(data[i*4+k]-x)<=3)?1:0;return v;};
    const am=mask(a),bm=mask(b);
    const compare=(from,to)=>{let count=0,miss=0;for(let i=0;i<from.length;i++)if(from[i]){count++;const x=i%w,y=Math.floor(i/w);let found=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&to[i+dy*w+dx])found=true;if(!found)miss++;}return {count,miss};};
    return {name:t.name,forward:compare(am,bm),reverse:compare(bm,am)};
   });
  },{png:readFileSync(root+'native.png').toString('base64'),cases:JSON.parse(readFileSync(root+'cases.json'))});
  for(const c of result)for(const direction of ['forward','reverse']){expect(c[direction].count,c.name).toBeGreaterThan(500);expect(c[direction].miss/c[direction].count,JSON.stringify(c)).toBeLessThan(.01);}
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await event).saveAs(p);return p;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
