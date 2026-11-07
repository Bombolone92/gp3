function fullSummaryBoard(){const b=board('Full summary budget'),f=item('frame',0,0,{text:'F'.repeat(20000)});b.items=[f,...Array.from({length:4999},(_,n)=>item('note',n%100,Math.floor(n/100),{text:'Note '+n,parentId:f.id}))];validateBoard(structuredClone(b));return b;}
test('AI summary retains bounded text memory for a full valid board',()=>{
 const source=new URL('../src/ai/ai-ui.js',import.meta.url);const script=`
import assert from 'node:assert/strict';
import {board,item,validateBoard} from ${JSON.stringify(new URL('../src/model.js',import.meta.url).href)};
import {boardText} from ${JSON.stringify(source.href)};
${fullSummaryBoard.toString()}
const b=fullSummaryBoard(),original=JSON.stringify(b);
globalThis.gc();
const before=process.memoryUsage().heapUsed;
globalThis.retainedSummary=boardText(b.items);
globalThis.gc();
const retained=process.memoryUsage().heapUsed-before;
const expected=Array.from({length:3},(_,n)=>'- (note, '+b.items[0].text+') Note '+n).join('\\n').slice(0,50000);
assert.equal(globalThis.retainedSummary,expected);
assert.equal(JSON.stringify(b),original);
console.log(JSON.stringify({items:b.items.length,length:globalThis.retainedSummary.length,retained}));
`;
 const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.items,5000);assert.equal(result.length,50000);assert.ok(result.retained<10*1024*1024,`Summary retained ${result.retained} bytes for 50,000 characters`);
});
test('AI summary keeps a late selected note and its frame on a full board',()=>{const b=fullSummaryBoard(),last=b.items.at(-1),original=JSON.stringify(b);const result=boardText(b.items,new Set([last.id]));assert.equal(result,'- (note, '+b.items[0].text+') '+last.text);assert.equal(JSON.stringify(b),original);});
test('AI summary omits blank and excluded content without consuming separators',()=>{const b=board('Visible summary');b.items=[item('note',0,0,{text:'  \n '}),item('note',1,0,{text:'Hidden source'}),item('note',2,0,{text:'First 😀'}),item('note',3,0,{text:'Second 😀'})];validateBoard(structuredClone(b));const original=structuredClone(b);assert.equal(boardText(b.items,new Set([b.items[0].id,b.items[2].id,b.items[3].id])),'- (note) First 😀\n- (note) Second 😀');assert.deepEqual(b,original);});
test('AI summary budget preserves a complete Unicode frame label at the combined boundary',()=>{const b=board('Frame label budget'),f=item('frame',0,0,{text:'F'.repeat(20000)}),g=item('frame',1,0,{text:'R'.repeat(5966)+'😀',lang:'fr-CA',textRuns:[{start:5966,end:5968,style:{lang:'en-GB'}}]});b.items=[f,g,item('note',0,0,{text:'Q'.repeat(2000),parentId:f.id}),item('note',1,0,{text:'Q'.repeat(2000),parentId:f.id}),item('note',2,0,{text:'x',parentId:g.id})];validateBoard(structuredClone(b));const original=structuredClone(b);const expected=Array.from({length:2},()=>'- (note, '+f.text+') '+'Q'.repeat(2000)).join('\n')+'\n- (note, '+'R'.repeat(5966),result=boardText(b.items);assert.equal(expected.length,49999);assert.equal(result,expected);assert.equal(result.isWellFormed(),true);assert.deepEqual(b,original);});
