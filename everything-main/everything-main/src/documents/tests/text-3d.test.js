import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {text3dSurface,checkedText3d} from '../src/engine/text-3d.js';

let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/text-3d/control.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const letters=d=>d.paragraphs.flatMap(p=>p.runs).filter(r=>r.text==='Ao');
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const sameParts=(a,b,except=[])=>{expect(Object.keys(a)).toEqual(Object.keys(b));for(const n of Object.keys(a))if(!except.includes(n))expect(a[n],n).toEqual(b[n]);};

it('resolves independent text 3D declarations and empty inheritance overrides without changing package data',async()=>{
  const p=await DocxPackage.open(source),d=model(p),runs=letters(d);
  expect(p.readOnly).toBeFalsy();expect(runs).toHaveLength(10);
  expect(text3dSurface(runs[0])).toBeNull();expect(text3dSurface(runs[1])).toBeNull();
  expect(text3dSurface(runs[2])).toMatchObject({depth:57150,width:0,height:0,material:'warmMatte'});
  expect(text3dSurface(runs[3])).toMatchObject({depth:0,width:63500,height:12700});
  expect(text3dSurface(runs[5])).toMatchObject({material:'matte'});
  expect(text3dSurface(runs[8])).toEqual(text3dSurface(runs[5]));
  expect(runs[9].text3d).toContain('props3d');expect(text3dSurface(runs[9])).toBeNull();
  sameParts(unzipSync(await save(p,d)),p.parts);
});

it('retains direct and inherited effects through text insertion, color changes, undo and reopen',async()=>{
  const p=await DocxPackage.open(source),d=model(p);
  const at=d.text.indexOf('Ao',d.text.indexOf('bevel-extrusion-matte'));
  d.select(at,at+2);d.setRunFormat({color:'112233'});d.select(at+1);d.replace('x');
  const bytes=await save(p,d);sameParts(unzipSync(bytes),p.parts,['word/document.xml']);
  const reopened=model(await DocxPackage.open(bytes));
  const r=reopened.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='Axo');
  expect(r.color).toBe('112233');expect(text3dSurface(r)).toMatchObject({material:'matte',width:63500});
  expect(letters(reopened).some(r=>text3dSurface(r)?.material==='matte')).toBe(true);
  d.undo();d.undo();sameParts(unzipSync(await save(p,d)),p.parts);
});

it('keeps unsupported scene declarations intact and recognizes explicit supported lighting',async()=>{
  const bytes=readFileSync('tests/fixtures/text-3d/scene-control.docx');
  const p=await DocxPackage.open(bytes),d=model(p),runs=letters(d);
  expect(runs).toHaveLength(8);
  for(const base of [0,4]){
    expect(text3dSurface(runs[base])).toEqual(text3dSurface(runs[base+1]));
    expect(text3dSurface(runs[base+2])).toBeNull();
    expect(runs[base+2].textScene).toContain('balanced');
    expect(text3dSurface(runs[base+3])).toMatchObject({rig:'twoPt'});
  }
  sameParts(unzipSync(await save(p,d)),p.parts);
});

it('rejects other XML roots and entity declarations as effect edits',()=>{
  for(const xml of ['<wrong/>','<!DOCTYPE x [<!ENTITY x "bad">]><x/>'])
    expect(()=>checkedText3d(xml,'text3d')).toThrow();
});
