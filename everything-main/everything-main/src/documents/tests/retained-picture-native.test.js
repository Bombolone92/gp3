import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {A} from '../src/engine/docx-images.js';

const folder='tests/fixtures/retained-picture-resize/native';
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

for(const stage of ['before','after'])it(`matches native ${stage} picture frames, locks and physical effect properties`,async()=>{
  const bytes=readFileSync(`${folder}/${stage}.docx`),capture=json(`${folder}/${stage}/capture.json`);
  expect(sha(bytes)).toBe(capture.sourceSha256);expect(capture.sourceUnchanged).toBe(true);
  expect(capture.savedBefore).toBe(capture.savedAfter);expect(capture.viewBefore).toEqual(capture.viewAfter);
  expect(capture.captures).toHaveLength(9);
  for(const item of capture.captures)expect(sha(readFileSync(`${folder}/${stage}/${item.file}`))).toBe(item.sha256);
  const pkg=await DocxPackage.open(bytes),images=pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
  expect(images).toHaveLength(9);
  for(const image of images){
    const native=capture.native.find(n=>n.id===image.id);expect(native).toBeTruthy();
    let width=image.width/12700;
    const relative=image.anchor?.relativeSize?.width;
    if(relative)width=(pkg.pageSettings.width-(relative.base==='margin'?pkg.pageSettings.left+pkg.pageSettings.right:0))/20*relative.percentage/100000;
    // The reference automation API returns single-precision point dimensions, not ink bounds.
    expect(native.widthPt).toBe(Math.fround(width));expect(native.heightPt).toBe(Math.fround(image.height/12700));
    expect(native.lockAspectRatio).toBe(image.aspectLocked?-1:0);
    const xml=new DOMParser().parseFromString(image.shell,'application/xml');
    const node=name=>xml.getElementsByTagNameNS(A,name)[0];
    const line=node('ln'),shadow=node('outerShdw'),solid=node('sp3d');
    if(line?.hasAttribute('w'))expect(native.physical.outlineWidthPt).toBe(Math.fround(Number(line.getAttribute('w'))/12700));
    if(shadow){
      const distance=Number(shadow.getAttribute('dist'))/12700,angle=Number(shadow.getAttribute('dir'))/60000*Math.PI/180;
      expect(native.physical.shadowBlurPt).toBe(Math.fround(Number(shadow.getAttribute('blurRad'))/12700));
      expect(native.physical.shadowOffsetXPt).toBe(Math.fround(distance*Math.cos(angle)));
      expect(native.physical.shadowOffsetYPt).toBe(Math.fround(distance*Math.sin(angle)));
    }
    if(solid)expect(native.physical.extrusionDepthPt).toBe(Math.fround(Number(solid.getAttribute('extrusionH'))/12700));
  }
});

it('reproduces the captured resized shell with unchanged unrelated parts',async()=>{
  const before=unzipSync(readFileSync(`${folder}/before.docx`)),after=unzipSync(readFileSync(`${folder}/after.docx`));
  for(const [name,data] of Object.entries(before))if(name!=='word/document.xml')expect(after[name]).toEqual(data);
  const pkg=await DocxPackage.open(readFileSync(`${folder}/before.docx`));
  for(const p of pkg.paragraphs)for(const run of p.runs)if(run.image&&!run.image.anchor?.relativeSize){
    const image=run.image,width=image.width+228600,height=image.aspectLocked?Math.round(width*image.height/image.width):image.height+66675;
    const rebuilt=pkg.resizeDrawingPicture(image,width,height);run.image=rebuilt.image;pkg.assets[image.assetId]=rebuilt.asset;
  }
  const bytes=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
  const actual=unzipSync(bytes);
  for(const [name,data] of Object.entries(after))if(name!=='word/document.xml')expect(actual[name]).toEqual(data);
  const tree=bytes=>{
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const element=node=>({namespace:node.namespaceURI,name:node.localName,
      attributes:[...node.attributes].filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/').map(a=>[a.namespaceURI,a.localName,a.value]).sort(),
      children:[...node.childNodes].map(n=>n.nodeType===1?element(n):n.nodeType===3?n.textContent:null).filter(n=>n!==null)});
    return element(doc.documentElement);
  };
  // Namespace declaration placement differs between DOM implementations.
  // Require valid XML and identical expanded names/attributes/content instead.
  expect(tree(actual['word/document.xml'])).toEqual(tree(after['word/document.xml']));
  const reopened=await DocxPackage.open(bytes);
  expect(reopened.paragraphs.flatMap(p=>p.runs.filter(r=>r.image))).toHaveLength(9);
});
