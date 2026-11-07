import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
test.use({deviceScaleFactor:3});
for (const fixture of ['preset-lines', 'connectors']) {
const reference=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`,'utf8'));
test(`matches native ${fixture} positions and physical strokes through nested groups, editing and undo`,async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${fixture}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Line geometry/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const actual=await page.evaluate(cases=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.map(c=>{
    const pts=[];let red=0;
    const left=Math.round((c.x-30)*scale),top=Math.round((c.y-20)*scale),w=Math.round(180*scale),h=Math.round(120*scale),pixels=ctx.getImageData(left,top,w,h).data;
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
     const at=(yy*w+xx)*4,r=pixels[at],g=pixels[at+1],b=pixels[at+2];
     if(Math.abs(r-32)+Math.abs(g-128)+Math.abs(b-96)<30)pts.push([xx+left,yy+top]);
     if(r>180&&g<80&&b<80)red++;
    }
    const bounds=pts.length?[Math.min(...pts.map(p=>p[0]))/scale,Math.min(...pts.map(p=>p[1]))/scale,(Math.max(...pts.map(p=>p[0]))+1)/scale,(Math.max(...pts.map(p=>p[1]))+1)/scale]:null;
    const sections=c.sections.map(row=>{const hits=pts.filter(p=>p[row.axis==='y'?1:0]===Math.round(row.at*scale)).map(p=>p[row.axis==='y'?0:1]);return hits.length?[Math.min(...hits)/scale,(Math.max(...hits)+1)/scale]:null;});
    return{bounds,sections,red};
   });
  },reference.cases);
  const compare=(actual,expected,label)=>{expect(Boolean(actual),label).toBe(Boolean(expected));if(expected)for(let i=0;i<expected.length;i++)expect(Math.abs(actual[i]-expected[i]),label).toBeLessThanOrEqual(.75);};
  for(const [i,c] of reference.cases.entries()){
   expect(actual[i].red,`${c.name} must not fill`).toBe(0);compare(actual[i].bounds,c.bounds,`${c.name} bounds`);
   for(const [j,row] of c.sections.entries())compare(actual[i].sections[j],row.interval,`${c.name} ${row.axis}=${row.at}`);
  }
 };
 await check();writeFileSync(info.outputPath('preset-lines.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`preset-lines${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(`public/fixtures/${fixture}.docx`)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 await reopenDocx(page,input,edited,'Edited '+original);await check();
});

}
