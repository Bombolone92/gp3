import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test.use({deviceScaleFactor:1});
test.describe.configure({timeout:120000});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function open(page,folder){
 await page.goto('/playground.html');
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
 await expect.poll(()=>old.evaluate(el=>el.isConnected)).toBe(false);await old.dispose();
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.evaluate(async()=>{document.activeElement?.blur();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return input;
}
async function footprints(page,cases){
 return page.locator('canvas.canvas-page').evaluate((canvas,cases)=>cases.map(c=>{
  const [l,t,r,b]=c.region,data=canvas.getContext('2d').getImageData(l,t,r-l,b-t).data;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(let y=0;y<b-t;y++)for(let x=0;x<r-l;x++){
   const i=(y*(r-l)+x)*4;
   if((data[i]+data[i+1]+data[i+2])/3<128){left=Math.min(left,x+l);top=Math.min(top,y+t);right=Math.max(right,x+l+1);bottom=Math.max(bottom,y+t+1);}
  }
  return [left,top,right,bottom];
 }),cases);
}
for(const name of ['axis-line-display','axis-line-display-pens']){
 const folder=`tests/fixtures/${name}/`,ref=JSON.parse(readFileSync(folder+'native-screen-reference.json'));
 test(`${name}: thresholded geometric footprints retain the disclosed JPEG endpoint discrepancy`,async({page})=>{
  expect(hash(readFileSync(folder+'control.docx'))).toBe(ref.sourceSha256);
  expect(hash(readFileSync(folder+'cases.json'))).toBe(ref.casesSha256);
  expect(hash(readFileSync(folder+'native-screen-atlas.png'))).toBe(ref.nativeCropSha256);
  await open(page,folder);
  const cases=ref.cases.filter(c=>Math.round(c.penEmu/9525)>1);
  const actual=await footprints(page,cases);
  test.fail(true,'At threshold 128 JPEG half-gray endpoint values straddle the canvas values. Do not make caps opaque to satisfy these bounds.');
  expect(actual).toEqual(cases.map(c=>c.nativeBounds));
 });
 test(`${name}: source, undo and reopened edit preserve drawing parts`,async({page},info)=>{
  const input=await open(page,folder),text=await input.inputValue(),parts=unzipSync(readFileSync(folder+'control.docx'));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+text);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('#playground-error')).toBeEmpty();
 });
 test(`${name}: printing keeps physical pixels across screen and print cache changes`,async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js');
   const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
   const host=document.createElement('div');document.body.append(host);
   const editor=new CanvasEditor(host,{...pkg,images});
   const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const prints=()=>Promise.all(editor.printSheets().map(c=>hash(c.getContext('2d').getImageData(0,0,c.width,c.height).data)));
   const pens=[],proto=OffscreenCanvasRenderingContext2D.prototype,stroke=proto.stroke;
   try{
    proto.stroke=function(...args){const m=this.getTransform();pens.push(this.lineWidth*Math.hypot(m.a,m.b));return stroke.apply(this,args);};
    const first=await prints();proto.stroke=stroke;editor.paint();return {first,second:await prints(),pens};
   }finally{proto.stroke=stroke;editor.destroy();host.remove();}
  },[...readFileSync(folder+'control.docx')]);
  expect(result.second).toEqual(result.first);
  const authored=JSON.parse(readFileSync(folder+'cases.json'));
  expect(result.pens).toHaveLength(authored.length);
  for(let i=0;i<authored.length;i++)expect(result.pens[i]).toBeCloseTo(Math.max(.14,authored[i].penEmu/12700)*192/72,6);
 });
 test(`${name}: dashed controls retain screen pixels and physical print pens`,async({page})=>{
  const parts=unzipSync(readFileSync(folder+'control.docx'));
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('<a:round/>','<a:prstDash val="dash"/><a:round/>'));
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js');
   const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
   const host=document.createElement('div');document.body.append(host);
   const editor=new CanvasEditor(host,{...pkg,images});
   const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const pens=[],proto=OffscreenCanvasRenderingContext2D.prototype,stroke=proto.stroke;
   try{
    const screen=[];for(const c of editor.canvases)screen.push(await hash(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
    proto.stroke=function(...args){const m=this.getTransform();pens.push(this.lineWidth*Math.hypot(m.a,m.b));return stroke.apply(this,args);};
    editor.printSheets();proto.stroke=stroke;
    return {readOnly:!!pkg.readOnly,screen,pens};
   }finally{proto.stroke=stroke;editor.destroy();host.remove();}
  },[...zipSync(parts)]);
  expect(result.readOnly).toBe(false);
  expect(result.screen).toEqual(ref.unchangedDashedScreenAndPrintHashes.slice(0,result.screen.length));
  const authored=JSON.parse(readFileSync(folder+'cases.json'));
  expect(result.pens).toHaveLength(authored.length);
  for(let i=0;i<authored.length;i++)expect(result.pens[i]).toBeCloseTo(Math.max(.14,authored[i].penEmu/12700)*192/72,6);
 });
}
test('one-pixel native line coverage remains an explicit fidelity gap',async({page})=>{
 const folder='tests/fixtures/axis-line-display-pens/',ref=JSON.parse(readFileSync(folder+'native-screen-reference.json'));
 await open(page,folder);const cases=ref.cases.filter(c=>Math.round(c.penEmu/9525)===1);
 const actual=await footprints(page,cases);
 // Navigation, import and measurement errors must fail normally. Only the
 // native footprint comparison below is an expected fidelity failure.
 test.fail(true,'Threshold-128 JPEG endpoint values straddle canvas half-gray values; exact native coverage is unverified.');
 expect(actual).toEqual(cases.map(c=>c.nativeBounds));
});

