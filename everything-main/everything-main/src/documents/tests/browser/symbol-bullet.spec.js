import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const source='public/fixtures/symbol-bullet.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/symbol-bullet/reference.json'));
test.use({deviceScaleFactor:3});
for(const missingSymbol of [false,true]) test(`retains Symbol glyph selection through edit/export/reopen (${missingSymbol?'missing font':'host font'})`,async({page},info)=>{
 test.setTimeout(120000);
 for(const[file,hash]of[[source,reference.sourceSha256],['tests/fixtures/symbol-bullet/native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.addInitScript(missingSymbol=>{
  if(missingSymbol){
   // Simulate a host with neither a local Symbol face nor a selectable family.
   // The document, importer and canvasText implementation remain unchanged.
   const NativeFace=FontFace;window.FontFace=class extends NativeFace{
    constructor(name,source,options){super(name,source,options);this.missing=/local\(["']?Symbol["']?\)/.test(source);}
    load(){return this.missing?Promise.reject(new Error('Symbol unavailable in this control')):super.load();}
   };
   const measure=CanvasRenderingContext2D.prototype.measureText;
   CanvasRenderingContext2D.prototype.measureText=function(text){
    const font=this.font;this.font=font.replace(/(?:"Symbol"|Symbol),\s*/, '');
    try{return measure.call(this,text);}finally{this.font=font;}
   };
  }
  window.symbolPaint=[];const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
   if(text==='\uf0b7'||text==='•')window.symbolPaint.push({text,font:this.font,canvas:this.canvas,baseline:(this.getTransform().d*y+this.getTransform().f)/(this.canvas.width/816)*.75});
   return fill.call(this,text,x,y,...rest);
  };
 },missingSymbol);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^S00/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const markers=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/symbol-bullet.docx')).arrayBuffer()));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return layout.lines.filter(l=>l.marker).map(l=>({page:l.page,baseline:l.baseline*.75,x:l.marker.x*.75,width:l.marker.width*.75}));
 });
 expect(markers).toHaveLength(24);
 const fonts=await page.evaluate(async()=>{
  const {fontAvailable}=await import('/src/engine/font-availability.js');
  let reference=false;try{await new FontFace('Independent Symbol probe','local("Symbol")').load();reference=true;}catch{}
  return {available:fontAvailable('Symbol'),reference};
 });
 if(missingSymbol)expect(fonts.available).toBe(false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const actual=await page.evaluate(({markers,cases,available})=>markers.slice(0,8).map((m,i)=>{
   const c=document.querySelectorAll('canvas.canvas-page')[m.page],ctx=c.getContext('2d'),scale=c.width/612,x0=Math.round(70*scale),y0=Math.round((m.baseline-25)*scale),w=Math.round(25*scale),h=Math.round(28*scale),data=ctx.getImageData(x0,y0,w,h).data;
   let left=w,top=h,right=-1,bottom=-1,area=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(Math.max(data[k],data[k+1],data[k+2])<100){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);area++;}}
   const reference=new OffscreenCanvas(w,h),native=reference.getContext('2d');native.fillStyle='white';native.fillRect(0,0,w,h);native.fillStyle='black';
   const factor=scale*.75,control=cases[i];native.scale(factor,factor);
   native.font=`${control.italic?'italic ':''}${control.bold?'bold ':''}${control.size*4/3}px "${available?'Symbol':'Canvas Noto Sans'}"`;
   native.fillText(available?'\uf0b7':'•',(m.x*scale-x0)/factor,(m.baseline*scale-y0)/factor);
   const expected=native.getImageData(0,0,w,h).data;let nl=w,nt=h,nr=-1,nb=-1,na=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(Math.max(expected[k],expected[k+1],expected[k+2])<100){nl=Math.min(nl,x);nr=Math.max(nr,x);nt=Math.min(nt,y);nb=Math.max(nb,y);na++;}}
   return{nativeInk:[(x0+nl)/scale-m.x,(y0+nt)/scale-m.baseline,(x0+nr+1)/scale-m.x,(y0+nb+1)/scale-m.baseline],nativeArea:na/scale**2,ink:[(x0+left)/scale-m.x,(y0+top)/scale-m.baseline,(x0+right+1)/scale-m.x,(y0+bottom+1)/scale-m.baseline],area:area/scale**2};
  }),{markers,cases:reference.cases,available:fonts.available});
  // Compare glyph geometry relative to each baseline. The fixture also retains
  // native absolute baselines to expose the separate exact-line-spacing gap.
  const paint=await page.evaluate(markers=>markers.map(m=>{const p=window.symbolPaint.findLast(p=>p.canvas===document.querySelectorAll('canvas.canvas-page')[m.page]&&Math.abs(p.baseline-m.baseline)<.001);return p&&{text:p.text,font:p.font};}),markers);
  expect(paint).toHaveLength(24);
  for(let i=0;i<8;i++){
   expect(paint[i].text).toBe(fonts.available?'\uf0b7':'•');
   for(let k=0;k<4;k++)expect(Math.abs(actual[i].ink[k]-actual[i].nativeInk[k]),`native glyph edge ${i}`).toBeLessThan(.5);
   expect(Math.abs(actual[i].area-actual[i].nativeArea),`native glyph area ${i}`).toBeLessThan(.5);
   if(!fonts.reference)continue;
   for(let k=0;k<4;k++)expect(Math.abs(actual[i].ink[k]-reference.cases[i].ink[k]),`${i}: ${JSON.stringify(actual[i])}`).toBeLessThan(1);
   expect(actual[i].area/reference.cases[i].area,`glyph area ${i}`).toBeGreaterThan(.65);
   expect(actual[i].area/reference.cases[i].area,`glyph area ${i}`).toBeLessThan(1.35);
  }
 };
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`symbol-bullet-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('edited');expect(Buffer.from(unzipSync(readFileSync(edited))['word/numbering.xml']).equals(Buffer.from(unzipSync(readFileSync(source))['word/numbering.xml']))).toBe(true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();await expect(input).toHaveValue('Edited '+original);await check();
});
