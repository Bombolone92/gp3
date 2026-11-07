import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';

for(const name of ['rgb64','gray256','matte-gray256'])test(`loads and round-trips the ${name} native lighting control`,async({page},info)=>{
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const source=readFileSync(`tests/fixtures/picture-3d-transfer/${name}/source.docx`);
  const result=await page.evaluate(async bytes=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
    const pictures=pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image));
    if(pictures.length!==3)throw new Error('Missing control pictures');
    if(pkg.readOnly)throw new Error('Control unexpectedly demoted to a partial preview');
    const black=pictures.map(run=>{
      const image=images.get(run.image.assetId),canvas=new OffscreenCanvas(image.bitmap.width,image.bitmap.height),ctx=canvas.getContext('2d');
      ctx.drawImage(image.bitmap,0,0);
      // The first grayscale tile is 10pt square; sample its flat center.
      return [...ctx.getImageData(Math.round((5*4/3-image.left)*2),Math.round((5*4/3-image.top)*2),1,1).data];
    });
    const first=pictures[0].image;
    const rebuilt=pkg.resizeDrawingPicture(first,first.width+127000,first.height+127000);
    pictures[0].image=rebuilt.image;pkg.assets[first.assetId]=rebuilt.asset;
    const output=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
    const reopened=await openCanvasDocument(output);
    const print=state=>{
      const host=document.createElement('div');document.body.append(host);
      const editor=new CanvasEditor(host,{...state.pkg,images:state.images});
      try{return editor.printSheets().map(sheet=>sheet.toDataURL());}finally{editor.destroy();host.remove();}
    };
    // Re-decode resized assets through the same import path before painting.
    const {decodeImages}=await import('/src/engine/images.js');
    const updated=await decodeImages(pkg.assets,pkg.styles.fontAlternatives);
    return {black,bytes:[...output],pages:print({pkg,images:updated}),reopened:print(reopened),
      dimensions:reopened.pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>[r.image.width,r.image.height]))};
  },[...source]);
  expect(result.pages).toHaveLength(3);expect(result.reopened).toEqual(result.pages);
  expect(result.dimensions).toEqual([[170*12700,170*12700],[160*12700,160*12700],[160*12700,160*12700]]);
  if(name==='matte-gray256'){
    expect(result.black.slice(1)).toEqual([[0,0,0,255],[0,0,0,255]]);
    expect(result.black[0].slice(0,3).every(channel=>channel>0)).toBe(true);
  }
  writeFileSync(info.outputPath('resized.docx'),Uint8Array.from(result.bytes));
});
