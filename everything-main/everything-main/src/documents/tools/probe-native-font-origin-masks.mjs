// Diagnose character-position oracles against actual Canvas painting. This uses
// installed CSS fonts without Local Font Access, font-program reads or changes.
import {chromium} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const output=process.argv[2];
if(!output)throw Error('Usage: node tools/probe-native-font-origin-masks.mjs <output.json>');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/playground.html');
 await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const cases=await page.evaluate(async()=>{
  const {fontAvailable,checkFontAvailability}=await import('/tools/reviewed-family-modules.js');
  const rows=[];
  for(const family of ['Garamond','Arial','Times New Roman']){
   await checkFontAvailability(family);
   if(!fontAvailable(family))throw Error(`Required installed family unavailable: ${family}`);
   for(const sizePt of [12,28,60])for(const kern of ['none','normal'])for(const spacingPt of [0,.5,-.5]){
    const text='Poetry AV To Wa';
    const init=()=>{
     const c=document.createElement('canvas'),ctx=c.getContext('2d');
     ctx.font=`${sizePt*4/3}px "${family}"`;ctx.fontKerning=kern;ctx.letterSpacing=`${spacingPt*4/3}px`;ctx.textRendering='optimizeSpeed';
     return{c,ctx};
    };
    const measured=init(),width=measured.ctx.measureText(text).width;
    const canvasWidth=Math.ceil(width+64),canvasHeight=Math.ceil(sizePt*4/3*2+64),baseline=32+sizePt*4/3;
    const create=()=>{
     const {c,ctx}=init();c.width=canvasWidth;c.height=canvasHeight;
     ctx.font=measured.ctx.font;ctx.fontKerning=kern;ctx.letterSpacing=measured.ctx.letterSpacing;ctx.textRendering='optimizeSpeed';
     return{c,ctx};
    };
    const actual=create();actual.ctx.fillText(text,32,baseline);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),node=document.createElementNS(svg.namespaceURI,'text');
    Object.assign(svg.style,{position:'fixed',visibility:'hidden',width:'1px',height:'1px',overflow:'visible'});
    Object.assign(node.style,{font:actual.ctx.font,fontKerning:kern,letterSpacing:actual.ctx.letterSpacing,textRendering:'optimizeSpeed',fontVariantLigatures:'none',whiteSpace:'pre'});
    node.textContent=text;svg.append(node);document.body.append(svg);
    try{
     const origins={svg:Array.from({length:text.length},(_,i)=>node.getStartPositionOfChar(i).x),
      suffix:Array.from({length:text.length},(_,i)=>width-actual.ctx.measureText(text.slice(i)).width)};
     const original=actual.ctx.getImageData(0,0,canvasWidth,canvasHeight).data,candidates={};
     for(const [method,starts]of Object.entries(origins)){
      const layer=create();layer.ctx.fontKerning='none';
      [...text].forEach((ch,i)=>layer.ctx.fillText(ch,32+starts[i],baseline));
      const pixels=layer.ctx.getImageData(0,0,canvasWidth,canvasHeight).data;
      let differentPixels=0,alphaAbsoluteError=0;
      for(let i=3;i<pixels.length;i+=4){if(pixels[i]!==original[i])differentPixels++;alphaAbsoluteError+=Math.abs(pixels[i]-original[i]);}
      candidates[method]={differentPixels,alphaAbsoluteError,originsPt:starts.map(x=>x*.75)};
     }
     rows.push({family,sizePt,kern,spacingPt,text,canvasAdvancePx:width,svgAdvancePx:node.getComputedTextLength(),
      maxSvgSuffixDifferencePt:Math.max(...origins.svg.map((x,i)=>Math.abs(x-origins.suffix[i])))*.75,candidates});
    }finally{svg.remove();}
   }
  }
  return rows;
 });
 const result={scope:'Unligated LTR ASCII, regular installed CSS faces. Exact alpha-mask reconstruction checks browser character-position proxies; no native reference or general shaping equivalence claimed.',cases};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,svgExact:cases.filter(c=>!c.candidates.svg.differentPixels).length,suffixExact:cases.filter(c=>!c.candidates.suffix.differentPixels).length,
  neitherExact:cases.filter(c=>c.candidates.svg.differentPixels&&c.candidates.suffix.differentPixels).length,
  maxSvgSuffixDifferencePt:Math.max(...cases.map(c=>c.maxSvgSuffixDifferencePt))}));
}finally{await browser.close();}
