import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const root='tests/fixtures/ellipse-native-geometry/';
const source=readFileSync(root+'control.docx'),cases=JSON.parse(readFileSync(root+'cases.json'));
const reference=JSON.parse(readFileSync(root+'reference.json'));
const screen=JSON.parse(readFileSync(root+'native-screen-reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('binds independent native ellipse geometry to the unchanged authored package',()=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(reference.sourceSha256);
  expect(hash(readFileSync(root+'native.emf'))).toBe(reference.nativeSha256);
  expect(reference.sourceUnchanged && reference.captureReadOnly).toBe(true);
  expect(reference.paths).toHaveLength(16);
  for(const path of reference.paths) {
    expect(path.points).toHaveLength(13);
    expect(path.points[0]).toEqual(path.points[12]);
  }
  // Native pen precision differs for the same half-point pen on unequal axes.
  expect(reference.paths[0].pen*.12).toBe(.5025);
  expect(reference.paths[3].pen*.12).toBe(.495);
});

it('binds native screen references to all three independent packages and recorded page edges',()=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  expect(screen.observations).toHaveLength(7);
  for(const observation of screen.observations){
    expect(hash(readFileSync(root+observation.fixture+'.docx'))).toBe(observation.sourceSha256);
    expect(hash(readFileSync(root+observation.crop))).toBe(observation.cropSha256);
    expect(observation.regions).toHaveLength(16);
    expect(observation.captureFormat).toBe('JPEG');
  }
});

it('preserves declared circle/ellipse geometry and source parts through editing and undo',async()=>{
  const pkg=await DocxPackage.open(source),assets=Object.values(pkg.assets).filter(a=>a.scene);
  expect(pkg.readOnly).not.toBe(true);expect(assets).toHaveLength(cases.length);
  for(const [i,asset] of assets.entries()) {
    expect(asset.scene.width).toBe(cases[i].widthEmu);
    expect(asset.scene.height).toBe(cases[i].heightEmu);
    expect(asset.scene.outline.width).toBe(cases[i].penEmu);
    expect(asset.scene.paths[0].points).toEqual([['E'],['Z']]);
  }
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>unzipSync(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()));
  const before=unzipSync(source);expect(await save()).toEqual(before);
  doc.select(0);doc.replace('Edited ');const edited=await save();
  for(const part of Object.keys(before))if(part!=='word/document.xml')expect(edited[part],part).toEqual(before[part]);
  doc.undo();expect(await save()).toEqual(before);
});
