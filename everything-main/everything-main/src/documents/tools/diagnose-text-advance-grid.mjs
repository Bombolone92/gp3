import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const folder='tests/fixtures/text-advance-grid/';
if(!process.argv[2])throw Error('Usage: node tools/diagnose-text-advance-grid.mjs <output.json> [--authorized]');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(process.argv.includes('--authorized')?{permissions:['local-fonts']}:{});await page.goto('http://127.0.0.1:5173/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
  const {displayedFont}=await import('/src/engine/font-availability.js');
  const {textFontStyle}=await import('/src/engine/font-families.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(pkg);
  const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,pkg.styles.fontAlternatives);
  return pkg.paragraphs.map((p,i)=>{const run=p.runs[0],style=textFontStyle(run.text,run);
   return {id:i+1,text:run.text,family:displayedFont(style,pkg.styles.fontAlternatives),bold:run.bold,advancePt:measureCanvasText(ctx,run.text,style).width*.75/run.text.length};
  });
 },[...readFileSync(folder+'control.docx')]);
 writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
 const ref=JSON.parse(readFileSync(folder+'reference.json'));
 for(const [i,r]of result.entries())console.log(JSON.stringify({...r,native:ref.records[i].averageAdvancePt,delta:r.advancePt-ref.records[i].averageAdvancePt}));
}finally{await browser.close();}
