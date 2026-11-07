import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {layoutTableBorders} from '../src/engine/table-border-layout.js';
import {deviceTableBorders} from '../src/engine/border-device-layout.js';
import {deviceTableBorders as rejected} from './fixtures/border-shared-origin/rejected-candidate.js';
const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/border-leading-candidate.json'));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

it('retains every measured edge of the leading-only experiment, without mistaking aggregate gains for safety',()=>{
 expect(sha('tests/fixtures/border-shared-origin/rejected-candidate.js')).toBe(evidence.candidateSha256);
 for(const [file,hash]of Object.entries({...evidence.referenceHashes,...evidence.pairedSourceHashes}))expect(sha(file)).toBe(hash);
 let edges=0,improved=0,worse=0,leading=0,frames=0;
 for(const entry of evidence.entries){
  expect(sha(entry.source)).toBe(entry.sourceSha256);
  for(const o of entry.observations)for(const r of o.rows){
   frames++;
   for(let i=0;i<4;i++){
    expect(Number.isFinite(r.baseline[i])&&Number.isFinite(r.candidate[i])).toBe(true);
    const a=Math.abs(r.baseline[i]-r.native[i]),b=Math.abs(r.candidate[i]-r.native[i]);
    edges++;improved+=b<a;worse+=b>a;
    if(!entry.source.endsWith('filled.docx')&&!entry.source.endsWith('borderless.docx')&&i<2){expect(r.candidate[i]).toBe(r.native[i]);leading++;}
    if(i>=2)expect(r.candidate[i]).toBe(r.baseline[i]);
   }
  }
 }
 expect({edges,improved,worse,leading,frames}).toEqual({edges:2048,improved:444,worse:0,leading:896,frames:512});
});

it('binds identical native shared-border records and rejects the isolated top-origin formula on connected cells',()=>{
 const folder='tests/fixtures/border-shared-origin/',ref=JSON.parse(readFileSync(folder+'reference.json'));
 expect(sha(folder+'native-capture.json')).toBe(ref.captureSha256);
 const metadata=JSON.parse(readFileSync(folder+'native-capture.json','utf8').replace(/^\uFEFF/,''));
 expect(ref.sources).toHaveLength(2);
 for(const s of ref.sources){
  expect(sha(folder+s.owner+'.docx')).toBe(s.sourceSha256);
  const meta=metadata.find(m=>m.owner===s.owner);expect(meta.sourceUnchanged).toBe(true);expect(meta.savedAfter).toBe(true);expect(meta.characters).toBe('');
  const zipped=readFileSync(folder+'native-'+s.owner+'.emf.gz'),raw=gunzipSync(zipped);
  expect(sha(folder+'native-'+s.owner+'.emf.gz')).toBe(s.emfSha256);
  expect(createHash('sha256').update(raw).digest('hex')).toBe(s.emfRawSha256);expect(s.emfRawSha256).toBe(meta.emfSha256);
  const rects=[];
  for(let at=0;at<raw.length;){const kind=raw.readUInt32LE(at),size=raw.readUInt32LE(at+4);expect(size).toBeGreaterThanOrEqual(8);expect(at+size).toBeLessThanOrEqual(raw.length);
   if(kind===76){expect(size).toBe(100);expect(raw.readUInt32LE(at+40)).toBe(0xF00021);expect([...raw.subarray(at+84,at+100)]).toEqual(Array(16).fill(0));rects.push([24,28,32,36].map(i=>raw.readInt32LE(at+i)));}at+=size;
  }
  expect(rects).toEqual(s.rectangles);expect(rects).toHaveLength(25);
  for(const o of s.observations){expect(sha(folder+o.crop)).toBe(o.cropSha256);expect(o.vertical).toEqual(o.zoom===100?[[23,24],[63,64],[103,104]]:[[47,48],[127,128],[207,208]]);expect(o.horizontal).toEqual(o.zoom===100?[[21,22],[61,62],[100,101]]:[[41,42],[121,122],[201,202]]);}
 }
 expect(ref.sources[0].rectangles).toEqual(ref.sources[1].rectangles);
 expect(ref.sources[0].rectangles[0][1]).toBe(Math.floor(309*5/12));
 // Both metafile projection and the previously fitted leading rule predict 20.
 // Actual connected-table screen ink starts at 21, with the paper origin fixed
 // independently by the visible outline. No per-template adjustment is valid.
 expect(Math.round(ref.sources[0].rectangles[0][1]*.16)).toBe(20);
 expect(Math.round(Math.floor((309*5-1)/12)*.16)).toBe(20);
 expect(ref.sources[0].observations[0].native[1]).toBe(21);
});

it('rejects side-dependent leading quantization on equivalent resolved shared rules',()=>{
 const border={style:'single',size:2,color:'000000',space:0},y=314/15;
 const shared=strokes=>strokes.filter(s=>s.horizontal&&s.cellIds.length===2).map(({x,y,width,height,bandEnds})=>({x,y,width,height,bandEnds}));
 const results={};
 for(const owner of ['top','bottom']){
  const cells=Array.from({length:4},(_,i)=>({id:String(i),tableId:'t',page:0,x:20+i%2*40,y:y+Math.floor(i/2)*40,width:40,height:40,
   borderInsets:{top:0,bottom:1/3,left:1/6,right:1/6},borders:{top:border,bottom:border,left:border,right:border}}));
  for(const c of cells)if(owner==='top'&&c.y===y)c.borders.bottom=undefined;else if(owner==='bottom'&&c.y!==y)c.borders.top=undefined;
  const source=layoutTableBorders(cells),before=JSON.stringify(source),ctx={getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})};
  results[owner]={logical:shared(source),current:shared(deviceTableBorders(ctx,source)),candidate:shared(rejected(ctx,source))};
  expect(JSON.stringify(source)).toBe(before);
 }
 expect(results.top.logical).toEqual(results.bottom.logical);
 expect(results.top.current).toEqual(results.bottom.current);
 expect(results.top.candidate.map(s=>s.y)).toEqual([60,60]);
 expect(results.bottom.candidate.map(s=>s.y)).toEqual([61,61]);
 expect(results.top.candidate).not.toEqual(results.bottom.candidate);
});
