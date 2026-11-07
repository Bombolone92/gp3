import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test.use({deviceScaleFactor:2});
for(const negative of [false,true]) {
const source=`public/fixtures/custom-geometry-${negative?'negative':'guides'}.docx`;
const reference=JSON.parse(readFileSync(`tests/fixtures/custom-geometry-guides/${negative?'native-negative-':''}reference.json`,'utf8'));
test(`matches native guide formulas (${negative?'negative':'positive'} coordinates) through undo/export`,async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Custom geometry/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('#playground-error')).toBeEmpty();
 const textX=await page.evaluate(async fixture=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/'+fixture.replace('public/',''))).arrayBuffer()));
  const asset=Object.values(pkg.assets).at(-1),old=OffscreenCanvasRenderingContext2D.prototype.fillText;
  let origin,decoded;
  OffscreenCanvasRenderingContext2D.prototype.fillText=function(text,x,y){if(text==='Inset text'){const m=this.getTransform();origin=(m.a*x+m.e)/2;}return old.call(this,text,x,y);};
  try{decoded=await decodeShape(asset,new Map());return 324+(origin+decoded.left)*.75;}
  finally{OffscreenCanvasRenderingContext2D.prototype.fillText=old;decoded?.close();}
 },source);
 // The reference PDF text matrix x=369.31 pt; this checks the custom shape-space inset.
 expect(Math.abs(textX-369.31)).toBeLessThan(.2);
 const check=async()=>{
  expect(await page.locator('canvas.canvas-page').count()).toBe(1);
  const bounds=await page.evaluate(cases=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.map(c=>{const xs=[],y=Math.round((c.y+18)*scale);for(let x=Math.round((c.x-6)*scale);x<Math.round((c.x+182)*scale);x++){
    const rgb=ctx.getImageData(x,y,1,1).data;if(Math.abs(rgb[0]-32)+Math.abs(rgb[1]-128)+Math.abs(rgb[2]-96)<15)xs.push(x);
   }return{left:Math.min(...xs)/scale,right:(Math.max(...xs)+1)/scale};});
  },reference.cases);
  for(const [i,c] of reference.cases.entries()){
   expect(Math.abs(bounds[i].left-c.nativeLeft),`${c.name} left`).toBeLessThanOrEqual(.6);
   expect(Math.abs(bounds[i].right-c.nativeRight),`${c.name} right`).toBeLessThanOrEqual(.6);
  }
 };
 await check();await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('custom-geometry.png')});
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`custom-geometry${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const saved=await download('');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const before=unzipSync(readFileSync(source)),after=unzipSync(readFileSync(await download('-undo')));
 for(const name of Object.keys(before))expect(Buffer.from(after[name]).equals(Buffer.from(before[name])),name).toBe(true);
 await reopenDocx(page,input,saved,'Edited '+original);await check();
});

}
