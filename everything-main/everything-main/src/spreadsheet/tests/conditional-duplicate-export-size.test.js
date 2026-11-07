import {expect,it} from 'vitest';
import {exportNativeDuplicateFormula} from '../src/core/conditional-duplicates.js';
import {toFileFormula} from '../src/core/xlfn.js';
import {parseFormula} from '../src/core/formula/parser.js';

it('bounds every serialized helper and aggregate for a large multi-area scope',()=>{
 const source=Array.from({length:1800},(_,i)=>`$A$${i+1}`),helpers=[];
 const formula=exportNativeDuplicateFormula({type:'unique',range:{r1:2,c1:2,r2:8,c2:2},duplicateRange:`(${source.join(',')})`},"Data's",ref=>{
  const name=`_Helper${helpers.length}`;helpers.push({name,ref});return name;
 });
 expect(helpers.length).toBeGreaterThan(255);
 let refs=0;
 const walk=node=>{
  if(node.type==='ref'){if(node.ref.sheet){expect(node.ref.sheet).toBe("Data's");expect(node.ref.absR1&&node.ref.absC1).toBe(true);refs++;}}
  if(node.type==='call')expect(node.args.length).toBeLessThanOrEqual(255);
  for(const [key,value]of Object.entries(node)){
   if(key==='ref')continue;
   if(Array.isArray(value))value.forEach(n=>n&&typeof n==='object'&&walk(n));
   else if(value&&typeof value==='object')walk(value);
  }
 };
 for(const text of [formula,...helpers.map(n=>n.ref)]){
  expect(toFileFormula(text).length).toBeLessThan(8192);walk(parseFormula(text));
 }
 expect(refs).toBe(source.length);
 expect(formula).toContain('=1');
});