for(const [name,zoom] of [['axis-line-display',1],['axis-line-display-pens',1],['axis-line-display-pens',.75]]){
 test(`${name}: native dark cores and half-gray caps at ${zoom*100}%`,async({page})=>{
  const folder=`tests/fixtures/${name}/`,ref=JSON.parse(readFileSync(folder+(zoom===1?'native-coverage-reference.json':'native-coverage-reference-75.json')));
  expect(hash(readFileSync(folder+'control.docx'))).toBe(ref.sourceSha256);
  expect(hash(readFileSync(folder+'cases.json'))).toBe(ref.casesSha256);
  expect(hash(readFileSync(folder+ref.nativeCrop))).toBe(ref.nativeCropSha256);
  await open(page,folder);
  await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(zoom));
  await expect(page.locator('canvas.canvas-page')).toHaveJSProperty('width',Math.round(816*zoom));
  const observed=await page.locator('canvas.canvas-page').evaluate(async(canvas,ref)=>{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const ctx=canvas.getContext('2d');return ref.cases.map(c=>{
    const [l,t,r,b]=c.region,data=ctx.getImageData(l,t,r-l,b-t).data;
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(let y=0;y<b-t;y++)for(let x=0;x<r-l;x++){
     const at=(y*(r-l)+x)*4;
     if(Math.max(data[at],data[at+1],data[at+2])<ref.darkThreshold){left=Math.min(left,x+l);top=Math.min(top,y+t);right=Math.max(right,x+l+1);bottom=Math.max(bottom,y+t+1);}
    }
    const grayError=c.grayPixels.reduce((error,[x,y,...native])=>{
     const at=((y-t)*(r-l)+x-l)*4;
     return Math.max(error,...native.map((v,i)=>Math.abs(data[at+i]-v)));
    },0);
    return {id:c.id,darkBounds:[left,top,right,bottom],grayError};
   });
  },ref);
  expect(observed.map(c=>c.darkBounds)).toEqual(ref.cases.map(c=>c.darkBounds));
  for(const c of observed)expect(c.grayError,`case ${c.id}`).toBeLessThanOrEqual(ref.grayMaximumChannelDifference);
 });
}
