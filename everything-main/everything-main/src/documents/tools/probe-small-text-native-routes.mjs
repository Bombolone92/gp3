import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
// Diagnostic for this independently authored zero-spacing control only.
// Uses installed CSS fonts; never reads font programs or grants Local Font Access.
const [out,url='http://127.0.0.1:5173/playground.html']=process.argv.slice(2);
if(!out)throw Error('Usage: node tools/probe-small-text-native-routes.mjs OUTPUT_PREFIX [PLAYGROUND_URL]');
const source='tests/fixtures/small-text-raster/control.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/small-text-raster/reference.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceSha256=hash(readFileSync(source));
if(sourceSha256!==reference.sourceSha256)throw Error('Control source differs from reference');
if(hash(readFileSync('tests/fixtures/small-text-raster/native.pdf'))!==reference.pdfSha256)throw Error('Native PDF differs from reference');
mkdirSync(dirname(out),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({deviceScaleFactor:3});
 await page.addInitScript(()=>{
  window.nativeScaleCalls=[];
  for(const method of ['fillText','strokeText']){
   const native=CanvasRenderingContext2D.prototype[method];
   CanvasRenderingContext2D.prototype[method]=function(text,x,y,...rest){
    if(this.canvas.isConnected&&this.canvas.classList.contains('canvas-page')&&String(text).trim()){
     const keys=['font','fontKerning','textRendering','direction','textAlign','textBaseline','fillStyle','strokeStyle','lineWidth','lineJoin','lineCap','miterLimit','globalAlpha'];
     const state=Object.fromEntries(keys.map(k=>[k,this[k]]));const m=this.getTransform();
     window.nativeScaleCalls.push({method,text,x,y,rest,...state,matrix:[m.a,m.b,m.c,m.d,m.e,m.f]});
    }
    return native.call(this,text,x,y,...rest);
   };
  }
 });
 await page.goto(url);
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.evaluate(async()=>{const {CanvasEditor}=await import('/tools/reviewed-family-modules.js');const native=CanvasEditor.prototype.paint;CanvasEditor.prototype.paint=function(...args){if(!this.destroyed&&!args[0]?.printing)window.nativeScaleCalls=[];return native.apply(this,args);};});
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await page.waitForFunction(el=>!el.isConnected,old);await page.locator('canvas.canvas-page').first().waitFor();
 await page.waitForFunction(()=>window.nativeScaleCalls.filter(c=>c.fillStyle==='#ffffff').length===12);
 const calls=await page.evaluate(()=>window.nativeScaleCalls);
 if(calls.length!==19||calls.some(c=>c.method!=='fillText'||c.rest.length||c.direction!=='ltr'||!['left','start'].includes(c.textAlign)||c.textBaseline!=='alphabetic'||c.globalAlpha!==1))throw Error('Outside bounded control replay state');
 writeFileSync(`${out}-fresh-calls.json`,JSON.stringify(calls,null,2));
 const result=await page.evaluate(async calls=>{
  const canvas=document.createElement('canvas');canvas.width=2448;canvas.height=3168;
  const ctx=canvas.getContext('2d');const results=[];
  for(const target of [0,64,256,1024,2048]){
   ctx.resetTransform();ctx.fillStyle='#55826b';ctx.fillRect(0,0,canvas.width,canvas.height);
   for(const c of calls){
    for(const k of ['font','fontKerning','textRendering','direction','textAlign','textBaseline','fillStyle','strokeStyle','lineJoin','lineCap','miterLimit','globalAlpha'])ctx[k]=c[k];
    const em=Number(c.font.match(/([\d.]+)px/)[1]);const factor=target?target/em:1;
    ctx.font=c.font.replace(/[\d.]+px/,`${em*factor}px`);
    ctx.lineWidth=c.lineWidth*factor;ctx.letterSpacing='0px';ctx.wordSpacing='0px';
    ctx.setTransform(c.matrix[0]/factor,c.matrix[1]/factor,c.matrix[2]/factor,c.matrix[3]/factor,c.matrix[4],c.matrix[5]);
    ctx[c.method](c.text,c.x*factor,c.y*factor,...c.rest);
   }
   results.push({target,png:canvas.toDataURL()});
  }
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  for(const mode of ['auto','optimizeSpeed','optimizeLegibility','geometricPrecision']){
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2448" height="3168"><rect width="100%" height="100%" fill="#55826b"/>`+
    calls.map(c=>`<g transform="matrix(${c.matrix.join(' ')})"><text x="${c.x}" y="${c.y}" style="font:${esc(c.font)};fill:${c.fillStyle};font-kerning:${c.fontKerning};text-rendering:${mode};letter-spacing:0px;word-spacing:0px">${esc(c.text)}</text></g>`).join('')+'</svg>';
   const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
   try{image.src=url;await image.decode();ctx.resetTransform();ctx.drawImage(image,0,0);results.push({target:'svg-'+mode,png:canvas.toDataURL()});}finally{URL.revokeObjectURL(url);}
  }
  return results;
 },calls);
 for(const r of result){const bytes=Buffer.from(r.png.split(',')[1],'base64');writeFileSync(`${out}-${r.target}.png`,bytes);r.sha256=hash(bytes);delete r.png;}
 if(hash(readFileSync(source))!==sourceSha256)throw Error('Source changed during replay');
 const report={sourceSha256,pdfSha256:reference.pdfSha256,callsSha256:hash(readFileSync(`${out}-fresh-calls.json`)),calls:calls.length,whiteControls:12,
  scope:'Fresh finished-paint replay of the original zero-spacing Latin small-text fixture. Native Canvas compensated em sizes and SVG text-rendering routes; no general shaping, raster equivalence or performance claim.',results:result};
 writeFileSync(`${out}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
