import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';

test('retained picture export preserves native frame changes and reopens with identical print pixels',async({page},info)=>{
  test.setTimeout(180000);
  const folder='tests/fixtures/retained-picture-resize/native';
  const source=readFileSync(`${folder}/before.docx`);
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
    const host=document.createElement('div');document.body.append(host);
    const editor=new CanvasEditor(host,{...pkg,images});
    try{
      const changes=[];
      for(const p of pkg.paragraphs)for(const run of p.runs)if(run.image&&!run.image.anchor?.relativeSize){
        const image=run.image,width=image.width+228600,height=image.aspectLocked?Math.round(width*image.height/image.width):image.height+66675;
        const rebuilt=pkg.resizeDrawingPicture(image,width,height);
        run.image=rebuilt.image;pkg.assets[image.assetId]=rebuilt.asset;
        changes.push({id:image.id,width,height,aspectLocked:image.aspectLocked});
      }
      const output=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
      return {bytes:[...output],changes};
    }finally{editor.destroy();host.remove();}
  },[...source]);
  expect(result.changes).toEqual(JSON.parse(readFileSync(`${folder}/changes.json`,'utf8')));
  const bytes=Uint8Array.from(result.bytes),parts=unzipSync(bytes);
  const expected=unzipSync(readFileSync(`${folder}/after.docx`));
  expect(Object.keys(parts).sort()).toEqual(Object.keys(expected).sort());
  for(const [name,data] of Object.entries(expected))if(name!=='word/document.xml')expect(parts[name]).toEqual(data);
  const comparison=await page.evaluate(async({actual,expected})=>{
    const tree=bytes=>{
      const doc=new DOMParser().parseFromString(new TextDecoder().decode(Uint8Array.from(bytes)),'application/xml');
      if(doc.querySelector('parsererror'))throw new Error('Invalid exported XML');
      const element=node=>({namespace:node.namespaceURI,name:node.localName,
        attributes:[...node.attributes].filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/').map(a=>[a.namespaceURI,a.localName,a.value]).sort(),
        children:[...node.childNodes].map(n=>n.nodeType===1?element(n):n.nodeType===3?n.textContent:null).filter(n=>n!==null)});
      return element(doc.documentElement);
    };
    return [tree(actual),tree(expected)];
  },{actual:[...parts['word/document.xml']],expected:[...expected['word/document.xml']]});
  expect(comparison[0]).toEqual(comparison[1]);
  writeFileSync(info.outputPath('resized.docx'),bytes);
  const prints=[];
  for(const file of [bytes,readFileSync(`${folder}/after.docx`)]){
    prints.push(await page.evaluate(async bytes=>{
      const {openCanvasDocument}=await import('/src/engine/open-document.js');
      const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
      const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
      const host=document.createElement('div');document.body.append(host);
      const editor=new CanvasEditor(host,{...pkg,images});
      try{return editor.printSheets().map(c=>c.toDataURL());}finally{editor.destroy();host.remove();}
    },[...file]));
  }
  expect(prints[0]).toHaveLength(9);expect(prints[0]).toEqual(prints[1]);
});
