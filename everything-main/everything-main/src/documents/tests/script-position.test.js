import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {scriptPosition} from '../src/engine/font-script-metrics.js';
import {reducedScriptSize} from '../src/engine/script-font-size.js';

const matrix=JSON.parse(readFileSync('tests/fixtures/script-position-native/cases.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
it('binds all native sources and ordinary-script observations',()=>{
 expect(matrix.cases).toHaveLength(558);
 for(const [file,sha]of Object.entries(matrix.hashes)){
  const bytes=readFileSync(file),bound=file.endsWith('.json')?Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')):bytes;
  expect(hash(bound),file).toBe(sha);
 }
});
const metadata=matrix.fonts.map(f=>{
 const file=f.system?`C:/Windows/Fonts/${f.file}`:f.file;
 // Numeric reference facts keep the matrix usable off the Windows machine.
 // On the reference host, verify the actual selected font and parser as well.
 if(!existsSync(file)){if(!f.system)throw new Error(`Missing original control font: ${file}`);return f.metadata;}
 const data=readFileSync(file);expect(hash(data)).toBe(f.sha256);
 const actual=readFontMetadata(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
 expect(actual).toMatchObject(f.metadata);return actual;
});
for(const c of matrix.cases)it(`matches native vertical origin: ${c.label} ${c.size}pt ${c.script}`,()=>{
 const font=metadata[c.font],reduced=reducedScriptSize(c.size,c.script,font);
 expect(Math.abs(reduced-c.nativeSize)).toBeLessThan(.061);
 expect(Math.abs(scriptPosition(c.size,reduced,c.script,font)+c.nativeRise)).toBeLessThan(.061);
});
it('retains fallback when position metrics or variation values are unknown',()=>{
 const base=metadata[0];
 expect(scriptPosition(12,7,'superscript',null)).toBeNull();
 expect(scriptPosition(12,7,'superscript',{...base,scriptPositionMetrics:null})).toBeNull();
 expect(scriptPosition(12,7,'superscript',{...base,variable:true,scriptPositionInvariant:false})).toBeNull();
 expect(scriptPosition(NaN,7,'superscript',base)).toBeNull();
 expect(scriptPosition(12,12,'superscript',base)).toBeNull();
 expect(scriptPosition(12,7,'baseline',base)).toBeNull();
});
