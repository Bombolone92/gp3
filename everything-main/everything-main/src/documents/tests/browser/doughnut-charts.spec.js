import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/doughnut-charts.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/doughnut-charts/reference.json','utf8'));
test('matches native doughnut geometry, titles and deletion overrides through editing',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/doughnut-charts/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Doughnut square/,{timeout:60000});
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
 const verify=async path=>{
  const result=await page.evaluate(async({bytes,cases})=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{paintChart}=await import('/src/engine/canvas-charts.js');
   const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
   const assets=Object.values(pkg.assets).filter(a=>a.chart);
   return assets.map((asset,i)=>{
    const ref=cases[i],canvas=document.createElement('canvas');canvas.width=ref.frame[2]*4;canvas.height=ref.frame[3]*4;
    const ctx=canvas.getContext('2d');ctx.scale(3,3);paintChart(ctx,asset.chart,ref.frame[2]*4/3,ref.frame[3]*4/3);
    const mismatch=ref.samples.flatMap(([x,y,...rgb])=>{const actual=Array.from(ctx.getImageData(x*4,y*4,1,1).data).slice(0,3);return actual.some((v,k)=>v!==rgb[k])?[{x,y,rgb,actual}]:[];});
    let title=null;if(asset.chart.title){const t=asset.chart.title,n=measureCanvasText(ctx,t.text,t.style);title=[t.layout.x*ref.frame[2]+3,t.layout.y*ref.frame[3]+1.5+n.ascent*.75];}
    return {name:ref.name,mismatch,title,png:canvas.toDataURL().split(',')[1]};
   });
  },{bytes:readFileSync(path).toString('base64'),cases:reference.cases});
  writeFileSync(info.outputPath('comparison.json'),JSON.stringify(result.map(({png,...r})=>r),null,2));
  for(const [i,r]of result.entries()){
   writeFileSync(info.outputPath(`chart-${i}.png`),Buffer.from(r.png,'base64'));
   expect(r.mismatch,`${r.name} native samples`).toEqual([]);
   if(r.title){const target=reference.cases[i].title[0];expect(Math.abs(r.title[0]-target[1])).toBeLessThan(.2);expect(Math.abs(r.title[1]-target[2])).toBeLessThan(.2);}
  }
 };
 await verify(source);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await verify(edited);await expect(page.locator('#playground-error')).toBeEmpty();
});
