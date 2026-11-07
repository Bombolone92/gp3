import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {svgOpacityFloat} from '../src/engine/svg-group-opacity.js';
it('binds independent SVG backdrop colors to original source and reference capture',()=>{
 const f='tests/fixtures/svg-backdrop-compositing/',ref=JSON.parse(readFileSync(f+'native-colors.json')),cases=JSON.parse(readFileSync(f+'cases.json'));
 for(const [name,key] of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256'],['native.emf','nativeSha256'],['capture.emf','captureSha256'],['gdi.png','gdiSha256']])expect(createHash('sha256').update(readFileSync(f+name)).digest('hex'),name).toBe(ref[key]);
 expect(cases).toHaveLength(36);expect(ref.colors).toHaveLength(36);expect(new Set(cases.map(c=>c.background)).size).toBe(4);
 const svg=strFromU8(unzipSync(readFileSync(f+'control.docx'))['word/media/vector.svg']);expect(svg.match(/<rect /g)).toHaveLength(76);
 for(const color of ref.colors){expect(color).toHaveLength(3);expect(color.every(c=>Number.isInteger(c)&&c>=0&&c<=255)).toBe(true);}
});
it('isolates separate byte rounding against all native solid-fill backdrop samples',()=>{
 const f='tests/fixtures/svg-backdrop-compositing/';
 const cases=JSON.parse(readFileSync(f+'cases.json')),ref=JSON.parse(readFileSync(f+'native-colors.json'));
 const rgb=hex=>hex.match(/../g).map(n=>parseInt(n,16));
 // A numerical diagnostic, not the production SVG painter: native opaque
 // backdrop centers distinguish separate byte rounding from one final round.
 const compose=(source,backdrop,opacity,separate)=>{
  const a=Math.floor(svgOpacityFloat(opacity)*255)/255;
  return source.map((v,i)=>separate?Math.min(255,Math.round(v*a)+Math.round(backdrop[i]*(1-a))):Math.round(v*a+backdrop[i]*(1-a)));
 };
 const samples=separate=>cases.map(c=>{
  const color=compose(rgb(c.color),rgb(c.background),c.opacity,separate);
  return c.overlay?compose(rgb(c.overlay.color),color,c.overlay.opacity,separate):color;
 });
 expect(samples(true)).toEqual(ref.colors);
 expect(samples(false)).not.toEqual(ref.colors);
});
