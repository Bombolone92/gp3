import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {svgInfo} from '../src/engine/svg-images.js';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/svg-masks.docx'),parts=unzipSync(source);
const svg=body=>strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">${body}</svg>`);
it('imports masks, matrices and both embedded raster types without changing source media',async()=>{
  expect(svgInfo(parts['word/media/vector.svg'])).toMatchObject({width:120,height:80});
  const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const save=async()=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
  // Compare retained package parts as bytes; deep array assertions dominate
  // this archive round-trip workflow and can exhaust its test timeout.
  const equal=(out,edited=false)=>{expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)return expectBodyEditParts(out,parts);for(const n of Object.keys(parts))expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
  equal(await save());d.select(0);d.replace('Edited ');const edited=await save();equal(edited,true);
  const reopened=await DocxPackage.open(zipSync(edited));expect(reopened.assets['word/media/vector.svg'].bytes).toEqual(parts['word/media/vector.svg']);
  d.undo();equal(await save());
}, 30000); // Complete ZIP equality/edit/reopen/undo workflow, not a render-time benchmark.
it.each([
  '<mask id="a"><rect mask="url(#a)"/></mask>',
  '<mask id="a"><rect mask="url(#b)"/></mask><mask id="b"><rect mask="url(#a)"/></mask>',
  '<style>.loop { mask:url(#a) }</style><mask id="a"><rect class="loop"/></mask>',
  '<filter id="f"><feColorMatrix values="1 2"/></filter>',
  '<filter><feColorMatrix values="NaN"/></filter>',
  '<filter><feColorMatrix in="missing"/></filter>',
  '<filter><feColorMatrix in="BackgroundImage"/></filter>',
  '<filter><feColorMatrix type="invalid"/></filter>',
  '<filter><feColorMatrix type="constructor"/></filter>',
  '<filter><feGaussianBlur stdDeviation="3"/></filter>',
  '<feColorMatrix/>',
  '<mask maskUnits="bad"/>',
  '<rect maskUnits="userSpaceOnUse"/>',
  '<rect filter="blur(3px)"/>',
  '<rect mask="url(https://example.invalid/m.svg)"/>',
  '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
  '<image href="data:image/png;base64,%%%%"/>',
  '<image href="data:image/png;base64,YQ=="/>',
])('guards unsupported or recursive SVG resources: %s',body=>expect(()=>svgInfo(svg(body))).toThrow());
it('checks embedded MIME and aggregate decoded dimensions',()=>{
  const original=strFromU8(parts['word/media/vector.svg']);
  expect(()=>svgInfo(strToU8(original.replace('data:image/png;','data:image/jpeg;')))).toThrow(/MIME/);
  const match=/data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(original),png=Buffer.from(match[1],'base64');
  png.writeUInt32BE(8192,16);png.writeUInt32BE(8192,20);
  expect(()=>svgInfo(svg(`<image href="data:image/png;base64,${png.toString('base64')}"/>`))).toThrow(/megapixels/);
  png.writeUInt32BE(4096,16);png.writeUInt32BE(2048,20);
  expect(()=>svgInfo(svg(`<image href="data:image/png;base64,${png.toString('base64')}"/>`.repeat(3)))).toThrow(/pixels exceed/);
});
it('bounds reused mask expansion without expanding the graph',()=>{
  const masks=Array.from({length:16},(_,i)=>`<mask id="m${i}">${i?`<rect mask="url(#m${i-1})"/><circle mask="url(#m${i-1})"/>`:'<rect/>'}</mask>`).join('');
  expect(()=>svgInfo(svg(masks))).toThrow(/complexity/);
});
it('allows chained matrices with earlier named results and default values',()=>{
  expect(svgInfo(svg('<filter id="f"><feColorMatrix result="first"/><feColorMatrix in="first" type="saturate" values="0.5"/><feColorMatrix type="hueRotate" values="-90"/><feColorMatrix type="luminanceToAlpha"/></filter><rect filter="url(#f)"/>'))).toMatchObject({width:120});
});
