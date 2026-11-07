// Compare all-page painting for a selected local cohort against an explicit
// historical SVG group and preparation modules. Source files and PNGs stay private.
// Usage: node tools/compare-svg-group-corpus.mjs ROOT COHORT_JSON OUTPUT_DIR BASELINE_REV
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const [root,cohortPath,out,revision]=process.argv.slice(2);
if(!root||!cohortPath||!out||!revision||!/^\w{7,40}$/.test(revision))throw Error('Supply ROOT COHORT_JSON OUTPUT_DIR BASELINE_REV');
const baseline=execFileSync('git',['show',`${revision}:src/engine/svg-native-groups.js`],{encoding:'utf8'});
const baselineStrokes=execFileSync('git',['show',`${revision}:src/engine/svg-native-strokes.js`],{encoding:'utf8'});
const baselineUses=execFileSync('git',['show',`${revision}:src/engine/svg-use.js`],{encoding:'utf8'});
const selection=JSON.parse(readFileSync(cohortPath,'utf8'));
const cohort=Array.isArray(selection)?selection:selection.rows;
mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={baselineRevision:revision,baselineModuleSha256:sha(baseline),baselineStrokesModuleSha256:sha(baselineStrokes),baselineUsesModuleSha256:sha(baselineUses),scope:'All-page canvas pixels and geometry; not native reference visual fidelity or editing certification.',rows:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const pixelPage=await browser.newPage();
 for(const [index,source] of cohort.entries()){
  const file=resolve(root,source.file);if(!file.startsWith(resolve(root)+sep))throw Error('Source is outside corpus root');
  const bytes=readFileSync(file),variants={};
  for(const variant of ['baseline','current']){
   const context=await browser.newContext({viewport:{width:1500,height:1200}}),page=await context.newPage();
   try{
    if(variant==='baseline') {
     await page.route(/\/src\/engine\/svg-native-groups\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:baseline}));
     await page.route(/\/src\/engine\/svg-native-strokes\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:baselineStrokes}));
     await page.route(/\/src\/engine\/svg-use\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:baselineUses}));
    }
    await page.goto('http://127.0.0.1:5173/playground.html',{timeout:120000});
    const result=await page.evaluate(async encoded=>{
     const {openCanvasDocument}=await import('/src/engine/open-document.js');
     const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
     const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
     const host=document.createElement('div'),errors=[];document.body.append(host);let editor;
     try{
      editor=new CanvasEditor(host,{...pkg,images,onError:error=>errors.push(error.message)});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));editor.paint();
      return {readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,
       lines:editor.layout.lines.map(l=>({page:l.page,start:l.start,end:l.end,y:l.y,height:l.height,baseline:l.baseline,stops:l.stops.map(s=>[s.offset,s.x])})),
       pictures:editor.layout.floatingObjects.map(f=>({page:f.page,x:f.x,y:f.y,width:f.width,height:f.height})),
       pages:editor.canvases.map(c=>c.toDataURL().split(',')[1])};
     }finally{editor?.destroy();host.remove();}
    },bytes.toString('base64'));
    variants[variant]=result;
    for(const [pageIndex,png] of result.pages.entries())writeFileSync(join(out,`${index+1}-${variant}-${pageIndex+1}.png`),Buffer.from(png,'base64'));
   }finally{await context.close();}
  }
  const a=variants.baseline,b=variants.current;
  const pages=[];
  for(const [i,encoded] of b.pages.entries()){
   const old=a.pages[i];if(!old){pages.push({added:true});continue;}
   const metrics=await pixelPage.evaluate(async ({old,current})=>{
    const decode=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};};
    const before=await decode(old),after=await decode(current);
    if(before.width!==after.width||before.height!==after.height)return {resized:true};
    let changed=0,total=0;
    for(let p=0;p<before.data.length;p+=4){let difference=false;for(let c=0;c<4;c++){const d=Math.abs(before.data[p+c]-after.data[p+c]);total+=d;difference||=d!==0;}changed+=difference;}
    return {width:after.width,height:after.height,changedPixels:changed,rgbaMAE:total/after.data.length};
   },{old,current:encoded});
   pages.push({...metrics,baselinePngSha256:sha(Buffer.from(old,'base64')),currentPngSha256:sha(Buffer.from(encoded,'base64'))});
  }
  const row={...source,sourceSha256:sha(bytes),baselinePages:a.pages.length,currentPages:b.pages.length,
   geometryEqual:JSON.stringify([a.lines,a.pictures])===JSON.stringify([b.lines,b.pictures]),
   baselineReadOnly:a.readOnly,currentReadOnly:b.readOnly,baselineIssues:a.issues,currentIssues:b.issues,baselineErrors:a.errors,currentErrors:b.errors,pages};
  report.rows.push(row);writeFileSync(join(out,'comparison.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${index+1}/${cohort.length}: ${source.file}; changed pixels ${pages.map(p=>p.changedPixels).join(',')}`);
 }
}finally{await browser.close();}
