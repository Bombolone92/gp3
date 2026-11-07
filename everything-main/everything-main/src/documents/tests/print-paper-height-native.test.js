import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder='tests/fixtures/print-paper-height-phase/';
const reference=JSON.parse(readFileSync(folder+'native-print-frames.json'));
const metafile=JSON.parse(readFileSync(folder+'native-metafile-rectangles.json'));
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const hash=path=>createHash('sha256').update(readFileSync(folder+path)).digest('hex');

it('binds the native references to the exact independent source and case metadata',()=>{
 expect(hash('control.docx')).toBe(reference.sourceSha256);
 expect(hash('cases.json')).toBe(reference.casesSha256);
 expect(hash('native.pdf')).toBe(reference.pdfSha256);
 expect(metafile.sourceSha256).toBe(reference.sourceSha256);
 expect(metafile.casesSha256).toBe(reference.casesSha256);
 expect(reference.sourceUnchanged&&metafile.sourceUnchanged).toBe(true);
 expect(reference.nativeSourcePdfSha256).toMatch(/^[0-9a-f]{64}$/);
 expect(reference.pageCount).toBe(36);expect(cases).toHaveLength(36);
 expect(metafile.pages).toHaveLength(36);
});

it('isolates paper height while retaining each pen, exact row and absolute origin',()=>{
 expect([...new Set(cases.map(c=>c.pageHeightPt))]).toEqual([396,480,612,720,792,1008]);
 for(const [index,item]of cases.entries()){
  expect(item.page).toBe(index);expect(item.pageWidthPt).toBe(612);
  expect(item.topTwips).toBe(4455);expect(item.widthTwips).toBe(4320);
  expect(item.leftTwips).toBe(720);
  expect([8,9,15]).toContain(item.sizeEighthPoints);
  expect([400,403]).toContain(item.heightTwips);
  expect(metafile.pages[index].windowExtent).toEqual([5100,item.pageHeightPt/.12]);
  expect(metafile.pages[index].sha256).toMatch(/^[0-9a-f]{64}$/);
 }
});

it('retains identical native physical destinations across paper heights despite PDF translation',()=>{
 for(let phase=0;phase<6;phase++){
  const baseline=metafile.pages[phase].fills.filter(f=>f.colorRef===0x917f6d);
  expect(baseline).toHaveLength(12);
  for(let paper=0;paper<6;paper++){
   const index=paper*6+phase;
   expect(metafile.pages[index].fills.filter(f=>f.colorRef===0x917f6d)).toEqual(baseline);
   const bounds=reference.frames[index].boundsPt;
   const first=reference.frames[phase].boundsPt;
   expect(Math.abs((bounds[3]-bounds[1])-(first[3]-first[1]))).toBeLessThan(.00003);
   expect(Math.abs(bounds[0]-first[0])).toBeLessThan(.00003);
   expect(Math.abs(bounds[2]-first[2])).toBeLessThan(.00003);
  }
  expect(reference.frames[phase].boundsPt[1]-reference.frames[24+phase].boundsPt[1]).toBeCloseTo(.05,5);
 }
});
