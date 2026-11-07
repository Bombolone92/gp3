import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const name of ['svg-mask-nested','svg-mask-nested-intermediate'])it(`${name} retains independent native provenance`,()=>{
 const folder=`tests/fixtures/${name}/`,source=readFileSync(`public/fixtures/${name}.docx`);
 const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
 expect(hash(source)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+'native.emf'))).toBe(ref.nativeSha256);
 expect(ref.images).toHaveLength(6);
 for(const image of ref.images)expect(hash(readFileSync(folder+image.path))).toBe(image.sha256);
 const xml=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
 expect(xml).toContain('fill-opacity="0"');expect(xml).toContain('opacity="0"');
 if(name.endsWith('intermediate')){
  // The native reference omits zero-opacity paints: the native layer ends with the first
  // rectangle, and the overlapping transparent rectangle does not recolor it.
  for(const i of [4,5]){
   expect(ref.images[i].size).toEqual([15,38]);
   expect(ref.images[i].middleColumn[10]).toEqual([57,82,236,254]);
   expect(ref.images[i].middleColumn[30]).toEqual(ref.images[i].middleColumn[10]);
  }
 }
});
