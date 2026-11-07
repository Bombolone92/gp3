// Reproduce a rejected numerical hypothesis; this never changes the renderer.
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
const root=fileURLToPath(new URL('../tests/fixtures/cell-text-direction/',import.meta.url));
const [output,baseURL='http://127.0.0.1:5173']=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/investigate-rotated-baseline-rounding.mjs OUTPUT_JSON [BASE_URL]');
const inputs={};
const browser=await chromium.launch({headless:true,channel:'msedge'}), page=await browser.newPage();
const results={};
try {
 await page.goto(baseURL+'/playground.html');
 for(const folder of ['frame-rounding/multiple','baseline-scale']){
  const ref=JSON.parse(readFileSync(root+folder+'/native-reference.json'));
  for(const name of ['control.docx','native-reference.json'])inputs[folder+'/'+name]=createHash('sha256').update(readFileSync(root+folder+'/'+name)).digest('hex');
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js');const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
   const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(pkg);
   const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles});
   return l.lines.filter(r=>r.cellText&&r.fragments.map(f=>f.text||'').join('').trim()==='a').map(r=>{
    const {line,matrix:m}=r.cellText,origin=l.pages[r.page].left;
    const u=(m[4]-origin+m[2]*line.y)*.75,h=line.height*.75,n=(line.ascent+line.descent)*.75,a=(line.baseline-line.y)*.75,d=line.descent*.75;
    return {page:r.page,direction:m[1]===1?'tbRl':'btLr',x:(m[4]-origin+m[2]*line.baseline)*.75,u,h,n,a,d};
   });
  },readFileSync(root+folder+'/control.docx').toString('base64'));
  const q=v=>Math.floor(v/.12+.5)*.12;
  const rows=[];
  for(let i=0;i<ref.cases.length;i++){
   const c=ref.cases[i],subset=actual.filter(r=>r.page===i);
   if(subset.length!==12)throw Error('Missing source lines');
   for(let j=0;j<12;j++){
    const r=subset[j],native=c.rows[j].logicalX*.12,minimum=r.h>r.n+1e-6?Math.ceil(r.n*20-1e-8)/20:r.n;
    if(r.direction!=='tbRl')continue;
    const ascent=q(minimum)-q(r.n-r.a);
    const candidate=q(r.u-r.h)+q(r.u+r.h)-q(r.u)-ascent;
    rows.push({...r,font:c.font,size:c.size||10,multiple:c.multiple||c.line,native,oldError:r.x-native,candidate,error:candidate-native,roundedAscent:ascent});
   }
  }
  results[folder]=rows;
  const changes=rows.filter(r=>r.direction==='tbRl');
  console.log(folder,'matching',changes.filter(r=>Math.abs(r.error)<.001).length,'/',changes.length,'max',Math.max(...changes.map(r=>Math.abs(r.error))));
  for(let i=0;i<ref.cases.length;i++){
   const lines=changes.filter(r=>r.page===i);
   if(lines.some(r=>Math.abs(r.error)>.001))console.log(i,lines[0].font,lines[0].size,lines[0].multiple,'errors',lines.map(r=>Number(r.error.toFixed(5))));
  }
 }
 writeFileSync(output,JSON.stringify({rendererCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),formula:'Q(U-H)+Q(U+H)-Q(U)-(Q(expanded?ceil(N*20)/20:N)-Q(N-A))',inputs,results},null,2)+'\n');
}finally{await browser.close();}
