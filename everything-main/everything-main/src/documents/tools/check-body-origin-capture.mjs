// Reproducible browser diagnostic controls; uses the existing local server.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const baseURL=process.argv[2]||'http://127.0.0.1:5173';
const directory=mkdtempSync(join(tmpdir(),'documents-origin-capture-')),outputs=[];
const capture=(source,name)=>{
 const output=join(directory,name+'.json');outputs.push(output);
 execFileSync(process.execPath,['tools/capture-body-char-origins.mjs',source,output,baseURL],{stdio:'inherit',timeout:180000});
 return JSON.parse(readFileSync(output,'utf8'));
};
try{
 const source='tests/fixtures/caps-kerning-carets/';
 const actual=capture(source+'control.docx','caps'),native=JSON.parse(readFileSync(source+'native-carets.json','utf8'));
 assert.equal(actual.sourceSha256,native.sourceSha256);assert.equal(actual.lines.length,4);
 assert.equal(actual.expandingCapitalizationExcluded,0);assert.equal(actual.nonSourceSpanExcluded,0);
 let maxX=0;
 for(const [i,line]of actual.lines.entries()){
  const expected=[...native.rows[i].text].flatMap((text,index)=>/\s/u.test(text)?[]:[{text,...native.rows[i].carets[index]}]);
  assert.deepEqual(line.chars.map(c=>c.text),expected.map(c=>c.text));
  for(const[j,char]of line.chars.entries())maxX=Math.max(maxX,Math.abs(char.x-expected[j].xPt));
 }
 assert(maxX<.4);console.log('PASS four native all-caps/ordinary/disabled/mixed-source lines; max X pt '+maxX);
 const expansion=capture('public/fixtures/capitalization.docx','expansion');
 assert.equal(expansion.expandingCapitalizationExcluded,2);
 for(const text of ['Script áß😀','Hello, world! 123 áß😀']){
  const line=expansion.lines.find(l=>l.text===text);assert(line);
  assert(!line.chars.some(c=>c.text==='ß'||c.text==='SS'));
 }
 const ordinary=expansion.lines.find(l=>l.text==='Capitalization áß😀');
 assert(ordinary.chars.some(c=>c.text==='ß'));
 console.log('PASS uppercase expansions disclosed; ordinary source case preserved');
}finally{
 for(const output of outputs)try{unlinkSync(output);}catch(error){if(error.code!=='ENOENT')throw error;}
 rmdirSync(directory);
}
