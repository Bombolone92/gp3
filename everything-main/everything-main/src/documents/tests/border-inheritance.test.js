import{it,expect}from'vitest';
import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{gunzipSync}from'node:zlib';
import{unzipSync,strFromU8}from'fflate';
const folder='tests/fixtures/border-inheritance/',ref=JSON.parse(readFileSync(folder+'reference.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
it('binds independent table/cell declarations and identical native PATCOPY geometry',()=>{
 expect(sha(readFileSync(folder+'cases.json'))).toBe(ref.casesSha256);
 expect(sha(readFileSync(folder+'cell-capture.json'))).toBe(ref.cellCaptureSha256);
 const metadata=JSON.parse(readFileSync(folder+'cell-capture.json','utf8').replace(/^\uFEFF/,''));
 expect(metadata).toMatchObject({savedBefore:true,savedAfter:true,characters:'',zoom:100,pageWidthPt:288,pageHeightPt:216});
 const docs=ref.sources.map(s=>unzipSync(readFileSync(folder+s.owner+'.docx')));
 for(const name of Object.keys(docs[0]))if(name!=='word/document.xml')expect(docs[0][name]).toEqual(docs[1][name]);
 const table=strFromU8(docs[0]['word/document.xml']),cell=strFromU8(docs[1]['word/document.xml']);
 expect((table.match(/<w:tblBorders>/g)||[]).length).toBe(8);expect(table).not.toContain('<w:tcBorders>');
 expect((cell.match(/<w:tcBorders>/g)||[]).length).toBe(18);expect(cell).not.toContain('<w:tblBorders>');
 expect(table.replace(/<w:tblBorders>.*?<\/w:tblBorders>/g,'')).toBe(cell.replace(/<w:tcBorders>.*?<\/w:tcBorders>/g,''));
 for(const s of ref.sources){
  expect(sha(readFileSync(folder+s.owner+'.docx'))).toBe(s.sourceSha256);
  const zipped=readFileSync(folder+'native-'+s.owner+'.emf.gz');expect(sha(zipped)).toBe(s.emfSha256);
  const raw=gunzipSync(zipped);expect(sha(raw)).toBe(s.emfRawSha256);const rects=[];
  for(let at=0;at<raw.length;){const kind=raw.readUInt32LE(at),size=raw.readUInt32LE(at+4);expect(size).toBeGreaterThanOrEqual(8);expect(at+size).toBeLessThanOrEqual(raw.length);
   if(kind===76){expect(size).toBe(100);expect(raw.readUInt32LE(at+40)).toBe(0xF00021);expect([...raw.subarray(at+84,at+100)]).toEqual(Array(16).fill(0));rects.push([24,28,32,36].map(i=>raw.readInt32LE(at+i)));}at+=size;
  }expect(rects).toEqual(s.rectangles);expect(rects).toHaveLength(142);
 }
 expect(ref.sources[0].rectangles).toEqual(ref.sources[1].rectangles);
});
