import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/emf-text/control.docx',reference=JSON.parse(readFileSync('tests/fixtures/emf-text/reference.json'));
test('matches native text bounds and preserves EMF source through edit and reopen',async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const boxes=reference.cases.map(c=>({name:c.name,left:Math.min(...c.glyphs.map(g=>g.left)),right:Math.max(...c.glyphs.map(g=>g.right)),top:Math.min(...c.glyphs.map(g=>g.top)),bottom:Math.max(...c.glyphs.map(g=>g.bottom))}));
 const check=async()=>{
  const ink=await page.locator('canvas.canvas-page').evaluate((canvas,boxes)=>{
   const ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return boxes.map(b=>{let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(let y=Math.floor((b.top-4)*scale);y<Math.ceil((b.bottom+4)*scale);y++)for(let x=Math.floor((b.left-4)*scale);x<Math.ceil((b.right+4)*scale);x++){
     const p=ctx.getImageData(x,y,1,1).data;if(p[2]>p[0]+20&&p[0]<180){left=Math.min(left,x/scale);right=Math.max(right,(x+1)/scale);top=Math.min(top,y/scale);bottom=Math.max(bottom,(y+1)/scale);}
    }return {left,right,top,bottom};});
  },boxes);
  for(let i=0;i<boxes.length;i++)for(const key of ['left','right','top','bottom'])expect(Math.abs(ink[i][key]-boxes[i][key]),`${boxes[i].name} ${key}`).toBeLessThan(1.6);
 };
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async name=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await download).saveAs(path);return path;};
 const edited=await save('edited'),a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));for(const n of Object.keys(a))if(n!=='word/document.xml')expect(b[n]).toEqual(a[n]);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(a);
 await reopenDocx(page,input,edited,'Edited '+original);await check();await expect(page.locator('#playground-error')).toBeEmpty();
});
