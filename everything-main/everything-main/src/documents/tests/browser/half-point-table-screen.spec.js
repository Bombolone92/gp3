import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/half-point-table-screen/',source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'native-screen-reference.json'));

async function profiles(page,observation,native=false){
  return page.evaluate(async({observation,bytes,native})=>{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    let canvas=document.querySelector('canvas.canvas-page');
    if(native){
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
    }
    const ctx=canvas.getContext('2d');return observation.profiles.map(p=>{
      const [x,y,w,h]=p.region,data=ctx.getImageData(x,y,w,h).data;
      const across=p.axis==='h'?h:w,along=p.axis==='h'?w:h,rgb=[];
      for(let at=0;at<across;at++){
        const channels=[[],[],[]];
        for(let n=0;n<along;n++){
          const index=(p.axis==='h'?at*w+n:n*w+at)*4;
          for(let c=0;c<3;c++)channels[c].push(data[index+c]);
        }
        rgb.push(channels.map(values=>{values.sort((a,b)=>a-b);return (values[along/2-1]+values[along/2])/2;}));
      }
      const strength=rgb.map(v=>p.color==='FFFFFF'?v[1]:p.color==='FFC000'?255-v[2]:255-Math.max(...v));
      const ink=strength.map((s,i)=>s>p.threshold?i:-1).filter(i=>i>=0),offset=p.axis==='h'?y:x;
      return {rgb,bounds:ink.length?[offset+ink[0],offset+ink.at(-1)+1]:[],strongest:rgb[strength.indexOf(Math.max(...strength))]};
    });
  },{observation,bytes:native?[...readFileSync(folder+observation.crop)]:[],native});
}

test('all 112 fixed native rule profiles reproduce from independently captured native crops',async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html',{timeout:180000});
  for(const observation of reference.observations){
    const actual=await profiles(page,observation,true);
    actual.forEach((p,i)=>{
      // NumPy recorder converts the median of an even sample count to integer.
      expect(p.rgb.map(row=>row.map(Math.trunc))).toEqual(observation.profiles[i].rgb);
      expect(p.bounds).toEqual(observation.profiles[i].nativeBounds);
    });
  }
});

test('half-point positions, contrast and one-pixel thickness match the native reference through editing',async({page},info)=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html',{timeout:180000});
  const input=page.getByRole('textbox',{name:'Document text'}),old=await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect.poll(()=>old.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await old.dispose();
  await expect(input).not.toHaveAttribute('readonly');await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const measurements=[];
  for(const observation of reference.observations){
    await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(observation.zoom/100));
    const actual=await profiles(page,observation);
    actual.forEach((p,i)=>{
      expect(p.bounds[1]-p.bounds[0],`${observation.zoom}% rule ${i}`).toBe(1);
      expect(p.bounds).toEqual(observation.profiles[i].nativeBounds);
      expect(p.strongest).toEqual(observation.profiles[i].color==='auto'?[0,0,0]:observation.profiles[i].color==='FFC000'?[255,192,0]:[255,255,255]);
    });
    measurements.push({zoom:observation.zoom,profiles:actual,positionMismatches:actual.filter((p,i)=>p.bounds.join(':')!==observation.profiles[i].nativeBounds.join(':')).length});
    writeFileSync(info.outputPath(`page-${observation.zoom}.png`),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  }
  writeFileSync(info.outputPath('contrast-and-placement.json'),JSON.stringify(measurements,null,2));
  const before=unzipSync(readFileSync(source)),text=await input.inputValue();
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(before);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
  const after=unzipSync(readFileSync(edited));for(const [name,data] of Object.entries(before))if(name!=='word/document.xml')expect(after[name],name).toEqual(data);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);expect(unzipSync(readFileSync(await save('undo')))).toEqual(before);
  await reopenDocx(page,input,edited,'Edited '+text,{timeout:45000});expect(errors).toEqual([]);
});
