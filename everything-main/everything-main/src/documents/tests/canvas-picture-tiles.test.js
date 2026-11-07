import { beforeAll,afterAll,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync,zipSync,strToU8,strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pictureTileGeometry,readPictureTile } from '../src/engine/picture-tiles.js';
import { pictureResolution } from '../src/engine/picture-resolution.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/shape-picture-tiles-extended.docx'),reference=JSON.parse(readFileSync('tests/fixtures/picture-tiles/reference.json'));
const scenes=p=>p.paragraphs.flatMap(paragraph=>paragraph.runs.filter(r=>r.image).map(r=>p.assets[r.image.assetId].scene));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
function equalParts(actual,expected) {
 expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
 for(const key of Object.keys(expected))expect(Buffer.from(actual[key]).equals(Buffer.from(expected[key])),key).toBe(true);
}
it('matches independent native reference pattern size and alignment, including cropped tiles and embedded DPI',async()=>{
 const pkg=await DocxPackage.open(source),nodes=scenes(pkg);expect(nodes).toHaveLength(23);
 expect(scenes(await DocxPackage.open(readFileSync('public/fixtures/shape-picture-tiles-reference.docx')))).toEqual(nodes.slice(0,19));
 reference.cases.forEach((ref,i)=>{
  const n=nodes[i],g=pictureTileGeometry(n.fill,n.width,n.height,64,64);
  if(!ref.pattern){expect(g).toBeNull();return;}
  for(const k of ['x','y','width','height'])expect(g[k]/12700).toBeCloseTo(ref.pattern[k],1);
 });
 expect(nodes[5].fill.tile.flip).toBe('x');expect(nodes[7].fill.tile.flip).toBe('xy');
});
it('preserves tiled shape XML and all unrelated parts through edits, export and undo',async()=>{
 const pkg=await DocxPackage.open(source),d=model(pkg);equalParts(await save(pkg,d),pkg.parts);
 d.select(0);d.replace('Edited ');const parts=await save(pkg,d),again=await DocxPackage.open(zipSync(parts));expect(scenes(again)).toEqual(scenes(pkg));
 expectBodyEditParts(parts,pkg.parts);
 d.undo();equalParts(await save(pkg,d),pkg.parts);
});
it('reads PNG, JFIF and EXIF density without decoding pixels',()=>{
 const parts=unzipSync(source);
 for(const name of ['tile-144.png','tile-jfif.jpeg','tile-exif.jpeg','tile-conflict.jpeg']) {
  const d=pictureResolution(parts['word/media/'+name]);expect(d.x).toBeCloseTo(144,1);expect(d.y).toBeCloseTo(144,1);
 }
 const anis=pictureResolution(parts['word/media/tile-anisotropic.png']);expect(anis.x).toBeCloseTo(144,1);expect(anis.y).toBeCloseTo(72,1);
 expect(pictureResolution(new Uint8Array())).toEqual({x:96,y:96});
 // Truncated resolution markers fall back without out-of-range reads.
 for(let i=0;i<100;i++)expect(()=>pictureResolution(parts['word/media/tile-exif.jpeg'].subarray(0,i))).not.toThrow();
});
it.each(['sx="bad"','algn="diagonal"','flip="z"','tx="1%"','sx="2147483648"','unexpected="1"'])('rejects malformed tile attributes %s',raw=>{
 const n=new DOMParser().parseFromString(`<a:tile xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ${raw}/>`,'application/xml').documentElement;
 expect(()=>readPictureTile(n)).toThrow();
});
it('accepts percentage scales and empty/nonpositive tiles without unbounded drawing loops',()=>{
 const n=new DOMParser().parseFromString('<tile sx="50%" sy="0"/>','application/xml').documentElement,tile=readPictureTile(n);expect(tile.sx).toBe(50000);
 expect(pictureTileGeometry({tile:{...tile,width:64,height:64},image:{crop:{}}},288,216,64,64)).toBeNull();
});
it('rejects conflicting stretch and tile modes before editing',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<a:tile','<a:stretch><a:fillRect/></a:stretch><a:tile'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/conflicting/);
});

it('guards nonrotating tile fills on rotated shapes instead of painting them with the wrong transform',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const ns='http://schemas.openxmlformats.org/drawingml/2006/main';
 xml.getElementsByTagNameNS(ns,'blipFill')[0].setAttribute('rotWithShape','0');
 xml.getElementsByTagNameNS(ns,'xfrm')[0].setAttribute('rot','1800000');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/nonrotating tiled/);
});
