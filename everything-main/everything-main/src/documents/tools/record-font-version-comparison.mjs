// Local diagnostic only: compare one unchanged DOCX with bundled and supplied
// font files. Supplied fonts are never installed, embedded, or redistributed.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

const [sourceArgument,outputArgument,fontArgument]=process.argv.slice(2);
if(!sourceArgument||!outputArgument||!fontArgument)throw Error('Usage: node tools/record-font-version-comparison.mjs source.docx output-directory candidate-font-directory');
const source=resolve(sourceArgument),output=resolve(outputArgument),fontDirectory=resolve(fontArgument);
const candidates=new Map(readdirSync(fontDirectory).filter(f=>f.endsWith('.ttf')).map(f=>[f.toLowerCase(),f]));
const bytes=readFileSync(source),parts=unzipSync(bytes),hash=b=>createHash('sha256').update(b).digest('hex');
mkdirSync(output,{recursive:true});
const same=(a,b)=>JSON.stringify(Object.keys(a).sort())===JSON.stringify(Object.keys(b).sort())&&Object.keys(a).every(k=>Buffer.from(a[k]).equals(Buffer.from(b[k])));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'}),runs=[];
try{
 for(const mode of ['bundled','candidate']){
  const page=await browser.newPage({deviceScaleFactor:3}),requests=[];page.setDefaultTimeout(180000);
  try{
   if(mode==='candidate')await page.route('**/fonts/*.ttf',async route=>{
    const requested=new URL(route.request().url()).pathname.split('/').at(-1),name=candidates.get(requested.toLowerCase());
    if(!name)return route.continue();
    const data=readFileSync(join(fontDirectory,name));requests.push({requested,file:name,sha256:hash(data)});
    await route.fulfill({body:data,contentType:'font/ttf'});
   });
   await page.goto(process.env.DOCX_REVIEW_URL||'http://127.0.0.1:5173/playground.html',{timeout:120000});
   const input=page.getByRole('textbox',{name:'Document text'}),previous=await input.elementHandle();
   await page.getByLabel('Open DOCX file').setInputFiles(source);await page.waitForFunction(e=>!e.isConnected,previous);
   const readOnly=await input.evaluate(e=>e.readOnly),text=await input.inputValue();
   const typography=await page.evaluate(async encoded=>{
    const {recordFontVersionTypography}=await import('/tools/font-version-typography.js');
    return recordFontVersionTypography(encoded);
   },bytes.toString('base64'));
   writeFileSync(join(output,mode+'-typography.json'),JSON.stringify(typography,null,2));
   const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=join(output,mode+'-'+name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
   const workflow={noEdit:same((await save('noedit')).parts,parts)};
   if(!readOnly){
    await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
    workflow.otherPartsRetained=same(Object.fromEntries(Object.entries(parts).filter(([k])=>k!=='word/document.xml')),Object.fromEntries(Object.entries(edited.parts).filter(([k])=>k!=='word/document.xml')));
    await input.press('ControlOrMeta+z');workflow.exactUndo=same((await save('undo')).parts,parts);workflow.textRestored=(await input.inputValue())===text;
   }
   for(const [i,canvas]of(await page.locator('canvas.canvas-page').all()).entries())writeFileSync(join(output,`${mode}-page${i+1}.png`),Buffer.from((await canvas.evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
   runs.push({mode,requests,readOnly,pages:await page.locator('canvas.canvas-page').count(),workflow});
  }finally{await page.close();}
 }
 writeFileSync(join(output,'workflow.json'),JSON.stringify({sourceSha256:hash(bytes),runs},null,2));
 if(runs.some(r=>Object.values(r.workflow).some(value=>value!==true)))throw Error('Package/edit workflow failed');
 console.log(JSON.stringify(runs));
}finally{await browser.close();}
