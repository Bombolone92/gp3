import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {permitsSyntheticStroke} from '../src/engine/synthetic-bold.js';

it('matches independently exported native reference stroke decisions across exact weight boundaries',()=>{
 const folder='tests/fixtures/synthetic-bold-weight-metadata/';
 const ref=JSON.parse(readFileSync(folder+'reference.json'));
 const source=readFileSync(folder+'control.docx');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(source)).toBe(ref.sourceSha256);
 expect(hash(readFileSync(folder+'native.pdf'))).toBe(ref.pdfSha256);
 expect(ref.cases).toHaveLength(42);
 expect(Object.keys(ref.fontHashes)).toHaveLength(21);
 const xml=strFromU8(unzipSync(source)['word/document.xml']);
 for(const c of ref.cases){
  expect(xml).toContain(c.text);
  expect(c.pdfFont).toContain(`WeightProbe${c.weight}-Regular`);
  expect(c.bold&&permitsSyntheticStroke({weight:c.weight,bold:false,variable:false}),c.text).toBe(c.textRenderingMode===2);
 }
});
