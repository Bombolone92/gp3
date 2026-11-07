import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync,strFromU8} from 'fflate';
const folder='tests/fixtures/border-dense-phase/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
it('binds a complete one-twip phase matrix to the observed native source and geometry',()=>{
 for(const [file,key] of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['capture.json','captureMetadataSha256'],['native-100.png','cropSha256'],['native.emf.gz','emfSha256']])expect(sha(readFileSync(folder+file))).toBe(ref[key]);
 const cases=JSON.parse(readFileSync(folder+'cases.json'));
 expect(cases).toHaveLength(60);
 expect([...new Set(cases.map(c=>c.yPhaseTwips))]).toEqual(Array.from({length:15},(_,i)=>i));
 for(let row=0;row<15;row++)expect(cases.slice(row*4,row*4+4).map(c=>c.xPhaseTwips)).toEqual([0,4,8,12]);
 const xml=strFromU8(unzipSync(readFileSync(folder+'control.docx'))['word/document.xml']);
 expect((xml.match(/<w:tbl>/g)||[])).toHaveLength(60);
 expect(xml).not.toContain('<w:t>');expect(xml).not.toContain('<w:drawing>');
 const raw=gunzipSync(readFileSync(folder+'native.emf.gz'));
 expect(sha(raw)).toBe(ref.emfRawSha256);const rectangles=[];
 for(let at=0;at<raw.length;){const kind=raw.readUInt32LE(at),size=raw.readUInt32LE(at+4);
  expect(size).toBeGreaterThanOrEqual(8);expect(at+size).toBeLessThanOrEqual(raw.length);
  expect([35,36,77,78,79,80,81]).not.toContain(kind);
  if(kind===76){expect(size).toBe(100);expect(raw.readUInt32LE(at+40)).toBe(0xF00021);expect([...raw.subarray(at+84,at+100)]).toEqual(Array(16).fill(0));rectangles.push([24,28,32,36].map(i=>raw.readInt32LE(at+i)));}at+=size;
 }expect(rectangles).toEqual(ref.rectangles);expect(rectangles).toHaveLength(720);
});
it('binds the split 200% capture to the same source, saved state and complete phase matrix',()=>{
 const zoom=JSON.parse(readFileSync(folder+'reference-200.json'));
 expect(zoom.sourceSha256).toBe(ref.sourceSha256);expect(zoom.casesSha256).toBe(ref.casesSha256);
 expect(sha(readFileSync(folder+'capture-200.json'))).toBe(zoom.captureMetadataSha256);
 const metadata=JSON.parse(readFileSync(folder+'capture-200.json','utf8').replace(/^\uFEFF/,''));
 expect(metadata).toEqual({savedAfter:true,characters:'',zoom:200,pageWidthPt:288,pageHeightPt:216,referenceBuild:'16.0.20326'});
 expect(zoom.observations.map(o=>o.id)).toEqual(Array.from({length:60},(_,i)=>i+1));
 for(const crop of zoom.crops)expect(sha(readFileSync(folder+crop.crop))).toBe(crop.cropSha256);
 expect(zoom.overlap).toEqual({offset:[1,277],size:[766,22],differingPixels:0});
});
it('retains exact native row heights while exposing the floating-position getter offset',()=>{
 const r=JSON.parse(readFileSync(folder+'native-table-metadata-reference.json'));
 expect(r.sourceSha256).toBe(ref.sourceSha256);expect(r.casesSha256).toBe(ref.casesSha256);
 const raw=readFileSync(folder+'native-table-metadata.json');expect(sha(raw)).toBe(r.metadataSha256);
 const metadata=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),cases=JSON.parse(readFileSync(folder+'cases.json'));
 expect(metadata).toMatchObject({referenceBuild:'16.0.20326',savedBefore:true,savedAfter:true,characters:''});
 expect(metadata.tables).toHaveLength(60);
 for(const [i,t] of metadata.tables.entries()){
  const c=cases[i];expect(t.id).toBe(c.id);expect(t.heightRule).toBe(2);expect(t.wrapAround).toBe(-1);
  expect(t.heightPt*20).toBe(c.heightTwips);
  expect(t.xPt*20-c.xTwips).toBeCloseTo(-1,5);expect(t.yPt*20-c.yTwips).toBeCloseTo(-1,5);
  expect(r.observations[i]).toEqual({id:c.id,xDeltaTwips:-1,yDeltaTwips:-1,heightPt:6});
 }
});
it('binds all 175% phase observations and the independently verified overlapping viewports',()=>{
 const zoom=JSON.parse(readFileSync(folder+'reference-175.json'));
 expect(zoom.sourceSha256).toBe(ref.sourceSha256);expect(zoom.casesSha256).toBe(ref.casesSha256);
 expect(sha(readFileSync(folder+'capture-175.json'))).toBe(zoom.captureMetadataSha256);
 const metadata=JSON.parse(readFileSync(folder+'capture-175.json','utf8').replace(/^\uFEFF/,''));
 expect(metadata).toEqual({savedAfter:true,characters:'',zoom:175,pageWidthPt:288,pageHeightPt:216,referenceBuild:'16.0.20326'});
 expect(zoom.observations.map(o=>o.id)).toEqual(Array.from({length:60},(_,i)=>i+1));
 for(const crop of zoom.crops)expect(sha(readFileSync(folder+crop.crop))).toBe(crop.cropSha256);
 expect(zoom.pageSize).toEqual([672,504]);expect(zoom.overlap).toEqual({offset:[1,172],size:[670,131],differingPixels:0});
});
it('keeps the one-twip leading-origin hypothesis consistent across all 180 native top edges',()=>{
 const cases=JSON.parse(readFileSync(folder+'cases.json'));let count=0;
 for(const zoom of [100,175,200]){
  const r=zoom===100?ref:JSON.parse(readFileSync(folder+`reference-${zoom}.json`));
  for(const [i,c] of cases.entries()){
   expect(Math.round((c.yTwips-1)*zoom/1500)).toBe(r.observations[i].horizontal[0][0]);count++;
  }
 }
 expect(count).toBe(180);
});
