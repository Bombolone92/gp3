// Strict source/draft capability audit; never renders or reads font programs.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
const [root,input,output]=process.argv.slice(2);
if(!root||!input||!output)throw Error('Usage: node tools/audit-drawing-text-capabilities.mjs CORPUS_ROOT FILE_LIST_JSON OUTPUT');
const base=resolve(root),data=JSON.parse(readFileSync(input)),names=[...new Set([...data.rows.map(r=>r.file),...(data.currentFile?[data.currentFile]:[])])];
const report={scope:'Strict source import and drawing draft capability, not layout, fonts, native fidelity or a completion verdict.',complete:false,rows:[]};
mkdirSync(dirname(resolve(output)),{recursive:true});const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/playground.html',{timeout:180000});
 for(const name of names){
  const path=resolve(base,name),local=relative(base,path);if(local.startsWith('..')||resolve(local)===path)throw Error('Source leaves corpus root');
  const bytes=readFileSync(path),sha=createHash('sha256').update(bytes).digest('hex');
  const result=await page.evaluate(async bytes=>{
   try{
    const {DocxPackage}=await import('/src/engine/docx.js');const pkg=await DocxPackage.open(new Uint8Array(bytes));
    const stories=[{part:'word/document.xml',paragraphs:pkg.paragraphs},...Object.entries(pkg.pageStories?.stories||{}).map(([part,s])=>({part,paragraphs:s.paragraphs||[]}))];
    const frames=[];
    for(const story of stories)for(const p of story.paragraphs)for(const r of p.runs)if(r.image){
     const values=pkg.drawingTextFrames(r.image);for(const frame of values)frames.push({part:story.part,imageId:r.image.id,index:frame.index,reason:frame.reason,paragraphs:frame.paragraphs.length,tables:frame.tables?.length||0});
    }
    return {readOnly:!!pkg.readOnly,frames};
   }catch(e){return {error:e.message};}
  },[...bytes]);
  if(createHash('sha256').update(readFileSync(path)).digest('hex')!==sha)throw Error('Source changed during audit');
  report.rows.push({file:name,sha256:sha,...result});save();console.log(JSON.stringify({done:report.rows.length,total:names.length,file:name,frames:result.frames?.length,error:result.error,guarded:result.frames?.filter(f=>f.reason).map(f=>f.reason)}));
 }
 report.complete=true;save();
}finally{await browser.close();}
