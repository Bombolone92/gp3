import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {drawingPaintColor,drawingEffectColor,drawingColor} from '../src/engine/docx-drawing-style.js';
import {DocxPackage} from '../src/engine/docx.js';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const color=xml=>new DOMParser().parseFromString(`<a:sysClr xmlns:a="${A}" ${xml}`,'application/xml').documentElement;
it('uses the system binding rather than a contradictory producer cache',()=>{
 expect(drawingPaintColor(color('val="window" lastClr="FF0000"/>'))).toBe('#FFFFFF');
 expect(drawingPaintColor(color('val="windowText" lastClr="0000FF"/>'))).toBe('#000000');
 expect(drawingPaintColor(color('val="highlight"/>'))).toBe('#0078D7');
 expect(drawingPaintColor(color('val=" window " lastClr=" aabbcc "/>'))).toBe('#FFFFFF');
});
it('applies existing transforms in order and retains transparency for effects',()=>{
 const n=color('val="windowText"><a:tint val="50000"/><a:alpha val="50000"/></a:sysClr>');
 expect(drawingPaintColor(n)).toBe('rgba(188,188,188,0.5)');
 expect(drawingEffectColor(n)).toEqual({rgb:'BCBCBC',alpha:.5});
 expect(()=>drawingColor(n)).toThrow(/transparency/);
});
it.each(['val="unknown"/>','val="constructor"/>','val="Window"/>','lastClr="FFFFFF"/>','val="window" lastClr="oops"/>','val="window" lastClr="FFFFFF00"/>','val="window" unexpected="1"/>','val="window"><a:unknown/></a:sysClr>'])('rejects invalid system color %s',xml=>{expect(()=>drawingPaintColor(color(xml))).toThrow();});
it('imports all independent system color controls and retains the source on no-edit export',async()=>{
 const source=readFileSync('public/fixtures/system-colors.docx'),pkg=await DocxPackage.open(source);
 expect(Object.values(pkg.assets).filter(a=>a.scene)).toHaveLength(36);
 const parts=unzipSync(source),out=unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
 for(const n of Object.keys(parts))expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
it('keeps malformed drawing colors read-only without changing the source package',async()=>{
 const parts=unzipSync(readFileSync('public/fixtures/system-colors.docx'));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('val="scrollBar"','val="notAColor"'));const source=zipSync(parts);
 await expect(DocxPackage.open(source)).rejects.toMatchObject({name:'UnsupportedDocumentError'});
 const p=await DocxPackage.open(source,{bestEffort:true});expect(p.readOnly).toBe(true);
 expect(()=>p.export()).toThrow(/read-only/);for(const n of Object.keys(parts))expect(Buffer.from(p.parts[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
it.each(['fillRef','lnRef','fontRef','effectRef'])('resolves system bindings through a %s style reference like the equivalent RGB color',async ref=>{
 const original=unzipSync(readFileSync('public/fixtures/shape-theme.docx'));
 const variant=kind=>{
  const parts={...original},xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const refs=[...xml.getElementsByTagNameNS(A,ref)];expect(refs.length).toBeGreaterThan(0);
  for(const r of refs){const old=r.firstElementChild;if(!old)continue;const n=xml.createElementNS(A,'a:'+kind);n.setAttribute('val',kind==='sysClr'?'highlight':'0078D7');if(kind==='sysClr')n.setAttribute('lastClr','FF0000');for(const c of [...old.children])n.append(c.cloneNode(true));r.replaceChild(n,old);}
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);
 };
 const p=await DocxPackage.open(variant('sysClr')),expected=await DocxPackage.open(variant('srgbClr'));
 expect(Object.values(p.assets).map(a=>a.scene)).toEqual(Object.values(expected.assets).map(a=>a.scene));
});
