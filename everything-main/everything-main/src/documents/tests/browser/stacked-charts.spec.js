import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const refs=['stacked-charts','chart-colors','chart-metadata'].flatMap(folder=>JSON.parse(readFileSync(`tests/fixtures/${folder}/reference.json`,'utf8')).map(r=>({...r,folder}))).filter(r=>r.name!=='chart-metadata-order');
const textRefs=JSON.parse(readFileSync('tests/fixtures/chart-metadata/native-text.json','utf8'));
for(const r of refs)test(`renders and preserves native stack segments: ${r.name}`,async({page},info)=>{
 const source=`public/fixtures/${r.name}.docx`,bytes=readFileSync(source),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`tests/fixtures/${r.folder}/${r.name}.pdf`)).digest('hex')).toBe(r.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/After chart/);await expect(input).toHaveJSProperty('readOnly',false);
 const colors=[...new Set([...r.bars,...r.outlines].map(b=>b.color).filter(c=>!['#ffffff','#000000'].includes(c)))];
 const fills=new Set(r.bars.map(b=>b.color));
 const blended=colors.filter(c=>!fills.has(c)).map(c=>({key:parseInt(c.slice(1),16),rgb:c.slice(1).match(/../g).map(v=>parseInt(v,16))}));
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
  if(colors.length)await expect.poll(()=>page.locator('canvas.canvas-page').evaluate((c,{colors,blended})=>{
   const counts=new Map(colors.map(c=>[parseInt(c.slice(1),16),0])),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   for(let i=0;i<pixels.length;i+=4){const key=(pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2];if(counts.has(key))counts.set(key,counts.get(key)+1);
    else for(const color of blended){const channel=color.rgb.indexOf(Math.min(...color.rgb)),coverage=(255-pixels[i+channel])/(255-color.rgb[channel]);
     if(coverage>=.25&&coverage<=1&&color.rgb.every((v,j)=>Math.abs(pixels[i+j]-(255+(v-255)*coverage))<=2))counts.set(color.key,counts.get(color.key)+1);
    }
   }
   return Math.min(...counts.values());
  },{colors,blended})).toBeGreaterThan(50);
 };await check();
 const actual=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{paintChart}=await import('/src/engine/canvas-charts.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0))),chart=Object.values(pkg.assets).find(a=>a.chart).chart;
  const canvas=document.createElement('canvas');canvas.width=576;canvas.height=384;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,576,384);
  const bars=[],outlines=[],labels=[],textRuns=[],fill=ctx.fillRect.bind(ctx),stroke=ctx.strokeRect.bind(ctx),label=ctx.fillText.bind(ctx);
  ctx.fillRect=(x,y,w,h)=>{bars.push({color:ctx.fillStyle.toLowerCase(),x,y,w,h});fill(x,y,w,h);};
  ctx.strokeRect=(x,y,w,h)=>{outlines.push({color:ctx.strokeStyle,x,y,w,h});stroke(x,y,w,h);};
  ctx.fillText=(t,...a)=>{labels.push(t);textRuns.push({text:t,font:ctx.font,color:ctx.fillStyle,scale:ctx.getTransform().a});label(t,...a);};paintChart(ctx,chart,576,384);
  const plot=outlines.find(b=>b.color==='#b3b3b3'&&b.w>200&&b.h>100);
  return {bars:bars.map(b=>({...b,pixel:[...ctx.getImageData(Math.floor(b.x+b.w*.2),Math.floor(b.y+b.h/2),1,1).data],x:(b.x-plot.x)/plot.w,y:(b.y-plot.y)/plot.h,w:b.w/plot.w,h:b.h/plot.h})),outlines:outlines.filter(b=>b.color!=='#b3b3b3').map(b=>({...b,x:(b.x-plot.x)/plot.w,y:(b.y-plot.y)/plot.h,w:b.w/plot.w,h:b.h/plot.h})),ticks:labels.filter(t=>/^-?\d+%?$/.test(t)),textRuns,png:canvas.toDataURL()};
 },bytes.toString('base64'));
 expect(actual.ticks).toEqual(r.ticks);expect(actual.bars).toHaveLength(r.bars.length);
 for(const ref of textRefs.find(t=>t.name===r.name)?.labels||[]){const run=actual.textRuns.find(t=>t.text===ref.text);expect(run.font).toContain(ref.font.startsWith('Arial')?'Arial':'Cambria');expect(/bold|700/.test(run.font)).toBe(/Bold/.test(ref.font));expect(/italic/.test(run.font)).toBe(/Italic/.test(ref.font));expect(Math.abs(Number(/([\d.]+)px/.exec(run.font)[1])*run.scale*.75-ref.size)).toBeLessThan(.05);}
 const used=new Set();for(const b of actual.bars){const i=r.bars.findIndex((v,i)=>!used.has(i)&&v.color===b.color&&['x','y','w','h'].every(k=>Math.abs(v[k]-b[k])<.001));expect(i,JSON.stringify(b)).toBeGreaterThanOrEqual(0);used.add(i);expect(b.pixel).toEqual([...b.color.slice(1).match(/../g).map(v=>parseInt(v,16)),255]);}
 expect(actual.outlines).toHaveLength(r.outlines.length);const usedOutlines=new Set();for(const b of actual.outlines){const i=r.outlines.findIndex((v,i)=>!usedOutlines.has(i)&&v.color===b.color&&['x','y','w','h'].every(k=>Math.abs(v[k]-b[k])<.001));expect(i,JSON.stringify(b)).toBeGreaterThanOrEqual(0);usedOutlines.add(i);}
 writeFileSync(info.outputPath('chart.png'),Buffer.from(actual.png.split(',')[1],'base64'));
 writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const unchanged=actual=>{expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))expect(Buffer.from(actual[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 unchanged(unzipSync(readFileSync(await save('noedit'))));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 expectBodyEditParts(changed,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);unchanged(unzipSync(readFileSync(await save('undo'))));await check();
 await reopenDocx(page,input,edited,'EDIT '+original);await check();expect(errors).toEqual([]);
});
