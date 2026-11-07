import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder='tests/fixtures/print-tie-phase/';
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const raw=JSON.parse(readFileSync(folder+'native-metafile-rectangles.json'));
const pdf=JSON.parse(readFileSync(folder+'native-print-frames.json'));
const blue=page=>page.fills.filter(f=>f.colorRef===0x917f6d);
const far=page=>Math.max(...blue(page).map(f=>f.destination[1]+f.destination[3]));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

it('binds the eight independent half-grid controls to exact native captures',()=>{
 expect(hash(folder+'control.docx')).toBe(pdf.sourceSha256);
 expect(hash(folder+'cases.json')).toBe(pdf.casesSha256);
 expect(hash(folder+'native.pdf')).toBe(pdf.pdfSha256);
 expect(raw.sourceSha256).toBe(pdf.sourceSha256);expect(raw.casesSha256).toBe(pdf.casesSha256);
 expect(raw.sourceUnchanged&&pdf.sourceUnchanged).toBe(true);
 expect(cases).toHaveLength(8);expect(raw.pages).toHaveLength(8);expect(pdf.pageCount).toBe(8);
 for(const [index,item]of cases.entries()){
  expect(item.page).toBe(index);expect(item.pageWidthPt).toBe(612);expect(item.pageHeightPt).toBe(792);
  expect(item.sizeEighthPoints).toBe(8);expect([403,415]).toContain(item.heightTwips);
  expect([4455,7755]).toContain(item.topTwips);expect([4320,8640]).toContain(item.widthTwips);
  expect(raw.pages[index].windowExtent).toEqual([5100,6600]);
  expect(raw.pages[index].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(blue(raw.pages[index])).toHaveLength(12);expect(blue(raw.pages[index]).every(f=>!f.clips.length)).toBe(true);
 }
});

it('retains width-independent native Y coordinates with alternating tie directions',()=>{
 expect(raw.pages.map(far)).toEqual([2032,2032,2038,2038,3407,3407,3413,3413]);
 for(let index=0;index<8;index+=2){
  const coordinates=page=>blue(page).map(f=>[f.destination[1],f.destination[3]]);
  expect(coordinates(raw.pages[index+1])).toEqual(coordinates(raw.pages[index]));
  for(const edge of [1,3])expect(pdf.frames[index+1].boundsPt[edge]).toBeCloseTo(pdf.frames[index].boundsPt[edge],8);
 }
 const ideals=cases.map(c=>(c.topTwips+c.heightTwips+20)*5/12);
 expect(ideals).toEqual([2032.5,2032.5,2037.5,2037.5,3407.5,3407.5,3412.5,3412.5]);
 const even=v=>{const low=Math.floor(v);return low+(low%2);};
 expect(ideals.map(even)).not.toEqual(raw.pages.map(far));
 expect(ideals.map(Math.floor)).not.toEqual(raw.pages.map(far));
 expect(ideals.map(Math.round)).not.toEqual(raw.pages.map(far));
});

it('rejects a universal point-float rounding shortcut with a separate low-origin control',()=>{
 for(const [index,item]of cases.entries()){
  const point=(item.topTwips+item.heightTwips+20)/20;
  expect(Math.round(Math.fround(point)/.12)).toBe(far(raw.pages[index]));
 }
 const base='tests/fixtures/print-row-phase/';
 const rows=JSON.parse(readFileSync(base+'cases.json'));
 const reference=JSON.parse(readFileSync(base+'native-metafile-rectangles.json'));
 expect(hash(base+'control.docx')).toBe(reference.sourceSha256);
 expect(hash(base+'cases.json')).toBe(reference.casesSha256);
 expect(rows[10].heightTwips).toBe(406);
 expect(far(reference.pages[10])).toBe(478);
 expect(Math.round(Math.fround((720+rows[10].heightTwips+20)/20)/.12)).toBe(477);
});
