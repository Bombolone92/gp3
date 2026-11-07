import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {readPicture3d} from '../src/engine/docx-picture-3d.js';
import {create3dShader} from '../src/engine/drawing-3d-lighting.js';
import {projection3d,intersectExtrusion} from '../src/engine/drawing-3d-geometry.js';

const root='tests/fixtures/picture-3d-transfer/matte-gray256';
const source=readFileSync(`${root}/source.docx`);
const scenes=pkg=>Object.values(pkg.assets).filter(asset=>asset.scene?.type==='picture3d').map(asset=>asset.scene);
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('imports matte picture lighting without demoting the document to a partial preview',async()=>{
  const pkg=await DocxPackage.open(source);
  expect(pkg.readOnly).not.toBe(true);
  expect(scenes(pkg).map(scene=>scene.lighting)).toEqual([
    {rig:'threePt',direction:'t'},
    {rig:'threePt',direction:'t',material:'matte'},
    {rig:'twoPt',direction:'t',material:'matte'},
  ]);
});

it('retains all matte declarations and unrelated package parts through text edit, reopen and exact undo',async()=>{
  const pkg=await DocxPackage.open(source),before=scenes(pkg);
  const model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer());
  model.select(0);model.replace('Edited ');
  const output=await save(),parts=unzipSync(output);
  expect(scenes(await DocxPackage.open(output))).toEqual(before);
  for(const [name,bytes] of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(bytes);
  model.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
},30000);

it('keeps matte material and physical extrusion/contour properties through retained resizing',async()=>{
  const pkg=await DocxPackage.open(source);
  const run=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image&&r.image.id===2);
  const before=scenes(pkg)[1],rebuilt=pkg.resizeDrawingPicture(run.image,170*12700,170*12700);
  run.image=rebuilt.image;pkg.assets[run.image.assetId]=rebuilt.asset;
  const output=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
  const after=scenes(await DocxPackage.open(output))[1];
  expect(after.lighting).toEqual(before.lighting);expect(after.depth).toBe(10);expect(after.contour).toBe(2);
  expect([after.width,after.height]).toEqual([170*12700,170*12700]);
});

it('accepts exactly the supported materials and keeps invalid presets protected',()=>{
  const parse=material=>readPicture3d(new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="rect"/><a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d prstMaterial="${material}"/></a:spPr>`,'application/xml').documentElement);
  expect(parse('matte').lighting.material).toBe('matte');
  expect(parse('warmMatte').lighting).toEqual({rig:'threePt',direction:'t'});
  for(const material of ['metal','plastic','',' matte','MATTE'])expect(()=>parse(material)).toThrow(/material/);
});

it('matte has no specular energy and exposes native diffuse quantization as a separate gap',()=>{
  const ref=JSON.parse(readFileSync(`${root}/reference.json`,'utf8'));
  for(const row of ref.measurements.filter(row=>row.case.material==='matte')){
    const shader=create3dShader({rig:row.case.rig,material:'matte'});
    expect(shader([0,0,0],[0,0,1],[0,0,1])).toEqual(row.colors[0]);
    expect(shader([80,80,80],[0,0,1],[0,0,1])).toEqual(shader([80,80,80],[0,0,1],[1,1,1]));
  }
});

it('preserves native perspective samples that a per-light quantization candidate regresses',()=>{
  const refs=JSON.parse(readFileSync('tests/fixtures/picture-lighting/reference.json','utf8'));
  const cases=[['threePt-0-perspectiveRight',[155,38,32],{rig:'threePt'}],
    ['twoPt-270-perspectiveRight',[255,59,49],{rig:'twoPt',revolution:270}],
    ['twoPt-270-perspectiveLeft',[31,80,208],{rig:'twoPt',revolution:270}]];
  for(const [name,rgb,options] of cases){
    const c=refs.cases.find(c=>c.name===name);
    const sample=[...c.samples,...c.sideSamples].find(s=>s.rgb.every((v,i)=>v===rgb[i]));
    expect(sample).toBeTruthy();
    const camera=projection3d({turn:c.camera==='perspectiveRight'?20:-20,perspective:true});
    const ray=camera.ray(sample.x-172,sample.y-194),hit=intersectExtrusion(ray,{width:144,height:108,depth:20,geometry:'rect'});
    const [x,y]=hit.point,color=y<0?(x<0?[240,40,30]:[30,80,210]):(x<0?[40,170,70]:[240,180,20]);
    expect(create3dShader(options)(color,hit.normal,ray.direction.map(v=>-v))).toEqual(rgb);
  }
});
