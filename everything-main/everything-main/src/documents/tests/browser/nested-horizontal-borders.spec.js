import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const reference=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-horizontal-reference.json','utf8'));
for(const [mode,expected] of Object.entries(reference))test(`paints horizontal table bounds like the native reference: ${mode}`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/Inner line 6/);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const actual=await page.locator('canvas.canvas-page').evaluate(c=>{
  const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data,result={};
  for(const [name,color] of [['outer',[255,241,168]],['inner',[201,231,181]]]){
   let left=Infinity,right=-Infinity;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const at=4*(y*c.width+x);if(color.every((v,i)=>Math.abs(pixels[at+i]-v)<=1)){left=Math.min(left,x);right=Math.max(right,x+1);}}
   result[name]={left:left*612/c.width,right:right*612/c.width};
  }return result;
 });

 for(const [color,bounds] of Object.entries(expected.colors))for(const edge of ['left','right'])expect(Math.abs(actual[color][edge]-bounds[edge]),`${color} ${edge}`).toBeLessThan(1);
 expect(errors).toEqual([]);
});
