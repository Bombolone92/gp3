import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('public/fixtures/doughnut-charts.docx').toString('base64');

test('retains whole-image compositing for chart opacity, filters and shadows',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeImages,paintDecodedImage}=await import('/src/engine/images.js'),{paintImage}=await import('/src/engine/paint-image.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),asset=Object.values(p.assets).find(a=>a.chart),image=(await decodeImages({probe:asset},p.styles.fontAlternatives)).get('probe'),results=[];
  try {for(const state of [{globalAlpha:.4},{globalCompositeOperation:'multiply'},{filter:'blur(1px)'},{shadowColor:'#000000',shadowBlur:3,shadowOffsetX:2}]){
   const render=paint=>{const c=document.createElement('canvas');c.width=400;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='#ABCDEF';ctx.fillRect(0,0,400,400);Object.assign(ctx,state);paint(ctx,image,10.25,12.5,300,300);return ctx.getImageData(0,0,400,400).data;};
   const a=render(paintDecodedImage),b=render(paintImage);results.push({state,matches:a.every((v,i)=>v===b[i])});
  }}finally{image.close();}return results;
 },source);
 for(const resultCase of result)expect(resultCase.matches,JSON.stringify(resultCase)).toBe(true);
});

test('clips direct column-chart ink to the destination frame',async({page})=>{
 await page.goto('/playground.html');
 const changed=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImages,paintDecodedImage}=await import('/src/engine/images.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),asset=Object.values(p.assets).find(a=>a.chart),image=(await decodeImages({probe:asset},p.styles.fontAlternatives)).get('probe');
  try {const c=document.createElement('canvas');c.width=100;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#ABCDEF';ctx.fillRect(0,0,100,100);paintDecodedImage(ctx,image,40,40,12,12);
   const data=ctx.getImageData(0,0,100,100).data;let changed=0;for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(x<40||x>=52||y<40||y>=52){const i=(y*100+x)*4;if(data[i]!==171||data[i+1]!==205||data[i+2]!==239)changed++;}return changed;
  }finally{image.close();}
 },readFileSync('public/fixtures/charts-and-anchors.docx').toString('base64'));
 expect(changed).toBe(0);
});

test('paints decoded charts at fractional page positions and zoom without an intermediate resample',async({page})=>{
 await page.goto('/playground.html');
 const results=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeImages,paintDecodedImage}=await import('/src/engine/images.js');
  const {paintChart}=await import('/src/engine/canvas-charts.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),images=await decodeImages(p.assets,p.styles.fontAlternatives);
  const results=[];
  try {for(const [id,asset]of Object.entries(p.assets).filter(([,a])=>a.chart))for(const zoom of [.75,1,2]){
   const w=asset.width-.25,h=asset.height-.375,x=3.375,y=4.625;
   const canvas=()=>{const c=document.createElement('canvas');c.width=Math.ceil((w+10)*zoom);c.height=Math.ceil((h+10)*zoom);const ctx=c.getContext('2d');ctx.scale(zoom,zoom);ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,w+10,h+10);return ctx;};
   const actual=canvas(),expected=canvas(),before=[...actual.getTransform().toFloat64Array()];
   paintDecodedImage(actual,images.get(id),x,y,w,h);
   expected.translate(x,y);paintChart(expected,asset.chart,w,h);
   const a=actual.getImageData(0,0,actual.canvas.width,actual.canvas.height).data,b=expected.getImageData(0,0,expected.canvas.width,expected.canvas.height).data;
   let differences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;
   results.push({id,zoom,differences,stateRestored:JSON.stringify(before)===JSON.stringify([...actual.getTransform().toFloat64Array()])&&actual.fillStyle==='#ffffff'});
  }} finally {for(const image of images.values())image.close();}
  return results;
 },source);
 expect(results).toHaveLength(48);
 for(const result of results){expect(result.differences,JSON.stringify(result)).toBe(0);expect(result.stateRestored).toBe(true);}
});

test('records completed bitmap and direct chart paint costs on the same decoded controls',async({page},info)=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImages,paintDecodedImage}=await import('/src/engine/images.js'),{paintImage}=await import('/src/engine/paint-image.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),images=await decodeImages(p.assets,p.styles.fontAlternatives);
  const c=document.createElement('canvas');c.width=816;c.height=1056;const ctx=c.getContext('2d'),results={bitmap:[],direct:[]};
  try {for(let round=0;round<8;round++)for(const mode of round%2?['direct','bitmap']:['bitmap','direct']){
   const start=performance.now();
   for(const[id,asset]of Object.entries(p.assets).filter(([,a])=>a.chart)){
    ctx.clearRect(0,0,c.width,c.height);(mode==='direct'?paintDecodedImage:paintImage)(ctx,images.get(id),100.375,120.625,asset.width,asset.height);ctx.getImageData(0,0,c.width,c.height);
   }
   if(round>1)results[mode].push(performance.now()-start);
  }} finally {for(const image of images.values())image.close();}
  return results;
 },source);
 writeFileSync(info.outputPath('paint-cost.json'),JSON.stringify(result,null,2));
 expect(result.bitmap).toHaveLength(6);expect(result.direct).toHaveLength(6);
});
