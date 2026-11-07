import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

test('translucent rectangle groups match native edge coverage exactly',async({page})=>{
 const folder='tests/fixtures/svg-group-rectangle-edges/';
 const source=readFileSync('public/fixtures/svg-group-rectangle-edges.docx');
 const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 expect(hash(source)).toBe(ref.sourceSha256);
 expect(hash(readFileSync(folder+'native.emf'))).toBe(ref.nativeSha256);
 for(const image of ref.images)expect(hash(readFileSync(folder+image.path))).toBe(image.sha256);
 await page.goto('/playground.html');
 const results=await page.evaluate(async({xml,refs})=>{
  const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
  const root=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;
  const original=new XMLSerializer().serializeToString(root),children=document.body.children.length;
  const output=nativeSvgStrokes(root,{width:120,height:80},true);
  const pixels=async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return [...ctx.getImageData(0,0,c.width,c.height).data];};
  const rows=[];
  for(const [i,image] of [...output.querySelectorAll('image')].entries()){
   const actual=await pixels(image.getAttribute('href')),native=await pixels(refs[i]);
   let different=0,max=0;
   for(let at=3;at<actual.length;at+=4){const error=Math.abs(actual[at]-native[at]);if(error)different++;max=Math.max(max,error);}
   rows.push({size:[+image.getAttribute('width'),+image.getAttribute('height')],origin:[+image.getAttribute('x'),+image.getAttribute('y')],length:actual.length,nativeLength:native.length,different,max});
  }
  return {rows,unchanged:original===new XMLSerializer().serializeToString(root),clean:children===document.body.children.length};
 },{xml:new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']),refs:ref.images.map(im=>'data:image/png;base64,'+readFileSync(folder+im.path).toString('base64'))});
 expect(results.clean).toBe(true);expect(results.unchanged).toBe(true);expect(results.rows).toHaveLength(6);
 for(const [i,row] of results.rows.entries()){
  expect(row.size).toEqual(ref.images[i].size);expect(row.origin).toEqual(ref.images[i].transform.slice(4));
  expect(row.length).toBe(row.nativeLength);expect(row.different,JSON.stringify({case:i,...row})).toBe(0);
 }
});
