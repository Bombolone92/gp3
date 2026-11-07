import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tableBorderWidth,tableBorderLayoutWidth} from '../src/engine/table-border-layout.js';
it('binds all small/medium native rows to the independently authored source and reference export',()=>{
 const path='tests/fixtures/compound-row-rounding-medium-small/',reference=JSON.parse(readFileSync(path+'reference.json','utf8'));
 const hash=name=>createHash('sha256').update(readFileSync(path+name)).digest('hex');
 expect(hash('control.docx')).toBe(reference.sourceSha256);expect(hash('native.pdf')).toBe(reference.pdfSha256);
 expect(reference.positions).toHaveLength(216);expect(new Set(reference.positions.map(p=>p.page)).size).toBe(24);
});
it.each(['thinThickSmallGap','thickThinSmallGap'])('reserves twip widths separately from ink for %s',style=>{
 for(const [size,allocated,ink] of [[0,1.5,1.56],[2,1.75,1.68],[11,2.85,2.76],[24,4.5,4.44],[36,6,5.88],[96,13.5,13.44]]){
  expect(tableBorderLayoutWidth({style,size})*.75).toBeCloseTo(allocated);expect(tableBorderWidth({style,size})*.75).toBeCloseTo(ink);
 }
});
it.each(['thinThickMediumGap','thickThinMediumGap'])('truncates the authored width before doubling for %s',style=>{
 for(const [size,allocated,ink] of [[0,0,.36],[2,.5,.48],[11,2.7,2.52],[24,6,5.88],[36,9,8.76],[96,24,24]]){
  expect(tableBorderLayoutWidth({style,size})*.75).toBeCloseTo(allocated);expect(tableBorderWidth({style,size})*.75).toBeCloseTo(ink);
 }
});
