import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test.setTimeout(180000);
const folder='tests/fixtures/cell-text-direction/live-screen';

for(const zoom of [100,200,500])test(`rotated glyph bounds retain native screen placement at ${zoom}%`,async({page},info)=>{
 const referenceFolder=zoom===500?folder:`${folder}/zooms`;
 const reference=JSON.parse(readFileSync(`${referenceFolder}/${zoom===500?'comparison':'reference'}.json`));
 const native=zoom===500?reference:reference.observations.find(o=>o.zoomPercent===zoom);
 for(const [name,hash] of Object.entries(reference.hashes))
  expect(createHash('sha256').update(readFileSync(`${referenceFolder}/${name}`)).digest('hex')).toBe(hash);
 expect(native.zoomPercent).toBe(zoom);
 // Native source order runs right to left. All six threshold bounds keep the
 // same physical X despite the one-twip table-indent change between pages.
 const nativeDelta=native.screens[1].map((glyph,i)=>glyph.bounds[0]-native.screens[0][i].bounds[0]);
 expect(nativeDelta).toEqual([0,0,0,0,0,0]);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async({bytes,scale})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,pkg);
  try{
   const canvases=editor.layout.pages.map(g=>{const c=document.createElement('canvas');c.width=Math.round(g.width*scale);c.height=Math.round(g.height*scale);return c;});
   editor.paint({canvases,interactive:false});
   const bounds=canvases.map(canvas=>{
    if(canvas.width!==192*scale||canvas.height!==240*scale)throw Error('Changed independent screen control dimensions');
    // This source contains exactly six black glyphs in the bounded table row.
    // Exclude its page label and blue borders; do not align or shift any ink.
    const left=30*scale,top=38*scale,width=110*scale,height=14*scale;
    const data=canvas.getContext('2d').getImageData(left,top,width,height).data,groups=[];
    for(let x=0;x<width;x++){
     let first=height,last=-1;
     for(let y=0;y<height;y++){const at=(y*width+x)*4;if(Math.max(data[at],data[at+1],data[at+2])<100){first=Math.min(first,y);last=y;}}
     if(last<0)continue;
     const prior=groups.at(-1);
     if(prior&&prior[2]===x+left-1){prior[2]=x+left;prior[1]=Math.min(prior[1],first+top);prior[3]=Math.max(prior[3],last+top);}
     else groups.push([x+left,first+top,x+left,last+top]);
    }
    return groups.reverse();
   });
   return {pages:editor.layout.pageCount,readOnly:!!pkg.readOnly,bounds,pictures:canvases.map(c=>c.toDataURL().split(',')[1])};
  }finally{editor.destroy();host.remove();}
 },{bytes:[...readFileSync(`${folder}/control.docx`)],scale:zoom/100});
 expect(actual.pages).toBe(2);expect(actual.readOnly).toBe(false);
 const minimumWidth=zoom===500?25:zoom/20,minimumHeight=zoom===500?25:zoom/30;
 for(const glyphs of actual.bounds){expect(glyphs).toHaveLength(6);for(const b of glyphs){expect(b[2]-b[0]).toBeGreaterThan(minimumWidth);expect(b[3]-b[1]).toBeGreaterThan(minimumHeight);}}
 actual.pictures.forEach((png,i)=>writeFileSync(info.outputPath(`viewer-${i}-${zoom}.png`),Buffer.from(png,'base64')));
 delete actual.pictures;
 actual.translationX=actual.bounds[1].map((glyph,i)=>glyph[0]-actual.bounds[0][i][0]);
 writeFileSync(info.outputPath('screen-bounds.json'),JSON.stringify(actual,null,2)+'\n');
 // Only this native placement check is a known failure. Source provenance,
 // loading, page count, editability and glyph isolation must succeed first.
 if(zoom!==500){
  // Compare relative bounds, not an inferred page/screen translation. Both
  // current zooms constrain spacing and extents as well as the paired move.
  const relative=rows=>rows.map(b=>b.map((value,i)=>value-rows[0][i%2]));
  for(let i=0;i<2;i++)expect(relative(actual.bounds[i])).toEqual(relative(native.screens[i].map(g=>g.bounds)));
 }else test.fail(true,'The viewer snaps some rotated glyphs by one pixel; native screen bounds stay unchanged at this zoom.');
 expect(actual.translationX).toEqual(nativeDelta);
});
