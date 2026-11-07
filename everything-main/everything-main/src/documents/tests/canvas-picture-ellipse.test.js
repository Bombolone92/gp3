import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/picture-ellipse.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains ellipse-picture crop, flips, opacity and effects through editing and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);expect(before).toHaveLength(9);
 expect(before.every(s=>s.clipPaths[0].points[0][0]==='E')).toBe(true);
 expect(before[1].image.crop.left).toBe(25000);expect(before[2].image.flipH).toBe(true);expect(before[3].image.flipV).toBe(true);
 expect(before[4].image.flipH).toBe(true);expect(before[4].image.flipV).toBe(true);expect(before[5].image.crop.left).toBe(-50000);
 expect(before[6].image.opacity).toBe(.5);expect(p.assets[before[6].image.assetId].duotone).toEqual([['CC2244','FFFFFF']]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');const edited=await save();
 expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 for(const[n,b]of Object.entries(unzipSync(edited)))if(n!=='word/document.xml')expect(b).toEqual(p.parts[n]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});

it('keeps crop and flips when ellipse pictures use ordinary rectangular geometry',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const ns='http://schemas.openxmlformats.org/drawingml/2006/main';
 for(const geometry of xml.getElementsByTagNameNS(ns,'prstGeom'))geometry.setAttribute('prst','rect');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const pkg=await DocxPackage.open(zipSync(parts)),images=pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
 expect(images).toHaveLength(9);expect(images[1].crop.left).toBe(25000);expect(images[2].flipH).toBe(true);expect(images[3].flipV).toBe(true);
 expect(images[4].flipH&&images[4].flipV).toBe(true);expect(images[5].crop.left).toBe(-50000);expect(images[6].opacity).toBe(.5);
});

it('retains ellipse clipping in nested picture scenes and rejects adjusted ellipses',async()=>{
 const ns='http://schemas.openxmlformats.org/drawingml/2006/main',parts=unzipSync(readFileSync('public/fixtures/group-picture-flips.docx'));
 const xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 xml.getElementsByTagNameNS(ns,'prstGeom')[0].setAttribute('prst','ellipse');parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const p=await DocxPackage.open(zipSync(parts));expect(scenes(p)[0].children[0].children[0].clipPaths[0].points[0]).toEqual(['E']);
 const props=xml.getElementsByTagNameNS(ns,'prstGeom')[0],gd=xml.createElementNS(ns,'a:gd');gd.setAttribute('name','adjustment');gd.setAttribute('fmla','val 1');props.firstElementChild.append(gd);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
