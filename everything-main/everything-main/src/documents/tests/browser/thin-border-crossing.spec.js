import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/thin-border-crossing/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));

for(const o of ref.observations){
  test(`native thin crossing positions and ownership reproduce at ${o.zoom}%`,async({page})=>{
    test.setTimeout(180000);await page.goto('/playground.html',{timeout:180000});
    const actual=await page.evaluate(async({bytes,rows})=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return rows.map(r=>{
        const positions={};
        for(const [axis,[x,y,w,h]] of Object.entries(r.regions)){
          const data=ctx.getImageData(x,y,w,h).data,ink=[];
          for(let at=0;at<9;at++){
            const channels=[[],[],[]];
            for(let n=0;n<8;n++){
              const i=(axis==='vertical'?n*w+at:at*w+n)*4;
              for(let c=0;c<3;c++)channels[c].push(data[i+c]);
            }
            const rgb=channels.map(v=>{v.sort((a,b)=>a-b);return(v[3]+v[4])/2;});
            if(.299*rgb[0]+.587*rgb[1]+.114*rgb[2]<166)ink.push(at);
          }
          if(ink.length!==1)throw new Error('Independent native body must be one pixel');
          const base=axis==='vertical'?x:y;positions[axis]=[base+ink[0],base+ink[0]+1];
        }
        const rgb=[...ctx.getImageData(positions.vertical[0],positions.horizontal[0],1,1).data].slice(0,3);
        return{positions,rgb,owner:rgb[0]>rgb[2]?'vertical':'horizontal'};
      });
    },{bytes:[...readFileSync(folder+o.crop)],rows:o.rows});
    expect(actual).toEqual(o.rows.map(({positions,rgb,owner})=>({positions,rgb,owner})));
  });

  test(`thin crossings match native positions and authored ownership at ${o.zoom}%`,async({page},info)=>{
    test.setTimeout(180000);await page.goto('/playground.html',{timeout:180000});const bytes=readFileSync(folder+'control.docx');
    const actual=await page.evaluate(async({bytes,observation})=>{
      const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
      const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div'),errors=[];document.body.append(host);
      const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
      try{
        editor.setZoom(observation.zoom/100);const before=JSON.stringify(editor.layout.tableBorders);editor.paint();
        const ctx=editor.canvases[0].getContext('2d');
        const rows=observation.rows.map(r=>{
          const bodies=Object.entries(r.regions).map(([axis,[x,y,w,h]])=>{
            const data=ctx.getImageData(x,y,w,h).data,ink=[];
            for(let at=0;at<9;at++){
              const i=(axis==='vertical'?4*w+at:at*w+4)*4;
              if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<166)ink.push(at);
            }
            const base=axis==='vertical'?x:y;return[axis,ink.map(v=>v+base)];
          });
          const rgb=[...ctx.getImageData(...r.crossing,1,1).data].slice(0,3);
          return{bodies:Object.fromEntries(bodies),owner:rgb[0]>rgb[2]?'vertical':'horizontal'};
        });
        return{rows,unchanged:before===JSON.stringify(editor.layout.tableBorders),errors,readOnly:!!pkg.readOnly,pages:editor.canvases.length,
          exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};
      }finally{editor.destroy();host.remove();}
    },{bytes:[...bytes],observation:o});
    expect(actual.errors).toEqual([]);expect(actual.readOnly).toBe(false);expect(actual.pages).toBe(1);expect(actual.unchanged).toBe(true);
    expect(actual.rows).toEqual(o.rows.map(r=>({bodies:{vertical:[r.positions.vertical[0]],horizontal:[r.positions.horizontal[0]]},owner:r.owner})));
    expect(unzipSync(Uint8Array.from(actual.exported))).toEqual(unzipSync(bytes));
    writeFileSync(info.outputPath('noedit.docx'),Uint8Array.from(actual.exported));
  });
}
