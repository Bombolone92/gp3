import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/border-axis-phase/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');

it('binds the new live-screen control and rejects nominal nearest projection of 24 bottoms',()=>{
 const screen=JSON.parse(readFileSync(folder+'screen-reference.json'));
 expect(screen.sourceSha256).toBe(ref.sourceSha256);expect(screen.casesSha256).toBe(ref.casesSha256);
 expect(screen.nativeReferenceSha256).toBe(sha(readFileSync(folder+'reference.json')));
 expect(screen.zoom).toBe(100);expect(screen.threshold).toBe(128);
 expect(screen.savedAtCapture).toBe(true);expect(screen.savedBeforePaginationQuery).toBe(true);
 expect(screen.savedAfterPaginationQuery).toBe(false);
 expect(screen.observations).toHaveLength(8);
 const edges=[0,0,0,0];
 for(const p of screen.observations){
  expect(sha(readFileSync(folder+p.crop))).toBe(p.cropSha256);
  expect(p.comparisons).toHaveLength(16);
  for(const c of p.comparisons){
   const geometry=ref.pages[p.page-1].tables[c.id-1];
   expect(c.projected).toEqual(geometry.bounds.map(v=>Math.floor((v*8+25)/50)));
   c.native.forEach((v,i)=>edges[i]+=Number(v===c.projected[i]));
  }
  for(let row=0;row<4;row++)expect(new Set(p.comparisons.slice(row*4,row*4+4).map(c=>`${c.native[1]}:${c.native[3]}`)).size).toBe(1);
 }
 expect(edges).toEqual([48,128,96,104]);expect(screen.nearestProjectionMatchingEdges).toEqual(edges);
 expect(screen.observations[2].comparisons[10].native[3]).toBe(184);
 expect(screen.observations[6].comparisons[10].native[3]).toBe(187);
});

for(const zoom of [100,200])it(`reproduces all eight older ${zoom}% geometry matches on the new screen pages`,()=>{
 const screen=JSON.parse(readFileSync(folder+(zoom===100?'screen-reference.json':'screen-reference-200.json')));
 const old=JSON.parse(readFileSync('tests/fixtures/'+ref.screenProjection.reference));
 const rows=ref.screenProjection.rows.filter(r=>r.zoom===zoom);
 expect(rows).toHaveLength(8);
 for(const r of rows){
  const previous=old.controls.find(c=>c.source===r.source).observations.find(o=>o.zoom===zoom).comparisons.find(c=>c.id===r.id);
  expect(screen.observations[r.axisPage-1].comparisons[r.axisId-1].native).toEqual(previous.native);
 }
});

it('binds all 128 clean 200% screen captures and their absolute projection failures',()=>{
 const screen=JSON.parse(readFileSync(folder+'screen-reference-200.json'));
 expect(screen.sourceSha256).toBe(ref.sourceSha256);expect(screen.casesSha256).toBe(ref.casesSha256);
 expect(screen.nativeReferenceSha256).toBe(sha(readFileSync(folder+'reference.json')));
 expect(screen.savedAtCapture).toBe(true);expect(screen.savedAfterCapture).toBe(true);
 expect(screen.paginationQueryPerformed).toBe(false);expect(screen.zoom).toBe(200);
 expect(screen.observations).toHaveLength(8);const scores=[0,0,0,0];
 for(const p of screen.observations){
  expect(sha(readFileSync(folder+p.crop))).toBe(p.cropSha256);expect(p.comparisons).toHaveLength(16);
  for(const c of p.comparisons){
   const geometry=ref.pages[p.page-1].tables[c.id-1];
   expect(c.projected).toEqual(geometry.bounds.map(v=>Math.floor((v*16+25)/50)));
   c.native.forEach((v,i)=>scores[i]+=Number(v===c.projected[i]));
  }
  for(let row=0;row<4;row++)expect(new Set(p.comparisons.slice(row*4,row*4+4).map(c=>`${c.native[1]}:${c.native[3]}`)).size).toBe(1);
 }
 expect(scores).toEqual([32,96,48,116]);expect(screen.nearestProjectionMatchingEdges).toEqual(scores);
});

it('distinguishes display leading-edge rounding from metafile origins and rejects table-local endpoint projection',()=>{
 const snap=v=>Math.floor(v+.5);
 for(const zoom of [100,200]){
  const screen=JSON.parse(readFileSync(folder+(zoom===100?'screen-reference.json':'screen-reference-200.json')));
  const leading=[0,0],relativeFloor=[0,0,0,0],relativeLower=[0,0,0,0];
  for(const p of screen.observations)for(const c of p.comparisons){
   const k=cases.find(k=>k.page===p.page&&k.id===c.id),geometry=ref.pages[p.page-1].tables[c.id-1];
   const floor=[k.xTwips,k.yTwips].map(v=>Math.floor(v*5/12));
   // Strictly preceding reference-grid point, expressed with exact integers.
   // A screen observation only: the native metafile uses floor at exact ties.
   const lower=[k.xTwips,k.yTwips].map(v=>Math.floor((v*5-1)/12));
   const scale=zoom/625,thin=Math.min(0,Math.floor(k.size*zoom/600)-1);
   leading[0]+=Number(snap(lower[0]*scale)+thin===c.native[0]);leading[1]+=Number(snap(lower[1]*scale)===c.native[1]);
   for(const [origin,scores] of [[floor,relativeFloor],[lower,relativeLower]]){
    const predicted=[snap(origin[0]*scale)+thin,snap(origin[1]*scale),
     snap(origin[0]*scale)+snap((geometry.bounds[2]-origin[0])*scale),
     snap(origin[1]*scale)+snap((geometry.bounds[3]-origin[1])*scale)];
    predicted.forEach((v,i)=>scores[i]+=Number(v===c.native[i]));
   }
  }
  expect(leading).toEqual([128,128]);
  expect(relativeFloor).toEqual(zoom===100?[128,128,128,120]:[96,96,48,92]);
  expect(relativeLower).toEqual(zoom===100?[128,128,128,104]:[128,128,64,116]);
 }
});

