import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/text-fill-luminance/';
const same=(a,b)=>{expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const[n,v]of Object.entries(b))expect(Buffer.from(a[n]).equals(Buffer.from(v)),n).toBe(true);};
test('paints native luminance fills and retains them through editing and export',async({page},info)=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^MWAV 01/);await expect(input).toBeEditable();
 const original=await input.inputValue(),parts=unzipSync(readFileSync(root+'control.docx'));
 const check=async edited=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
  const result=await page.locator('canvas.canvas-page').evaluate(async(c,{png,cases,edited})=>{
   const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();
   if(c.width!==im.width||c.height!==im.height)throw new Error('Native dimensions differ');
   const native=document.createElement('canvas');native.width=im.width;native.height=im.height;native.getContext('2d').drawImage(im,0,0);
   const w=c.width,h=c.height,a=c.getContext('2d').getImageData(0,0,w,h).data,b=native.getContext('2d').getImageData(0,0,w,h).data;
   return cases.flatMap((t,index)=>{
    if(edited&&index===0||t.native.color.every(v=>v===255))return [];
    const top=Math.floor((t.native.y-22)*4/3),bottom=Math.ceil((t.native.y+5)*4/3),rgb=t.native.color;
    // Compare glyph coverage, including antialiased mixtures with white. A
    // solid-color-only mask loses thin native strokes and falsely reports gaps.
    const vector=rgb.map(v=>255-v),norm=vector.reduce((n,v)=>n+v*v,0);
    const mask=data=>{const out=new Uint8Array(w*(bottom-top));for(let y=top;y<bottom;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4,alpha=vector.reduce((n,v,k)=>n+(255-data[p+k])*v,0)/norm;out[(y-top)*w+x]=alpha>=.15&&alpha<=1.03&&vector.every((v,k)=>Math.abs(data[p+k]-(255-alpha*v))<=4)?1:0;}return out;};
    const am=mask(a),bm=mask(b);
    const compare=(from,to)=>{let count=0,miss=0;for(let i=0;i<from.length;i++)if(from[i]){count++;const x=i%w,y=Math.floor(i/w);let found=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<bottom-top&&to[i+dy*w+dx])found=true;if(!found)miss++;}return {count,miss};};
    return [{index,forward:compare(am,bm),reverse:compare(bm,am)}];
   });
  },{png:readFileSync(root+'native.png').toString('base64'),cases:JSON.parse(readFileSync(root+'reference.json')).cases,edited});
  for(const row of result)for(const direction of ['forward','reverse']){expect(row[direction].count,JSON.stringify(row)).toBeGreaterThan(100);expect(row[direction].miss/row[direction].count,JSON.stringify(row)).toBeLessThan(.01);}
 };
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 await check(false);same(unzipSync(readFileSync(await save('noedit'))),parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edit ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const[n,v]of Object.entries(parts))if(n!=='word/document.xml')expect(Buffer.from(after[n]).equals(Buffer.from(v)),n).toBe(true);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);same(unzipSync(readFileSync(await save('undo'))),parts);
 await reopenDocx(page,input,edited,'Edit '+original);await expect(input).toBeEditable();await check(true);expect(errors).toEqual([]);
});
