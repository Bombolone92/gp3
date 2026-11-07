import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tableBorderWidth,tableBorderLayoutWidth} from '../src/engine/table-border-layout.js';
it('binds independently captured row positions to the fixture and native reference PDF',()=>{
 const path='tests/fixtures/compound-row-rounding/',reference=JSON.parse(readFileSync(path+'reference.json','utf8'));
 const hash=name=>createHash('sha256').update(readFileSync(path+name)).digest('hex');
 expect(hash('control.docx')).toBe(reference.sourceSha256);expect(hash('native.pdf')).toBe(reference.pdfSha256);
 expect(reference.positions).toHaveLength(135);expect(new Set(reference.positions.map(p=>p.page)).size).toBe(15);
});
it.each([[0,2.25,2.28],[2,2.5,2.4],[8,3.25,3.12],[11,3.6,3.48],[12,3.75,3.6],[13,3.85,3.72],[17,4.35,4.2],[24,5.25,5.16],[48,8.25,8.16],[96,14.25,14.16]])('separates native allocated and painted extents for size %s',(size,allocated,ink)=>{
 const b={style:'thinThickLargeGap',size};expect(tableBorderLayoutWidth(b)*.75).toBeCloseTo(allocated);expect(tableBorderWidth(b)*.75).toBeCloseTo(ink);
});
