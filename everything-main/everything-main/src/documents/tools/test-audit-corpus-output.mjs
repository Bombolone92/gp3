import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';

test('audit refuses source and evidence destinations before opening a browser',()=>{
 const directory=mkdtempSync(join(tmpdir(),'documents-audit-output-'));
 try{
  const source=join(directory,'source.docx'),original=readFileSync('tests/fixtures/print-coordinate-phase/control.docx');
  writeFileSync(source,original);
  const retained=join(directory,'native.json'),evidence=Buffer.from('retained independent evidence');writeFileSync(retained,evidence);
  const freshDocx=join(directory,'another.docx');
  for(const output of [source,retained,freshDocx]){
   const run=spawnSync(process.execPath,[resolve('tools/audit-corpus-imports.mjs'),source,output,'fonts'],{encoding:'utf8',timeout:10000});
   assert.equal(run.error,undefined);
   assert.notEqual(run.status,0);
   assert.match(run.stderr,/Use a fresh JSON report path/);
   assert.deepEqual(readFileSync(source),original);
   assert.deepEqual(readFileSync(retained),evidence);
   assert.equal(existsSync(freshDocx),false);
  }
 }finally{
  const target=resolve(directory);
  assert.equal(dirname(target),resolve(tmpdir()));
  assert.match(basename(target),/^documents-audit-output-/);
  rmSync(target,{recursive:true,force:true});
 }
});
