// Read-only body text-placement diagnostic; output may contain private text.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const [source,output,baseURL='http://127.0.0.1:5173']=process.argv.slice(2);
if(!source||!output)throw new Error('Usage: node tools/capture-body-char-origins.mjs SOURCE.docx OUTPUT.json [BASE_URL]');
if(resolve(source).toLowerCase()===resolve(output).toLowerCase())throw new Error('Output must differ from the read-only source.');
const bytes=readFileSync(source),hash=data=>createHash('sha256').update(data).digest('hex');
const sourceSha256=hash(bytes),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 // Comparison captures keep embedded programs opaque. A null source means
 // "no embedded face" and preserves ordinary CSS local-font preparation;
 // an empty array instead intercepts that path and declares it unavailable.
 await page.route(/\/src\/engine\/embedded-fonts\.js(?:\?.*)?$/,route=>route.fulfill({
  contentType:'text/javascript',
  body:'export const decodeEmbeddedFont=()=>null,isEmbeddedFont=()=>false,embeddedPreviewOnly=()=>false,embeddedFontSources=()=>null,documentEmbeddedFonts=()=>new Map();',
 }));
 await page.goto(new URL('/playground.html',baseURL).href,{timeout:180000});
 const result=await page.evaluate(async bytes=>{
  const guard=await import('/src/engine/embedded-fonts.js');
  if(guard.decodeEmbeddedFont.toString()!=='()=>null'||guard.embeddedFontSources.toString()!=='()=>null'||guard.documentEmbeddedFonts.toString()!=='()=>new Map()')throw Error('Opaque font capture guard was not installed.');
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {capitalizationParts}=await import('/src/engine/capitalization.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{
   let expandingCapitalizationExcluded=0,nonSourceSpanExcluded=0;
   const lines=editor.layout.lines.filter(l=>!l.cellText).map(l=>{
     const chars=[];
     for(const fragment of l.fragments){
      if(fragment.image||!fragment.text||fragment.start===undefined)continue;
      if(fragment.end-fragment.start!==fragment.text.length){nonSourceSpanExcluded+=fragment.text.length;continue;}
      let offset=fragment.start;
      for(const char of fragment.text){
       const stop=l.stops.find(s=>s.offset===offset);
       const displayed=capitalizationParts(char,fragment)?.map(part=>part.text).join('')??char;
       // One source caret cannot identify the individual origins of multiple
       // painted glyphs. Disclose expansions instead of inventing positions.
       if([...displayed].length!==1)expandingCapitalizationExcluded++;
       else if(!/\s/u.test(char)&&stop)chars.push({text:displayed,x:stop.x*.75,
        y:(l.baseline+(fragment.textTransform?.offsetY||0))*.75});
       offset+=char.length;
      }
     }
     return {page:l.page+1,text:l.fragments.filter(f=>!f.image).map(f=>f.text||'').join(''),chars};
    }).filter(l=>l.chars.length);
   return {opaqueFontGuardVerified:true,
    embeddedFontPrograms:'Opaque; decoding/registration disabled. Ordinary CSS local fonts and approved bundled fonts remain available.',
    pages:editor.canvases.length,readOnly:!!pkg.readOnly,
    rotatedExcluded:editor.layout.lines.filter(l=>l.cellText).length,
    expandingCapitalizationExcluded,
    nonSourceSpanExcluded,
    scope:'Body horizontal non-whitespace caret origins and display baselines/case; excludes uppercase expansions, non-source spans (such as atomic field caches), rotated cells, drawing text and page stories.',lines};
  }finally{editor.destroy();host.remove();for(const image of images.values())image.close();}
 },[...bytes]);
 if(hash(readFileSync(source))!==sourceSha256)throw new Error('Source changed during capture.');
 writeFileSync(output,JSON.stringify({sourceSha256,...result},null,2)+'\n');
 console.log(JSON.stringify({sourceSha256,pages:result.pages,lines:result.lines.length,chars:result.lines.reduce((n,l)=>n+l.chars.length,0),rotatedExcluded:result.rotatedExcluded}));
}finally{await browser.close();}
