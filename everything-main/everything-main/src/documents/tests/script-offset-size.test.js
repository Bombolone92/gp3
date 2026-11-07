import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {reducedScriptSize} from '../src/engine/script-font-size.js';

const folders=['script-vdmx-ppem','script-device-caps','script-size-offset','script-sub-offset','script-sub-offset-threshold'];
for(const folder of folders){
 const root=`tests/fixtures/${folder}/`,reference=JSON.parse(readFileSync(root+'reference.json'));
 it(`retains native evidence hashes: ${folder}`,()=>{
  for(const [name,sha]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(sha);
 });
 for(const c of reference.cases){
  const data=readFileSync(root+c.family.replaceAll(' ','')+'.ttf');
  const metadata=readFontMetadata(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
  for(const row of c.rows)it(`matches native size: ${c.family} ${row.size}pt ${row.script}`,()=>{
   expect(metadata).not.toBeNull();
   expect(Math.abs(reducedScriptSize(row.size,row.script,metadata)+row.scriptHeight*.12)).toBeLessThan(.061);
  });
 }
}
