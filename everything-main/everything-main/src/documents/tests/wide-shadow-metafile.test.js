import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/scaled-picture-shadows/',ref=JSON.parse(readFileSync(root+'metafile/reference.json'));
test('wide shadow evidence is bound to the original source and native captures',()=>{
 for(const [file,hash] of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
});
test('expanded capture changes only the viewport bottom and contains all native drawing bounds',()=>{
 const a=readFileSync(root+'metafile/capture.emf'),b=readFileSync(root+'metafile/expanded.emf');
 expect(a.subarray(0,36)).toEqual(b.subarray(0,36));expect(a.subarray(40)).toEqual(b.subarray(40));expect(b.readInt32LE(36)).toBeGreaterThan(a.readInt32LE(36));
 expect(ref.nativeBounds[2]).toBeLessThan(ref.expandedSize[0]);expect(ref.nativeBounds[3]).toBeLessThan(ref.expandedSize[1]);
 expect(ref.images.map(i=>i.size)).toEqual([[140,140],[144,144]]);expect(ref.radiusPixels).toBe(17);expect(ref.points).toHaveLength(1223);
});
