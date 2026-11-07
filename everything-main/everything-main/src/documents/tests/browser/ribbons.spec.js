import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/ribbons/';
for(const [source,reference,imageName,pdf]of [['control.docx','reference.json','native.png','native.pdf'],['colors.docx','colors-reference.json','colors-native.png','colors-native.pdf'],['fills.docx','fills-reference.json','fills-native.png','fills-native.pdf']])test(`matches native ribbon ${source} through edit, undo and reopen`,async({page},info)=>{
 const png=readFileSync(root+imageName),ref=JSON.parse(readFileSync(root+reference));
 expect(createHash('sha256').update(png).digest('hex')).toBe(ref.pngSha256);
 expect(createHash('sha256').update(readFileSync(root+source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+pdf)).digest('hex')).toBe(ref.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults/);await expect(input).toBeEditable();
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const stats=await page.locator('canvas.canvas-page').evaluate(async(canvas,uri)=>{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const image=new Image();image.src=uri;await image.decode();
   const c=document.createElement('canvas');c.width=816;c.height=1056;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
   const native=ctx.getImageData(0,0,816,1056).data;ctx.clearRect(0,0,816,1056);ctx.drawImage(canvas,0,0,816,1056);
   const actual=ctx.getImageData(0,0,816,1056).data;
   let mismatch=0,count=0,flatCount=0,flatMismatch=0;
   // Exclude the fixture heading (font fallback is unrelated). Check both
   // directions within one pixel to tolerate native/browser antialiasing.
   for(let y=110;y<840;y+=2)for(let x=40;x<740;x+=2)for(const[a,b]of[[native,actual],[actual,native]]){
    const i=(y*816+x)*4;if(a[i]>245&&a[i+1]>245&&a[i+2]>245)continue;count++;let matched=false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const j=((y+dy)*816+x+dx)*4;if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[j+k])))<=48)matched=true;
    }
    if(!matched)mismatch++;
   }
   for(let y=114;y<836;y+=4)for(let x=44;x<736;x+=4){
    const i=(y*816+x)*4;if(native[i]>245&&native[i+1]>245&&native[i+2]>245)continue;
    let flat=true;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
     const j=((y+dy)*816+x+dx)*4;
     if([0,1,2].some(k=>native[i+k]!==native[j+k]))flat=false;
    }
    if(flat){flatCount++;if([0,1,2].some(k=>Math.abs(native[i+k]-actual[i+k])>2))flatMismatch++;}
   }
   return {mismatch,count,flatCount,flatMismatch};
  },'data:image/png;base64,'+png.toString('base64'));
  expect(stats.count).toBeGreaterThan(20000);expect(stats.mismatch/stats.count,JSON.stringify(stats)).toBeLessThan(.005);
  expect(stats.flatCount).toBeGreaterThan(100);expect(stats.flatMismatch/stats.flatCount,JSON.stringify(stats)).toBeLessThan(.005);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(readFileSync(root+source));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const preserved=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 preserved(await save('noedit'));await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Added ');await check();const edited=await save('edited');preserved(edited,true);const text=await input.inputValue();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();preserved(await save('undo'));
 await reopenDocx(page,input,edited,text);await check();expect(errors).toEqual([]);
});
