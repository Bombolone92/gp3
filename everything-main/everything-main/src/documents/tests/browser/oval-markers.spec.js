import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/oval-markers',source=readFileSync(`${folder}/control.docx`);
const reference=JSON.parse(readFileSync(`${folder}/reference.json`,'utf8'));
test('oval sizes, endpoint tangents and group transforms match native vectors',async({page},info)=>{
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html');
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');const {decodeShape}=await import('/src/engine/canvas-shapes.js');
    const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
    const proto=OffscreenCanvasRenderingContext2D.prototype,ellipse=proto.ellipse,result=[];let recorded=[];
    proto.ellipse=function(...args){recorded.push(args);return ellipse.apply(this,args);};
    try {for(const asset of Object.values(pkg.assets)){
      recorded=[];const decoded=await decodeShape(asset,new Map());
      result.push(recorded.map(([x,y,rx,ry,angle])=>({center:[(x/2+decoded.left)*.75,(y/2+decoded.top)*.75],rx:rx*.375,ry:ry*.375,angle})));
      decoded.close();
    }}finally{proto.ellipse=ellipse;}return result;
  },source.toString('base64'));
  writeFileSync(info.outputPath('markers.json'),JSON.stringify(actual,null,2));
  expect(actual).toHaveLength(reference.cases.length);
  for(const [i,c] of reference.cases.entries()){
    expect(actual[i],c.name).toHaveLength((c.markers||[]).length);
    for(const [j,native] of (c.markers||[]).entries()){
      const a=actual[i][j],label=`${c.name} marker ${j}`;
      for(let k=0;k<2;k++)expect.soft(Math.abs(a.center[k]+(k?c.y:c.x)-native.center[k]),label).toBeLessThan(.02);
      const u=native.u,v=native.v,cs=Math.cos(a.angle),sn=Math.sin(a.angle);
      const nr=[Math.hypot(...u),Math.hypot(...v)].sort((a,b)=>a-b),ar=[a.rx,a.ry].sort((a,b)=>a-b);
      nr.forEach((r,k)=>expect.soft(Math.abs(ar[k]-r),label+' radius').toBeLessThan(.02));
      const scale=nr[1]**2;
      const actualCov=[a.rx*a.rx*cs*cs+a.ry*a.ry*sn*sn,a.rx*a.rx*sn*sn+a.ry*a.ry*cs*cs,(a.rx*a.rx-a.ry*a.ry)*cs*sn];
      const nativeCov=[u[0]**2+v[0]**2,u[1]**2+v[1]**2,u[0]*u[1]+v[0]*v[1]];
      actualCov.forEach((n,k)=>expect.soft(Math.abs(n-nativeCov[k])/scale,label+' orientation').toBeLessThan(.004));
    }
  }
});
test('oval marker documents retain editing, immutable drawings and exact undo',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/control.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Oval marker controls/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const samples=reference.cases.flatMap(c=>(c.samples||[]).map(s=>({...s,page:c.page})));
  await expect.poll(()=>page.locator('canvas.canvas-page').evaluateAll((canvases,samples)=>samples.map(s=>{
    const canvas=canvases[s.page],scale=canvas.width/612;
    return [...canvas.getContext('2d').getImageData(Math.floor(s.x*scale),Math.floor(s.y*scale),1,1).data].slice(0,3);
  }),samples).then(colors=>colors.every((rgb,i)=>rgb.every((v,k)=>Math.abs(v-samples[i].rgb[k])<=3)))).toBe(true);
  const original=await input.inputValue(),parts=unzipSync(source);
  const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}.docx`);await(await next).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,original+' EDIT');expect(errors).toEqual([]);
});
