import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/column-bookmarks/';
const ref=JSON.parse(readFileSync(folder+'native-ranges.json','utf8').replace(/^\uFEFF/,''));
const hash=name=>createHash('sha256').update(readFileSync(folder+name)).digest('hex');
it('binds native column selections to the independent source and native reference PDF',()=>{
 expect(hash('control.docx')).toBe(ref.sourceSha256);
 expect(hash('native.pdf')).toBe(ref.pdfSha256);
 expect(ref.pages).toBe(1);expect(ref.bookmarks).toHaveLength(6);
 for(const b of ref.bookmarks){expect(b.column).toBe(!b.name.startsWith('Collapsed'));expect(b.selectionType).toBe(b.column?4:1);expect(b.selectedCells).toHaveLength(b.selectedCellCount);if(!b.column)expect(b.start).toBe(b.end);}
});
it('distinguishes column selections from their enclosing linear bookmark ranges',()=>{
 const find=name=>ref.bookmarks.find(b=>b.name===name);
 const middle=find('MiddleColumn');expect(middle.rangeCellCount).toBe(7);expect(middle.selectedCellCount).toBe(3);
 expect(middle.selectedCells.map(c=>c.text.trim())).toEqual(['T1R1C2\r\x07','T1R2C2\r\x07','T1R3C2\r\x07']);
 expect(find('TwoColumns').rangeCellCount).toBe(8);expect(find('TwoColumns').selectedCellCount).toBe(6);
 expect(find('OneCell').selectedCellCount).toBe(1);
 expect(find('MergedTop').selectedCells.map(c=>c.text.trim())).toEqual(['T4R1C3\r\x07','T4R2C3\r\x07','T4R3C3\r\x07']);
});