it('binds all 1536 native border rectangles to eight page metafiles and original source cases',()=>{
 expect(sha(readFileSync(folder+'control.docx'))).toBe(ref.sourceSha256);
 expect(sha(readFileSync(folder+'cases.json'))).toBe(ref.casesSha256);
 expect(ref.pages).toHaveLength(8);expect(cases).toHaveLength(128);
 const captureBytes=readFileSync(folder+'native-capture.json');
 expect(sha(captureBytes)).toBe(ref.captureSha256);
 const capture=JSON.parse(captureBytes.toString('utf8').replace(/^\uFEFF/,''));
 expect(capture.sourceUnchanged).toBe(true);expect(capture.readOnly).toBe(true);expect(capture.savedAfter).toBe(true);
 expect(capture.sourceSha256).toBe(ref.sourceSha256);
 for(const p of ref.pages){
  const zipped=readFileSync(folder+p.file),raw=gunzipSync(zipped);
  expect(sha(zipped)).toBe(p.sha256);expect(sha(raw)).toBe(p.rawSha256);
  expect(capture.captures[p.page-1].sha256).toBe(p.rawSha256);
  expect(raw.length).toBe(p.rawLength);const rects=[];
  for(let at=0;at<raw.length;){
   const type=raw.readUInt32LE(at),size=raw.readUInt32LE(at+4);
   expect(size).toBeGreaterThanOrEqual(8);expect(at+size).toBeLessThanOrEqual(raw.length);
   if(type===9)expect([raw.readInt32LE(at+8),raw.readInt32LE(at+12)]).toEqual([2400,1800]);
   if(type===76){
    expect(size).toBe(100);expect(raw.readUInt32LE(at+40)).toBe(0xF00021);
    expect([...raw.subarray(at+84,at+100)]).toEqual(Array(16).fill(0));
    rects.push([24,28,32,36].map(offset=>raw.readInt32LE(at+offset)));
   }
   at+=size;
  }
  expect(rects).toEqual(p.tables.flatMap(t=>t.rectangles));expect(rects).toHaveLength(192);
 }
});

it('varies x and y independently, with exact-height rows and no copied document content',()=>{
 const parts=unzipSync(readFileSync(folder+'control.docx'));
 const xml=new TextDecoder().decode(parts['word/document.xml']);
 expect((xml.match(/<w:tbl>/g)||[])).toHaveLength(128);
 expect((xml.match(/<w:sectPr>/g)||[])).toHaveLength(8);
 expect(xml).not.toContain('<w:t>');expect(Object.keys(parts).some(k=>k.startsWith('word/media/'))).toBe(false);
 for(let page=1;page<=8;page++){
  const rows=cases.filter(c=>c.page===page);
  expect(new Set(rows.map(c=>`${c.xPhaseTwips}:${c.yPhaseTwips}`)).size).toBe(16);
  expect([...new Set(rows.map(c=>c.heightTwips))]).toEqual([[473,479,481,487][(page-1)%4]]);
  expect([...new Set(rows.map(c=>c.size))]).toEqual([page<=4?2:18]);
  for(const c of rows)expect(xml).toContain(`w:tblpX="${c.xTwips}" w:tblpY="${c.yTwips}"`);
 }
});

it('matches complete-expression floor at all 128 bottoms, including 20 exact lattice boundaries',()=>{
 let exact=0;
 for(const p of ref.pages)for(const t of p.tables){
  const c=cases.find(c=>c.page===p.page&&c.id===t.id);
  const numerator=(2*c.yTwips+2*c.heightTwips+5*c.size)*5;
  exact+=numerator%24===0;
  expect(t.bounds[1]).toBe(Math.floor(c.yTwips*5/12));
  expect(t.bounds[3]).toBe(Math.floor(numerator/24));
 }
 expect(exact).toBe(20);
 expect(Object.fromEntries(Object.entries(ref.models).map(([name,m])=>[name,m.matching]))).toEqual({
  absoluteFloor:128,absoluteLowerBoundary:108,separateFloor:44,originFloorPlusExtentFloor:96,originAndHeightFloorPlusBorder:64,
 });
});

it('does not change vertical metafile extents when only x phase changes within a row',()=>{
 for(const p of ref.pages)for(let row=0;row<4;row++){
  const siblings=p.tables.slice(row*4,row*4+4);
  expect(new Set(siblings.map(t=>t.bounds[1])).size).toBe(1);
  expect(new Set(siblings.map(t=>t.bounds[3])).size).toBe(1);
 }
});

it('keeps native page geometry separate from the known screen projection failures',()=>{
 const p=ref.screenProjection;
 expect(sha(readFileSync('tests/fixtures/'+p.reference))).toBe(p.referenceSha256);
 expect(p.total).toBe(16);expect(p.matching).toBe(14);
 for(const r of p.rows){
  const native=ref.pages[r.axisPage-1].tables[r.axisId-1];
  expect(native.bounds[3]).toBe(r.nativeGridBottom);
  expect(r.projected).toBe(Math.floor((r.nativeGridBottom*4*r.zoom+1250)/2500));
 }
 expect(p.rows.filter(r=>r.projected!==r.screen)).toEqual([
  {source:'heights-thin.docx',id:11,zoom:100,axisPage:3,axisId:11,nativeGridBottom:1155,projected:185,screen:184},
  {source:'heights-wide.docx',id:11,zoom:100,axisPage:7,axisId:11,nativeGridBottom:1172,projected:188,screen:187},
 ]);
});
