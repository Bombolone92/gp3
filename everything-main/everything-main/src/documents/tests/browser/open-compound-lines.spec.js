import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/open-compound-lines/';
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const native=JSON.parse(readFileSync(folder+'reference.json'));

test('open compound bands match all 48 native reference vector contours',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const results=await page.evaluate(async({cases,native})=>{
    const {compoundContours,compoundOutlinePainter}=await import('/src/engine/compound-outlines.js');
    const results=[];
    for(const c of cases){
      const scale=4,w=1152,h=864;
      const actual=new OffscreenCanvas(w,h),expected=new OffscreenCanvas(w,h);
      const start=c.reverse?1000:0,end=c.reverse?0:1000;
      const path={width:1000,height:1000,points:[['M',start,c.curve?1000:500],c.curve?['C',start,0,end,0,end,1000]:['L',end,500]]};
      const matrix={a:scale,b:0,c:0,d:scale,e:c.xPt*scale,f:c.yPt*scale};
      const contours=compoundContours(path,c.widthPt,c.heightPt,matrix,scale);
      compoundOutlinePainter(w,h)(actual.getContext('2d'),new Path2D(),{compound:c.compound,cap:c.cap,color:'#000'},c.penPt*scale,new Path2D(),contours);
      const ref=new Path2D();
      for(const [op,...v] of native.shapes[c.id-1].paths){
        if(op==='h')ref.closePath();
        else ref[{m:'moveTo',l:'lineTo',c:'bezierCurveTo'}[op]](...v.map(x=>x*scale));
      }
      expected.getContext('2d').fill(ref);
      const a=actual.getContext('2d').getImageData(0,0,w,h).data;
      const b=expected.getContext('2d').getImageData(0,0,w,h).data;
      let interiorMismatch=0,totalError=0,samples=0;
      const x0=Math.floor((c.xPt-5)*scale),x1=Math.ceil((c.xPt+c.widthPt+5)*scale);
      const y0=Math.floor((c.yPt-5)*scale),y1=Math.ceil((c.yPt+c.heightPt+5)*scale);
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const k=(y*w+x)*4+3,value=b[k];totalError+=Math.abs(a[k]-value);samples++;
        if(value!==0&&value!==255)continue;
        let interior=true;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(b[((y+dy)*w+x+dx)*4+3]!==value)interior=false;
        if(interior&&Math.abs(a[k]-value)>8)interiorMismatch++;
      }
      results.push({id:c.id,interiorMismatch,meanAlphaError:totalError/samples});
    }
    return results;
  },{cases,native});
  for(const r of results){expect(r.interiorMismatch,JSON.stringify(r)).toBe(0);expect(r.meanAlphaError,JSON.stringify(r)).toBeLessThan(.8);}
});

test('renders native open compound controls through editable import, export and undo',async({page},info)=>{
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
  await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  const check=async()=>{
    const result=await page.evaluate(({cases,native})=>{
      const pages=[...document.querySelectorAll('canvas.canvas-page')],mismatches=[];
      let count=0;
      for(const c of cases){
        const ref=new OffscreenCanvas(1152,864),ctx=ref.getContext('2d'),path=new Path2D();
        for(const [op,...v] of native.shapes[c.id-1].paths){
          if(op==='h')path.closePath();else path[{m:'moveTo',l:'lineTo',c:'bezierCurveTo'}[op]](...v.map(x=>x*4));
        }
        ctx.fill(path);const bytes=ctx.getImageData(0,0,1152,864).data;
        const canvas=pages[c.page],paint=canvas.getContext('2d'),scale=canvas.width/288;
        // Compare the native ink bounds and a two-point exterior margin. The
        // otherwise empty top of the frame can legitimately contain edited text.
        const coords=native.shapes[c.id-1].paths.flatMap(p=>p.slice(1));
        const xs=coords.filter((_,i)=>i%2===0),ys=coords.filter((_,i)=>i%2===1);
        for(let y=Math.floor(Math.min(...ys))-2;y<Math.ceil(Math.max(...ys))+2;y++)for(let x=Math.floor(Math.min(...xs))-2;x<Math.ceil(Math.max(...xs))+2;x++){
          const alpha=bytes[((y*4)*1152+x*4)*4+3];if(alpha!==0&&alpha!==255)continue;
          let stable=true;
          for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(bytes[((y*4+dy)*1152+x*4+dx)*4+3]!==alpha)stable=false;
          if(!stable)continue;
          const color=[...paint.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data].slice(0,3);
          const expected=alpha?[32,64,128]:[255,255,255];count++;
          if(color.some((v,i)=>v!==expected[i]))mismatches.push({id:c.id,x,y,color,expected});
        }
      }
      return {count,mismatches:mismatches.slice(0,10),failures:mismatches.length};
    },{cases,native});
    expect(result.count).toBeGreaterThan(10000);
    expect(result.failures,JSON.stringify(result)).toBe(0);
  };
  await check();
  const original=await input.inputValue(),parts=unzipSync(readFileSync(folder+'control.docx'));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');await check();
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
  await reopenDocx(page,input,edited,'Edited '+original,{timeout:45000});await check();
});

