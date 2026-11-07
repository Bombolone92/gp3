import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';

const axisFolder='tests/fixtures/border-axis-phase/';
const denseFolder='tests/fixtures/border-dense-phase/';
const read=name=>JSON.parse(readFileSync(name));

// Current viewer positions must match independent native reference body measurements.
// Native-pixel reproduction and cap/fill regressions are checked separately.
async function measure(page,source,zoom,profiles){
  await page.goto('/playground.html',{timeout:180000});
  const bytes=readFileSync(source);
  const result=await page.evaluate(async({bytes,zoom,profiles})=>{
    if(devicePixelRatio!==1)throw new Error('Native screen comparison requires DPR 1');
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
    const host=document.createElement('div'),errors=[];document.body.append(host);
    const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
    try{
      editor.setZoom(zoom);const before=JSON.stringify(editor.layout.tableBorders);
      editor.paint();const contexts=editor.canvases.map(c=>c.getContext('2d'));
      const positions=profiles.map(({page,axis,region:[x,y,w,h]})=>{
        const ctx=contexts[page-1];
        if(!ctx||x<0||y<0||x+w>ctx.canvas.width||y+h>ctx.canvas.height)throw new Error('Incomplete comparison region');
        const data=ctx.getImageData(x,y,w,h).data;
        const horizontal=axis==='h',across=horizontal?h:w,along=horizontal?w:h,ink=[];
        for(let at=0;at<across;at++){
          const channels=[[],[],[]];
          for(let n=0;n<along;n++){
            const index=(horizontal?at*w+n:n*w+at)*4;
            for(let c=0;c<3;c++)channels[c].push(data[index+c]);
          }
          const medians=channels.map(v=>{v.sort((a,b)=>a-b);return Math.trunc((v[Math.floor((along-1)/2)]+v[Math.floor(along/2)])/2);});
          ink.push(Math.max(...medians)<128);
        }
        const runs=[];let start=null;const base=horizontal?y:x;
        [...ink,false].forEach((active,i)=>{
          if(active&&start===null)start=i;
          if(!active&&start!==null){runs.push([base+start,base+i]);start=null;}
        });return runs;
      });
      return {positions,pages:contexts.length,errors,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],
        sourceGeometryUnchanged:JSON.stringify(editor.layout.tableBorders)===before,
        exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};
    }finally{editor.destroy();host.remove();}
  },{bytes:[...bytes],zoom,profiles});
  expect(result.errors).toEqual([]);expect(result.issues).toEqual([]);
  expect(result.readOnly).toBe(false);expect(result.sourceGeometryUnchanged).toBe(true);
  expect(unzipSync(Uint8Array.from(result.exported))).toEqual(unzipSync(bytes));
  return result;
}

for(const zoom of [100,200])test(`current viewer matches all 512 native axis body bands at ${zoom}%`,async({page})=>{
  test.setTimeout(180000);
  const profiles=read(axisFolder+'screen-body-bands.json').observations.filter(o=>o.zoom===zoom)
    .flatMap(o=>o.bands.map(b=>({...b,page:o.page})));
  const result=await measure(page,axisFolder+'control.docx',zoom/100,profiles);
  expect(result.pages).toBe(8);expect(profiles).toHaveLength(256);
  expect(result.positions).toEqual(profiles.map(b=>b.positions));
});

for(const zoom of [100,175,200])test(`current viewer matches the complete phase sweep at ${zoom}% result`,async({page},info)=>{
  test.setTimeout(180000);
  const cases=read(denseFolder+'cases.json');
  const native=read(denseFolder+(zoom===100?'reference.json':`reference-${zoom}.json`));
  const scale=zoom/100,profiles=cases.flatMap((c,i)=>{
    const x=Math.floor(c.xTwips/15*scale),y=Math.floor(c.yTwips/15*scale);
    const inset=zoom===100?3:4;
    return [{page:1,id:c.id,axis:'v',positions:native.observations[i].vertical,
      region:[x-inset,y+(zoom===100?3:5),zoom===100?72:Math.ceil(64*scale)+10,1]},
    {page:1,id:c.id,axis:'h',positions:native.observations[i].horizontal,
      region:[x+(zoom===100?10:20),y-3,1,zoom===100?15:Math.ceil(8*scale)+7]}];
  });
  const result=await measure(page,denseFolder+'control.docx',scale,profiles);
  expect(result.pages).toBe(1);expect(profiles).toHaveLength(120);
  const failures=profiles.flatMap((p,i)=>JSON.stringify(result.positions[i])===JSON.stringify(p.positions)?[]:
    [{id:p.id,axis:p.axis,native:p.positions,candidate:result.positions[i]}]);
  writeFileSync(info.outputPath('comparison.json'),JSON.stringify({zoom,scope:'Current viewer body comparison; no full-pixel equivalence asserted',failures},null,2));
  expect(failures).toEqual([]);
});

test('table repaint remains fresh after shading, border edits, undo, zoom and print',async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
    const host=document.createElement('div');document.body.append(host);
    const errors=[],editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
    const capture=()=>{document.activeElement?.blur();editor.paint();return editor.canvases.map(c=>c.toDataURL());};
    const compareFresh=()=>{
      const cached=capture();editor.relayout();return JSON.stringify(capture())===JSON.stringify(cached);
    };
    try{
      const initial=capture(),checks=[compareFresh()];
      editor.model.selectCell(editor.model.tables[0].rows[0].cells[0].id);
      editor.setCellShading('00FF00');
      const shaded=capture();checks.push(compareFresh());
      editor.setCellBorders({top:{style:'single',size:16,space:0,color:'FF00FF'}});
      const bordered=capture();checks.push(compareFresh());
      editor.undo();checks.push(JSON.stringify(capture())===JSON.stringify(shaded));
      editor.undo();checks.push(JSON.stringify(capture())===JSON.stringify(initial));
      for(const zoom of [1.75,2,1]){editor.setZoom(zoom);checks.push(compareFresh());}
      const beforePrint=capture(),first=editor.printSheets().map(c=>c.toDataURL());
      editor.relayout();const second=editor.printSheets().map(c=>c.toDataURL());
      checks.push(JSON.stringify(first)===JSON.stringify(second),JSON.stringify(capture())===JSON.stringify(beforePrint));
      return{checks,errors,shadingChanged:JSON.stringify(initial)!==JSON.stringify(shaded),borderChanged:JSON.stringify(shaded)!==JSON.stringify(bordered)};
    }finally{editor.destroy();host.remove();}
  },[...readFileSync('tests/fixtures/border-phase/filled.docx')]);
  expect(result.errors).toEqual([]);expect(result.shadingChanged).toBe(true);expect(result.borderChanged).toBe(true);
  expect(result.checks.every(Boolean)).toBe(true);
});
