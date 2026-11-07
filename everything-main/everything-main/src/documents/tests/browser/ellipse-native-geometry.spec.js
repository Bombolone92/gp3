import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/ellipse-native-geometry/';
const screen=JSON.parse(readFileSync(folder+'native-screen-reference.json'));
const comparison=JSON.parse(readFileSync('tests/fixtures/measurements/ellipse-screen-display.json'));
for(const fixture of ['control','holdout','grouped'])test(`native ellipse screen placement and editing workflows: ${fixture}`,async({page},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html',{timeout:180000});
  const input=page.getByRole('textbox',{name:'Document text'}),old=await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(folder+fixture+'.docx');
  await expect.poll(()=>old.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await old.dispose();
  await expect(input).not.toHaveAttribute('readonly');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  for(const observation of screen.observations.filter(o=>o.fixture===fixture)) {
    const zoom=observation.zoom/100;
    await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(zoom));
    const errors=await page.evaluate(async({bytes,regions})=>{
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d');
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const native=new OffscreenCanvas(bitmap.width,bitmap.height),reference=native.getContext('2d');
      reference.drawImage(bitmap,0,0);bitmap.close();
      return regions.map(([x,y,w,h])=>{
        const a=ctx.getImageData(x,y,w,h).data,b=reference.getImageData(x,y,w,h).data;let sum=0;
        for(let i=0;i<a.length;i+=4)for(let channel=0;channel<3;channel++)sum+=Math.abs(a[i+channel]-b[i+channel]);
        return sum/(w*h*3);
      });
    },{bytes:[...readFileSync(folder+observation.crop)],regions:observation.regions});
    const metrics=comparison.filter(r=>r.control===fixture&&r.zoom===zoom);
    errors.forEach((error,i)=>{
      expect(error,`native ellipse ${i+1} at ${zoom}`).toBeLessThanOrEqual(metrics[i].errors['twip-extent']+1e-8);
      expect(error,`no regression: ellipse ${i+1} at ${zoom}`).toBeLessThanOrEqual(metrics[i].errors.current+1e-8);
    });
    writeFileSync(info.outputPath(`page-${zoom}.png`),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  }
  const before=unzipSync(readFileSync(folder+fixture+'.docx')),original=await input.inputValue();
  const save=async(label,edited)=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(label+'.docx');await(await pending).saveAs(path);const after=unzipSync(readFileSync(path));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for(const part of Object.keys(before))if(!edited||part!=='word/document.xml')expect(after[part],part).toEqual(before[part]);
    return path;
  };
  await save('noedit',false);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited',true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await save('undo',false);
  await reopenDocx(page,input,edited,'Edited '+original,{timeout:45000});
  expect(errors).toEqual([]);
});

test('ellipse projection preserves the native 200 percent geometry on a DPR2 display',async({browser},info)=>{
  test.setTimeout(180000);
  const context=await browser.newContext({deviceScaleFactor:2,baseURL:info.project.use.baseURL}),page=await context.newPage();
  try {
    await page.goto('/playground.html',{timeout:180000});
    const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
    await page.getByLabel('Open DOCX file').setInputFiles(folder+'grouped.docx');
    await expect.poll(()=>old.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await old.dispose();
    await page.getByRole('combobox',{name:'Zoom'}).selectOption('1');
    const observation=screen.observations.find(o=>o.fixture==='grouped'&&o.zoom===200);
    const errors=await page.evaluate(async({bytes,regions})=>{
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const native=new OffscreenCanvas(bitmap.width,bitmap.height),ref=native.getContext('2d');ref.drawImage(bitmap,0,0);bitmap.close();
      const canvas=document.querySelector('canvas.canvas-page');if(canvas.width!==768||canvas.height!==576)throw Error('Unexpected DPR2 control size');
      const actual=canvas.getContext('2d');return regions.map(([x,y,w,h])=>{
        const a=actual.getImageData(x,y,w,h).data,b=ref.getImageData(x,y,w,h).data;let sum=0;
        for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++)sum+=Math.abs(a[i+c]-b[i+c]);return sum/(w*h*3);
      });
    },{bytes:[...readFileSync(folder+observation.crop)],regions:observation.regions});
    const metrics=comparison.filter(r=>r.control==='grouped'&&r.zoom===2);
    errors.forEach((error,i)=>expect(error,`DPR2 native ellipse ${i+1}`).toBeLessThanOrEqual(metrics[i].errors['twip-extent']+1e-8));
    writeFileSync(info.outputPath('page-dpr2.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  } finally {await context.close();}
});