test('compound contours preserve reflected sides and single-pass alpha',async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html');
  const failures=await page.evaluate(async({cases,native})=>{
    const {compoundContours,compoundOutlinePainter}=await import('/src/engine/compound-outlines.js');
    const failures=[];
    for(const c of cases.filter(c=>c.cap==='rnd'))for(const angle of [0,90]){
      const matrix=new DOMMatrix().translate(192,192).rotate(angle).scale(-4,4).translate(-33,-12);
      const start=c.reverse?1000:0,end=c.reverse?0:1000;
      const path={width:1000,height:1000,points:[['M',start,c.curve?1000:500],c.curve?['C',start,0,end,0,end,1000]:['L',end,500]]};
      const contours=compoundContours(path,66,24,matrix,4);
      const actual=new OffscreenCanvas(384,384),expected=new OffscreenCanvas(384,384);
      compoundOutlinePainter(384,384)(actual.getContext('2d'),new Path2D(),{compound:c.compound,cap:c.cap,color:'rgba(0,0,0,0.5)'},24,new Path2D(),contours);
      const ref=new Path2D();
      for(const [op,...v] of native.shapes[c.id-1].paths){
        if(op==='h')ref.closePath();else ref[{m:'moveTo',l:'lineTo',c:'bezierCurveTo'}[op]](...v.map((x,i)=>x-(i%2?c.yPt:c.xPt)));
      }
      const transformed=new Path2D();transformed.addPath(ref,matrix);
      const ctx=expected.getContext('2d');ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fill(transformed);
      const a=actual.getContext('2d').getImageData(0,0,384,384).data,b=ctx.getImageData(0,0,384,384).data;
      let mismatch=0;
      for(let y=1;y<383;y++)for(let x=1;x<383;x++){
        const k=(y*384+x)*4+3,v=b[k];if(v!==0&&v!==128)continue;
        let interior=true;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(b[((y+dy)*384+x+dx)*4+3]!==v)interior=false;
        if(interior&&Math.abs(a[k]-v)>5)mismatch++;
      }
      if(mismatch)failures.push({id:c.id,angle,mismatch});
    }
    return failures;
  },{cases,native});
  expect(failures).toEqual([]);
});

test('rotated compound line branch matches equivalent rotated custom geometry',async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html');
  const failures=await page.evaluate(async()=>{
    const {decodeShape}=await import('/src/engine/canvas-shapes.js');
    const failures=[];
    for(const compound of ['dbl','tri','thickThin','thinThick'])for(const cap of ['flat','rnd','sq'])for(const flipH of [false,true]){
      const node={type:'shape',x:0,y:0,width:88*9525,height:0,flipH,
        outline:{width:76200,color:'#204080',compound,cap},
        paths:[{width:1,height:1,fill:false,stroke:true,points:[['M',0,0],['L',1,1]]}]};
      const images=[];
      for(const property of ['lineRotation','shapeRotation']){
        const asset={width:88,height:0,scene:{...node,[property]:90*60000}};
        const image=await decodeShape(asset,new Map());
        const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d');
        ctx.drawImage(image.bitmap,128+image.left*2,128+image.top*2,image.width*2,image.height*2);
        images.push(ctx.getImageData(0,0,512,512).data);image.close();
      }
      let mismatches=0;
      for(let i=3;i<images[0].length;i+=4)if(Math.abs(images[0][i]-images[1][i])>2)mismatches++;
      if(mismatches)failures.push({compound,cap,flipH,mismatches});
    }
    return failures;
  });
  expect(failures).toEqual([]);
});
