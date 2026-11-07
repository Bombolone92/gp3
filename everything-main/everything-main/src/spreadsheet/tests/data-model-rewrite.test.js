import { modelArchive } from './helpers/data-model-fixture.js';
import { it, expect } from 'vitest';
import { rewriteModelValueColumns, rewriteModelDictionaryColumns, rewriteModelTableRows, rewriteModelTables } from '../src/core/data-model-rewrite.js';
import { readDataModelArchive, replaceDataModelArchiveFiles } from '../src/core/data-model-archive.js';
import { encodeModelColumnIds, encodeModelMappingIds, readModelColumnStorage } from '../src/core/data-model-columns.js';
import { encodeModelHierarchyHash, readModelHierarchyHash } from '../src/core/data-model-hash-index.js';
import { readModelColumnValues } from '../src/core/data-model-values.js';
import { readModelDictionary, encodeModelStringDictionary, encodeModelNumericDictionary } from '../src/core/data-model-dictionaries.js';
import { readModelIntrinsicHierarchy } from '../src/core/data-model-hierarchies.js';
import { fixture } from './helpers/rewrite-model-storage.js';
const text = s => new TextEncoder().encode(s);
const utf16 = s => new Uint8Array(Buffer.from(s, 'utf16le'));
function open(bytes,path) { const archive=readDataModelArchive(bytes);return {archive,table:archive.files.find(f=>f.path===path)}; }
it('atomically rewrites multiple value columns, grows widths and rebuilds distinct member indexes', () => {
  const {input,path}=fixture({unicode:true}), copy=input.slice();
  const updates=new Map([['Amount',[50000n,null,6n,5n,7n]],['Other',[7n,null,7n,7n,7n]]]);
  const output=rewriteModelValueColumns(input,path,updates),{archive,table}=open(output,path);
  for(const [name,values]of updates)expect(readModelColumnValues(archive,table,name)).toEqual(values);
  const h=readModelIntrinsicHierarchy(archive,table,'Amount');expect([...h.positionToId]).toEqual([2,8,9,10,50003,0,0]);
  expect(readModelHierarchyHash(archive,table,'Amount').size).toBe(5);expect(readModelHierarchyHash(archive,table,'Other').size).toBe(2);
  const raw=table.read();expect([...raw.slice(0,2)]).toEqual([255,254]);const xml=new TextDecoder('utf-16le').decode(raw);expect(xml).toContain('custom="retain"');
  expect(readModelColumnStorage(xml).columns[0].segments[0].bits).toBe(16);expect(input).toEqual(copy);
});
it('sorts negative-magnitude value dictionaries by values while retaining null membership', () => {
  const {input,path}=fixture({magnitude:-0.5});
  const output=rewriteModelValueColumns(input,path,new Map([['Amount',[-14n,-10n,null,-20n,-20n]]]));const {archive,table}=open(output,path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual([-14n,-10n,null,-20n,-20n]);
  expect([...readModelIntrinsicHierarchy(archive,table,'Amount').positionToId]).toEqual([2,13,10,8,0,0]);
  expect(readModelHierarchyHash(archive,table,'Amount').get(13)).toBe(1);
});
it('keeps RLE/subsegment metadata consistent after run patterns change', () => {
  const {input,path}=fixture({ids:Array(80).fill(8)}),values=[...Array(64).fill(7n),...Array.from({length:16},(_,i)=>BigInt(i+20))];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);expect(readModelHierarchyHash(archive,table,'Amount').size).toBe(17);
  const s=readModelColumnStorage(new TextDecoder().decode(table.read())).columns[0].segments[0];expect(s.packedRecords).toBe(16);expect(s.used).toBeGreaterThanOrEqual(4);
});
it('retains ordinary full and final segment boundaries', () => {
  const ids=Array(16387).fill(8);ids[0]=2;const {input,path}=fixture({ids,counts:[16384,3]}),values=Array(16387).fill(5n);values[0]=null;values[1]=-100n;values[16383]=100n;values[16384]=null;
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);expect(readModelColumnStorage(new TextDecoder().decode(table.read())).columns[0].segments.map(s=>s.records)).toEqual([16384,3]);
});
it('handles all-null and empty columns without inventing non-null members', () => {
  for(const ids of [[8,2],[]]){const {input,path}=fixture({ids}),values=ids.map(()=>null),{archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
    expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);expect(readModelHierarchyHash(archive,table,'Amount').size).toBe(ids.length?1:0);
  }
});
it('rejects nonrepresentable or invalid updates and leaves the original archive untouched', () => {
  const {input,path}=fixture({magnitude:0.5}),copy=input.slice();
  for(const values of [[10,null,12n,10n,14n],[10n,null,12n,10n],[10n,null,12n,10n,9223372036854775808n],[10n,null,12n,10n,5000000000n]])expect(()=>rewriteModelValueColumns(input,path,new Map([['Amount',values]]))).toThrow();
  expect(()=>rewriteModelValueColumns(input,path,new Map([['Amount',[-10n,null,12n,10n,14n]],['Missing',[]]]))).toThrow(/column/);
  expect(input).toEqual(copy);
});

it.each([
  {magnitude:1,values:[-25n,null,6n,0n,-25n],base:-28n,scale:1},
  {magnitude:0.5,values:[1n,null,12n,10n,14n],base:-2n,scale:1},
  {magnitude:0.5,values:[-4n,null,12n,10n,14n],base:-5n,scale:0.5},
  {magnitude:1,values:[9223372036854775807n,null,9223372036854775806n,9223372036854775807n,9223372036854775805n],base:9223372036854775802n,scale:1},
  {magnitude:1,values:[-9223372036854775808n,null,-9223372036854775807n,-9223372036854775808n,-9223372036854775806n],base:9223372036854775803n,scale:-1},
])('rebases exact integer dictionaries and all dependent IDs for $values',({magnitude,values,base,scale})=>{
  const {input,path}=fixture({magnitude}),before=input.slice();
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelColumnValues(archive,table,'Other')).toEqual([5n*BigInt(1/magnitude),null,6n*BigInt(1/magnitude),5n*BigInt(1/magnitude),7n*BigInt(1/magnitude)]);
  expect(readModelDictionary(archive,table,'Amount')).toMatchObject({baseId:base,magnitude:scale});
  const ordered=[...new Set(values)].sort((a,b)=>a===b?0:a===null?-1:b===null?1:a<b?-1:1);
  const ids=ordered.map(v=>v===null?2:Number(v/BigInt(1/scale)-base));
  expect([...readModelIntrinsicHierarchy(archive,table,'Amount').positionToId]).toEqual([...ids,0,0]);
  expect(readModelHierarchyHash(archive,table,'Amount')).toEqual(new Map(ids.map((id,i)=>[id,i])));expect(input).toEqual(before);
});
it('accepts the entire available ID span and rejects values beyond arithmetic encoding capacity',()=>{
  const {input,path}=fixture(),values=[-10n,null,2147483634n,-10n,0n];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(()=>rewriteModelValueColumns(input,path,new Map([['Amount',[-10n,null,2147483635n,0n,1n]]]))).toThrow(/supported arithmetic/);
});

it('uses an exactly representable common scale when a unit scale cannot span the values',()=>{
  const {input,path}=fixture(),values=[0n,null,6000000000n,12000000000n,-6000000000n];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelDictionary(archive,table,'Amount')).toMatchObject({baseId:-9n,magnitude:1e-9});
  expect(readModelHierarchyHash(archive,table,'Amount').size).toBe(5);
});
it('never rounds a nonrepresentable common scale when choosing the dictionary',()=>{
  const {input,path}=fixture(),value=9007199254740993n,values=[value,null,value,value,value];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelDictionary(archive,table,'Amount')).toMatchObject({baseId:value-3n,magnitude:1});
});

it.each([[[[3],[2]]],[[[0],[5]]],[[[2],[0],[3]]]])('rewrites ordered partitions with reversed file declarations: %j',(partitionCounts)=>{
  const {input,path}=fixture({ids:[8,2,9,10,8],partitionCounts}),values=[-10n,null,600n,20n,-10n];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelColumnValues(archive,table,'Other')).toEqual([5n,null,6n,7n,5n]);
  const schema=readModelColumnStorage(new TextDecoder().decode(table.read()));
  expect(schema.partitionMaps).toEqual(partitionCounts.map((counts,i)=>({partition:41-i*7,segments:counts.length,records:counts.reduce((n,v)=>n+v,0),perSegment:null})));
  expect(schema.columns[0].files.map(f=>f.partition)).toEqual(partitionCounts.map((_,i)=>41-i*7).reverse());
});
it('refuses inconsistent table maps before rewriting any columns',()=>{
  const {input,path}=fixture(),{table}=open(input,path),xml=new TextDecoder().decode(table.read());
  const other=xml.indexOf('name="Other"');
  const wrongOther=xml.slice(0,other)+xml.slice(other).replace('<Records>5</Records>','<Records>4</Records>');
  for(const altered of [xml.replace('<Records>5</Records>','<Records>6</Records>'),xml.replace(/<Members>.*?<\/Members>/,''),wrongOther]) {
    const invalid=replaceDataModelArchiveFiles(input,new Map([[path,text(altered)]])),before=invalid.slice();
    expect(()=>rewriteModelValueColumns(invalid,path,new Map([['Amount',[5n,null,6n,5n,7n]]]))).toThrow(/partition.*map/);
    expect(invalid).toEqual(before);
  }
});

it('validates the declared full-segment size before rewriting a multipart map',()=>{
  const ids=Array(16387).fill(8);ids[0]=2;const {input,path}=fixture({ids,counts:[16384,3]}),{table}=open(input,path);
  const xml=new TextDecoder().decode(table.read()).replace('<RecordsPerSegment>16384','<RecordsPerSegment>16383');
  const invalid=replaceDataModelArchiveFiles(input,new Map([[path,text(xml)]]));
  expect(()=>rewriteModelValueColumns(invalid,path,new Map([['Amount',ids.map(id=>id===2?null:5n)]]))).toThrow(/partition segment map/);
});

it.each([[[5]], [[16384,3]]])('rewrites a single partition with a flat segment map (%j)', counts => {
  const ids=Array(counts.reduce((a,b)=>a+b,0)).fill(8);ids[0]=2;
  const {input,path}=fixture({ids,counts,flatMap:true}),values=ids.map(id=>id===2?null:99n);
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelColumnStorage(new TextDecoder().decode(table.read())).partitionMaps[0].segments).toBe(counts.length);
});


it.each([0,1])('reassigns string dictionary rows while retaining materialization %s and exact dictionary bytes',materialization=>{
  const options={dictionaryValues:['z','a','é'],materialization,partitionCounts:[[2],[0],[3]]};
  const {input,path}=fixture(options),before=open(input,path),values=['é','a',null,'z','z'];
  const output=rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),after=open(output,path);
  expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(values);
  expect(readModelColumnValues(after.archive,after.table,'Other')).toEqual(['z',null,'a','z','é']);
  // Persisted member ordering is authoritative even when JS lexical order differs.
  expect(readModelIntrinsicHierarchy(after.archive,after.table,'Amount')).toEqual(readModelIntrinsicHierarchy(before.archive,before.table,'Amount'));
  for(const file of before.archive.files)if(file.path!==path&&!file.path.includes('/c0-'))expect(after.archive.files.find(f=>f.path===file.path).read()).toEqual(file.read());
});
it.each(['long','real'])('reassigns exact %s dictionary values without numeric conversion',dictionaryType=>{
  const dictionaryValues=dictionaryType==='long'?[-9223372036854775808n,9007199254740993n,9223372036854775807n]:[-0,Number.MIN_VALUE,Number.MAX_VALUE];
  const {input,path}=fixture({dictionaryValues,dictionaryType}),values=[dictionaryValues[2],dictionaryValues[1],null,dictionaryValues[0],dictionaryValues[0]];
  const {archive,table}=open(rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
});
it('preserves empty strings, exact Unicode spellings and moved nulls',()=>{
  const {input,path}=fixture({dictionaryValues:['','e\u0301','é']}),values=['é','','e\u0301',null,'é'];
  const {archive,table}=open(rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
});
it('rejects new values, removed NULL membership, type coercion and later failures atomically',()=>{
  const {input,path}=fixture({dictionaryValues:['z','a','é']}),copy=input.slice();
  for(const values of [['Z',null,'a','z','é'],['z','z','a','z','é'],[3,null,'a','z','é'],['z',null,'a']]) {
    expect(()=>rewriteModelDictionaryColumns(input,path,new Map([['Other',['é',null,'a','z','z']],['Amount',values]]))).toThrow();expect(input).toEqual(copy);
  }
  const signed=fixture({dictionaryValues:[-0,1,2],dictionaryType:'real'});
  expect(()=>rewriteModelDictionaryColumns(signed.input,signed.path,new Map([['Amount',[0,null,1,-0,2]]]))).toThrow(/value identity/);
});
it('validates array hierarchy inverses before preserving their storage',()=>{
  const {input,path}=fixture({dictionaryValues:['z','a','é'],materialization:0}),{archive}=open(input,path);
  const file=archive.files.find(f=>f.path==='scope/i0.idf'),bytes=file.read().slice();bytes[16]=99;
  const invalid=replaceDataModelArchiveFiles(input,new Map([[file.path,bytes]]));
  expect(()=>rewriteModelDictionaryColumns(invalid,path,new Map([['Amount',['é','a',null,'z','z']]]))).toThrow(/inverse/);
});

it('updates dictionary-column RLE statistics across full and short segments',()=>{
  const ids=Array(16387).fill(8);ids[0]=2;ids[1]=9;ids[2]=10;
  const {input,path}=fixture({ids,counts:[16384,3],dictionaryValues:['z','a','é'],materialization:0});
  const values=Array(16387).fill('z');values.fill('é',0,64);values[16384]='a';values[16386]=null;
  const {archive,table}=open(rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  const column=readModelColumnStorage(new TextDecoder().decode(table.read())).columns[0];
  expect(column.segments.map(s=>s.records)).toEqual([16384,3]);
  expect(column.segments[0].packedRecords).toBe(0);expect(column.segments[1].packedRecords).toBe(3);
  expect(readModelDictionary(archive,table,'Amount').stats).toMatchObject({rows:16387,min:8,max:10,hasNulls:true});
});

it.each([0,1])('compacts removed dictionary members and materialization %s without reordering survivors',materialization=>{
  const {input,path}=fixture({dictionaryValues:['z','a','é'],materialization,partitionCounts:[[2],[0],[3]]}),before=open(input,path);
  for(const removed of ['z','a','é']) {
    const old=['z',null,'a','z','é'],replacement=removed==='z'?'é':'z',values=old.map(v=>v===removed?replacement:v);
    const output=rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),{archive,table}=open(output,path);
    expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
    const dict=readModelDictionary(archive,table,'Amount');expect(dict.values).toEqual(['z','a','é'].filter(v=>v!==removed));expect(dict.lastId).toBe(9);
    const h=readModelIntrinsicHierarchy(archive,table,'Amount');expect(h.distinctDataIds).toBe(3);expect([...h.positionToId.slice(0,3)]).toEqual([2,8,9]);
    expect([...h.positionToId.slice(3)]).toEqual([...readModelIntrinsicHierarchy(before.archive,before.table,'Amount').positionToId.slice(4)]);
    if(materialization===0){expect(h.idToPosition.length).toBe(10);for(let p=0;p<3;p++)expect(h.idToPosition[h.positionToId[p]]).toBe(p);}
    else expect([...readModelHierarchyHash(archive,table,'Amount')].sort()).toEqual([[2,0],[8,1],[9,2]].sort());
    expect(readModelColumnValues(archive,table,'Other')).toEqual(old);
    for(const file of before.archive.files)if(file.path.includes('1.'))expect(archive.files.find(f=>f.path===file.path).read()).toEqual(file.read());
  }
});
it.each([0,1])('supports repeated compaction down to an existing NULL-only member with materialization %s',materialization=>{
  const {input,path}=fixture({dictionaryValues:['','e\u0301','é'],materialization});
  let output=rewriteModelDictionaryColumns(input,path,new Map([['Amount',['é',null,'é','é','é']]]));
  const first=open(output,path);expect(readModelDictionary(first.archive,first.table,'Amount').values).toEqual(['é']);
  output=rewriteModelDictionaryColumns(output,path,new Map([['Amount',Array(5).fill(null)]]));
  const {archive,table}=open(output,path),d=readModelDictionary(archive,table,'Amount'),h=readModelIntrinsicHierarchy(archive,table,'Amount');
  expect(d.values).toEqual([]);expect(d.lastId).toBe(7);expect(readModelColumnValues(archive,table,'Amount')).toEqual(Array(5).fill(null));
  expect([...h.positionToId.slice(0,h.distinctDataIds)]).toEqual([2]);
  if(materialization===0){expect(h.idToPosition).toHaveLength(8);expect(h.idToPosition[2]).toBe(0);}
  else expect(readModelHierarchyHash(archive,table,'Amount')).toEqual(new Map([[2,0]]));
});
it.each(['long','real'])('compacts %s dictionaries without rounding retained numeric values',dictionaryType=>{
  const dictionaryValues=dictionaryType==='long'?[-9223372036854775808n,9007199254740993n,9223372036854775807n]:[-0,Number.MIN_VALUE,Number.MAX_VALUE];
  const {input,path}=fixture({dictionaryValues,dictionaryType,materialization:0}),values=[dictionaryValues[2],null,dictionaryValues[1],dictionaryValues[2],dictionaryValues[2]];
  const {archive,table}=open(rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelDictionary(archive,table,'Amount').values).toEqual(dictionaryValues.slice(1));expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
});
it('rejects unverified sparse inverse profiles and fails atomically after a dictionary rebuild',()=>{
  const {input,path}=fixture({dictionaryValues:['z','a','é','unused'],materialization:0}),copy=input.slice();
  expect(()=>rewriteModelDictionaryColumns(input,path,new Map([['Amount',['z',null,'z','z','é']]]))).toThrow(/sparse dictionary hierarchy/);expect(input).toEqual(copy);
  const valid=fixture({dictionaryValues:['z','a','é']});
  expect(()=>rewriteModelDictionaryColumns(valid.input,valid.path,new Map([['Amount',['z',null,'z','z','é']],['Other',['unknown',null,'z','z','é']]]))).toThrow(/rebuild/);
  const unchanged=open(valid.input,valid.path);expect(readModelDictionary(unchanged.archive,unchanged.table,'Amount').values).toEqual(['z','a','é']);
});

it('adds and removes NULL in a dense string hierarchy without conflating empty strings',()=>{
  const {input,path}=fixture({ids:[8,9,10,8,9],dictionaryValues:['','z','é'],materialization:0}),before=open(input,path);
  const values=['',null,'é','z',''],output=rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),after=open(output,path);
  expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(values);
  const d=readModelDictionary(after.archive,after.table,'Amount'),h=readModelIntrinsicHierarchy(after.archive,after.table,'Amount');
  expect(d.nullable).toBe(true);expect(d.stats.hasNulls).toBe(true);expect(d.values).toEqual(['','z','é']);
  expect([...h.positionToId.slice(0,h.distinctDataIds)]).toEqual([2,8,9,10]);expect(h.positionToId).toHaveLength(11);
  for(let i=0;i<h.distinctDataIds;i++)expect(h.idToPosition[h.positionToId[i]]).toBe(i);
  const restored=open(rewriteModelDictionaryColumns(output,path,new Map([['Amount',['','z','é','z','']]])),path);
  expect(readModelDictionary(restored.archive,restored.table,'Amount').nullable).toBe(false);
  const restoredHierarchy=readModelIntrinsicHierarchy(restored.archive,restored.table,'Amount');
  expect(restoredHierarchy.positionToId).toEqual(readModelIntrinsicHierarchy(before.archive,before.table,'Amount').positionToId);
  expect(restoredHierarchy.idToPosition).toEqual(readModelIntrinsicHierarchy(before.archive,before.table,'Amount').idToPosition);
});
it('combines NULL transitions with dictionary compaction, including NULL-only and non-null-only states',()=>{
  const {input,path}=fixture({ids:[8,9,10,8,9],dictionaryValues:['','z','é'],materialization:0});
  for(const values of [[null,'é','é','é','é'],Array(5).fill(null)]) {
    const {archive,table}=open(rewriteModelDictionaryColumns(input,path,new Map([['Amount',values]])),path),d=readModelDictionary(archive,table,'Amount'),h=readModelIntrinsicHierarchy(archive,table,'Amount');
    expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);expect(h.positionToId).toHaveLength(d.lastId+1);expect(h.idToPosition).toHaveLength(d.lastId+1);
    for(let i=0;i<h.distinctDataIds;i++)expect(h.idToPosition[h.positionToId[i]]).toBe(i);
  }
  const withNull=fixture({dictionaryValues:['','z','é'],materialization:0});
  const {archive,table}=open(rewriteModelDictionaryColumns(withNull.input,withNull.path,new Map([['Amount',Array(5).fill('é')]])),withNull.path);
  expect(readModelDictionary(archive,table,'Amount')).toMatchObject({nullable:false,values:['é']});
  expect([...readModelIntrinsicHierarchy(archive,table,'Amount').positionToId.slice(0,1)]).toEqual([8]);
});
it('respects null-forbidden column settings and rejects unverified NULL mapping profiles atomically',()=>{
  const {input,path}=fixture({ids:[8,9,10,8,9],dictionaryValues:['','z','é'],materialization:0}),{table}=open(input,path),xml=new TextDecoder().decode(table.read());
  for(const changed of [xml.replaceAll('<ColumnFlags>8','<ColumnFlags>9'),xml.replaceAll('<Settings>1','<Settings>257')]) {
    const invalid=replaceDataModelArchiveFiles(input,new Map([[path,text(changed)]])),copy=invalid.slice();
    expect(()=>rewriteModelDictionaryColumns(invalid,path,new Map([['Amount',['',null,'é','z','']]]))).toThrow(/forbids null/);expect(invalid).toEqual(copy);
  }
  for(const materialization of [0,1]) {
    const f=fixture({dictionaryValues:[1n,2n,3n],dictionaryType:'long',materialization});
    const next = open(rewriteModelDictionaryColumns(f.input,f.path,new Map([['Amount',[1n,2n,3n,1n,2n]]])),f.path);
    expect(readModelColumnValues(next.archive,next.table,'Amount')).toEqual([1n,2n,3n,1n,2n]);
  }
});

it('keeps uniqueness constraints when introducing a string NULL',()=>{
  const {input,path}=fixture({ids:[8,9,10],dictionaryValues:['','z','é'],materialization:0}),{table}=open(input,path);
  const xml=new TextDecoder().decode(table.read()).replaceAll('<ColumnFlags>8','<ColumnFlags>10');
  const constrained=replaceDataModelArchiveFiles(input,new Map([[path,text(xml)]]));
  expect(()=>rewriteModelDictionaryColumns(constrained,path,new Map([['Amount',[null,null,'é']]]))).toThrow(/requires unique/);
  const {archive,table:after}=open(rewriteModelDictionaryColumns(constrained,path,new Map([['Amount',[null,'z','é']]])),path);
  expect(readModelColumnValues(archive,after,'Amount')).toEqual([null,'z','é']);
});

it.each(['value','dictionary'])('enforces uniqueness for every %s rewrite, without a NULL transition',kind=>{
  const dictionary=kind==='dictionary',f=fixture({ids:[8,9,10],...(dictionary?{dictionaryValues:['z','a','é'],materialization:0}:{})}),{table}=open(f.input,f.path);
  const xml=new TextDecoder().decode(table.read()).replaceAll('<ColumnFlags>8','<ColumnFlags>10');
  const input=replaceDataModelArchiveFiles(f.input,new Map([[f.path,text(xml)]])),copy=input.slice();
  const writer=dictionary?rewriteModelDictionaryColumns:rewriteModelValueColumns;
  const valid=dictionary?['é','a','z']:[7n,6n,5n],invalid=dictionary?['z','z','é']:[5n,5n,7n];
  expect(()=>writer(input,f.path,new Map([['Other',valid],['Amount',invalid]]))).toThrow(/requires unique/);expect(input).toEqual(copy);
  const after=open(writer(input,f.path,new Map([['Amount',valid]])),f.path);expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(valid);
});
it.each(['value','dictionary'])('rejects unchanged NULL membership when %s column constraints disallow it',kind=>{
  const dictionary=kind==='dictionary',f=fixture(dictionary?{dictionaryValues:['z','a','é']}:{}) ,{table}=open(f.input,f.path);
  const xml=new TextDecoder().decode(table.read()),values=dictionary?['z',null,'a','é','z']:[5n,null,6n,7n,5n],writer=dictionary?rewriteModelDictionaryColumns:rewriteModelValueColumns;
  for(const altered of [xml.replaceAll('<ColumnFlags>8','<ColumnFlags>9'),xml.replaceAll('<Settings>1','<Settings>257')]) {
    const input=replaceDataModelArchiveFiles(f.input,new Map([[f.path,text(altered)]]));
    expect(()=>writer(input,f.path,new Map([['Amount',values]]))).toThrow(/forbids null/);
  }
});
it.each(['value','dictionary'])('counts repeated NULLs against the %s uniqueness constraint',kind=>{
  const dictionary=kind==='dictionary',f=fixture({ids:[2,8,9,10],...(dictionary?{dictionaryValues:['','z','é'],materialization:0}:{})}),{table}=open(f.input,f.path);
  const xml=new TextDecoder().decode(table.read()).replaceAll('<ColumnFlags>8','<ColumnFlags>+10');
  const input=replaceDataModelArchiveFiles(f.input,new Map([[f.path,text(xml)]])),writer=dictionary?rewriteModelDictionaryColumns:rewriteModelValueColumns;
  expect(()=>writer(input,f.path,new Map([['Amount',dictionary?[null,null,'','é']:[null,null,5n,7n]]]))).toThrow(/requires unique/);
  const values=dictionary?[null,'','z','é']:[null,0n,1n,2n],after=open(writer(input,f.path,new Map([['Amount',values]])),f.path);
  expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(values);
});
it('requires unambiguous bounded column constraints even when no NULL is written',()=>{
  const f=fixture({ids:[8,9,10]}),{table}=open(f.input,f.path),xml=new TextDecoder().decode(table.read());
  const variants=[...['-1','64','1.5','NaN','9007199254740993'].map(v=>xml.replace('<ColumnFlags>8',`<ColumnFlags>${v}`)),
    ...['-1','7995','1e2'].map(v=>xml.replace('<Settings>1</Settings>',`<Settings>${v}</Settings>`)),
    xml.replace('<ColumnFlags>8</ColumnFlags>',''),xml.replace('<Settings>1</Settings>',''),
    xml.replace('<ColumnFlags>8</ColumnFlags>','<ColumnFlags>8</ColumnFlags><ColumnFlags>10</ColumnFlags>')];
  for(const altered of variants){const input=replaceDataModelArchiveFiles(f.input,new Map([[f.path,text(altered)]])),copy=input.slice();
    expect(()=>rewriteModelValueColumns(input,f.path,new Map([['Amount',[7n,6n,5n]]]))).toThrow(/column constraints|missing or duplicate/);expect(input).toEqual(copy);}
});

it.each([1,3,7])('adds and removes integer NULL membership using %s declared unused slots',tailSlots=>{
  const {input,path}=fixture({ids:[8,9,10,8,9],tailSlots}),before=open(input,path);
  const values=[null,6n,7n,5n,6n],output=rewriteModelValueColumns(input,path,new Map([['Amount',values]])),after=open(output,path);
  expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(values);
  const h=readModelIntrinsicHierarchy(after.archive,after.table,'Amount');expect(h.distinctDataIds).toBe(4);expect(h.positionToId).toHaveLength(3+tailSlots);
  expect(h.positionToId[0]).toBe(2);expect(readModelHierarchyHash(after.archive,after.table,'Amount').get(2)).toBe(0);
  const restored=open(rewriteModelValueColumns(output,path,new Map([['Amount',[5n,6n,7n,5n,6n]]])),path);
  expect(readModelIntrinsicHierarchy(restored.archive,restored.table,'Amount').positionToId).toEqual(readModelIntrinsicHierarchy(before.archive,before.table,'Amount').positionToId);
  expect(readModelHierarchyHash(restored.archive,restored.table,'Amount').has(2)).toBe(false);
  expect(readModelDictionary(restored.archive,restored.table,'Amount').stats.hasNulls).toBe(false);
});
it('combines integer NULL changes with rebasing, member growth, shrinking and NULL-only output',()=>{
  const {input,path}=fixture(),before=open(input,path),old=readModelIntrinsicHierarchy(before.archive,before.table,'Amount');
  const values=[-100n,0n,10n,20n,30n],output=rewriteModelValueColumns(input,path,new Map([['Amount',values]])),after=open(output,path);
  expect(readModelColumnValues(after.archive,after.table,'Amount')).toEqual(values);
  const h=readModelIntrinsicHierarchy(after.archive,after.table,'Amount');expect(h.positionToId.length-h.distinctDataIds).toBe(old.positionToId.length-old.distinctDataIds+1);
  const nullOnly=open(rewriteModelValueColumns(output,path,new Map([['Amount',Array(5).fill(null)]])),path);
  expect(readModelColumnValues(nullOnly.archive,nullOnly.table,'Amount')).toEqual(Array(5).fill(null));
  const nh=readModelIntrinsicHierarchy(nullOnly.archive,nullOnly.table,'Amount');expect([...nh.positionToId]).toEqual([2,0,0]);
  const single=open(rewriteModelValueColumns(rewriteModelValueColumns(output,path,new Map([['Amount',Array(5).fill(null)]])),path,new Map([['Amount',Array(5).fill(-9223372036854775808n)]])),path);
  expect(readModelColumnValues(single.archive,single.table,'Amount')).toEqual(Array(5).fill(-9223372036854775808n));
});
it('retains multipart boundaries while adding a numeric NULL',()=>{
  const {input,path}=fixture({ids:[8,9,10,8,9],partitionCounts:[[2],[0],[3]]}),values=[5n,null,7n,5n,6n];
  const {archive,table}=open(rewriteModelValueColumns(input,path,new Map([['Amount',values]])),path);
  expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
  expect(readModelColumnStorage(new TextDecoder().decode(table.read())).partitionMaps.map(p=>p.records)).toEqual([2,0,3]);
});
it('rejects unsupported unused-slot contents, insufficient capacity and inconsistent old NULL metadata',()=>{
  for(const options of [{tailSlots:0},{tailValue:19}]) {
    const {input,path}=fixture({ids:[8,9,10,8,9],...options}),copy=input.slice();
    expect(()=>rewriteModelValueColumns(input,path,new Map([['Amount',[null,6n,7n,5n,6n]]]))).toThrow(/mapping capacity/);expect(input).toEqual(copy);
  }
  const {input,path}=fixture(),{table}=open(input,path),xml=new TextDecoder().decode(table.read()).replace('<HasNulls>true','<HasNulls>false');
  const invalid=replaceDataModelArchiveFiles(input,new Map([[path,text(xml)]]));
  expect(()=>rewriteModelValueColumns(invalid,path,new Map([['Amount',[null,6n,7n,5n,6n]]]))).toThrow(/null/);
});

// XML entity byte order must agree across discovery, value reading and writes.
function metadataByteOrder(input, encoding) {
  const archive = readDataModelArchive(input), replacements = new Map();
  for (const [i, file] of archive.files.filter(f => f.path.endsWith('.tbl.xml')).entries()) {
    const xml = new TextDecoder().decode(file.read()).replace('custom="retain"', 'custom="费用 🌍"');
    const bytes = utf16('\ufeff' + xml);
    if (encoding === 'be' || encoding === 'mixed' && i % 2 === 0) {
      for (let at = 0; at < bytes.length; at += 2) [bytes[at], bytes[at + 1]] = [bytes[at + 1], bytes[at]];
    }
    replacements.set(file.path, bytes);
  }
  return replaceDataModelArchiveFiles(input, replacements);
}
it.each(['be', 'mixed'])('reads and rewrites arithmetic metadata with %s UTF-16 byte order', encoding => {
  const f = fixture(), input = metadataByteOrder(f.input, encoding), { archive, table } = open(input, f.path);
  expect(readModelColumnValues(archive, table, 'Amount')).toEqual([5n, null, 6n, 5n, 7n]);
  const values = [-75n, null, 9n, 5n, 7n], output = rewriteModelValueColumns(input, f.path, new Map([['Amount', values]])), next = open(output, f.path);
  expect(readModelColumnValues(next.archive, next.table, 'Amount')).toEqual(values);
  expect(readModelHierarchyHash(next.archive, next.table, 'Amount').size).toBe(5);
  for (const file of next.archive.files.filter(f => f.path.endsWith('.tbl.xml'))) {
    const before = archive.files.find(f => f.path === file.path).read(), after = file.read();
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(new TextDecoder(after[0] === 254 ? 'utf-16be' : 'utf-16le').decode(after)).toContain('custom="费用 🌍"');
  }
});
it('reads and rewrites string dictionaries and dense hierarchy metadata in big-endian XML', () => {
  const f = fixture({ ids: [3, 4, 5, 3], dictionaryValues: ['蓝', 'é', '🌍'], materialization: 0 });
  const archive = readDataModelArchive(f.input), table = archive.files.find(file => file.path === f.path);
  const adjusted = replaceDataModelArchiveFiles(f.input, new Map([[f.path, text(new TextDecoder().decode(table.read()).replaceAll('<LastId>10</LastId>', '<LastId>5</LastId>'))]]));
  const input = metadataByteOrder(adjusted, 'be');
  const values = ['蓝', null, '🌍', '蓝'], output = rewriteModelDictionaryColumns(input, f.path, new Map([['Amount', values]])), next = open(output, f.path);
  expect(readModelColumnValues(next.archive, next.table, 'Amount')).toEqual(values);
  expect(readModelDictionary(next.archive, next.table, 'Amount').values).toEqual(['蓝', '🌍']);
  expect(readModelIntrinsicHierarchy(next.archive, next.table, 'Amount').idToPosition).not.toBeNull();
});

it.each([[0.002,500n], [1e-9,1000000000n], [-0.002,-500n]])('retains native fractional scale %s through repeated dictionary rewrites', (magnitude,factor) => {
  const {input,path}=fixture({magnitude});
  let bytes=input;
  for(let pass=0;pass<2;pass++) {
    const values=[5n*factor,null,BigInt(pass+20)*factor,5n*factor,7n*factor];
    bytes=rewriteModelValueColumns(bytes,path,new Map([['Amount',values]]));
    const {archive,table}=open(bytes,path);
    expect(readModelColumnValues(archive,table,'Amount')).toEqual(values);
    expect(readModelDictionary(archive,table,'Amount').magnitude).toBe(magnitude);
    const h=readModelHierarchyHash(archive,table,'Amount');expect(h.size).toBe(4);
  }
});

function expectNumericHierarchy(archive, table, name, values) {
  expect(readModelColumnValues(archive, table, name)).toEqual(values);
  const d = readModelDictionary(archive, table, name), h = readModelIntrinsicHierarchy(archive, table, name), first = d.lastId - d.values.length + 1;
  const ordered = [...h.positionToId.subarray(0, h.distinctDataIds)];
  const decoded = ordered.map(id => id === 2 ? null : d.values[id - first]);
  const expected = [...new Map(values.map(value => [value, value])).values()].sort((a, b) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  expect(decoded).toEqual(expected);
  const inverse = h.materialization === 0 ? new Map(ordered.map(id => [id, h.idToPosition[id]])) : readModelHierarchyHash(archive, table, name);
  expect([...inverse].sort()).toEqual(ordered.map((id, position) => [id, position]).sort());
  expect(d.stats.hasNulls).toBe(values.includes(null));
  if (h.idToPosition) expect(h.idToPosition[1]).toBe(h.distinctDataIds);
}
it.each([0, 1])('rebuilds growing numeric dictionaries and hierarchy materialization %s', materialization => {
  const f = fixture({ ids: [8, 9, 10, 8, 9], dictionaryValues: [1, 4, 9], dictionaryType: 'real', materialization, partitionCounts: [[2], [0], [3]] });
  const copy = f.input.slice(), values = [7.5, -3, 4, Number.MIN_VALUE, Number.MAX_VALUE];
  const result = open(rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', values]])), f.path);
  expectNumericHierarchy(result.archive, result.table, 'Amount', values);
  expect(readModelDictionary(result.archive, result.table, 'Amount').values).toEqual([4, 7.5, -3, Number.MIN_VALUE, Number.MAX_VALUE]);
  expect(readModelColumnValues(result.archive, result.table, 'Other')).toEqual([1, 4, 9, 1, 4]);
  expect(f.input).toEqual(copy);
});
it.each([0, 1])('adds exact 64-bit dictionary members with hierarchy materialization %s', materialization => {
  const f = fixture({ dictionaryValues: [1n, 2n, 3n], dictionaryType: 'long', materialization });
  const values = [9223372036854775807n, null, -9223372036854775808n, 9007199254740993n, 2n];
  const result = open(rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', values]])), f.path);
  expectNumericHierarchy(result.archive, result.table, 'Amount', values);
});
it.each([0, 1])('repeatedly grows, shrinks and changes numeric NULL membership with materialization %s', materialization => {
  const f = fixture({ ids: [8, 9, 10, 8, 9], dictionaryValues: [1, 2, 3], dictionaryType: 'real', materialization });
  let input = f.input;
  for (const values of [[-1, null, 6.5, 8, 9], [null, null, null, null, null], [-0, 4, 5, 6, 7], [-0, -0, -0, -0, -0]]) {
    input = rewriteModelDictionaryColumns(input, f.path, new Map([['Amount', values]]));
    const result = open(input, f.path); expectNumericHierarchy(result.archive, result.table, 'Amount', values);
  }
});
it.each([NaN, Infinity, -Infinity, '5', 5n])('rejects invalid new real dictionary value %s atomically', value => {
  const f = fixture({ dictionaryValues: [1, 2, 3], dictionaryType: 'real' }), copy = f.input.slice();
  expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [4, null, 2, 4, 3]], ['Other', [value, null, 2, 1, 3]]]))).toThrow(/numeric dictionary value/);
  expect(f.input).toEqual(copy);
});
it.each([1, 9223372036854775808n, -9223372036854775809n])('rejects nonrepresentable integer dictionary value %s', value => {
  const f = fixture({ dictionaryValues: [1n, 2n, 3n], dictionaryType: 'long' });
  expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [value, null, 2n, 1n, 3n]]]))).toThrow(/numeric dictionary value/);
});
it('does not merge distinct signed-zero bit patterns while adding numeric members', () => {
  const f = fixture({ dictionaryValues: [1, 2, 3], dictionaryType: 'real' });
  expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [0, null, -0, 1, 3]]]))).toThrow(/value identity/);
});
it('rejects unsorted or inconsistent numeric hierarchies before rebuilding new members', () => {
  const f = fixture({ dictionaryValues: [3, 1, 2], dictionaryType: 'real' });
  expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [4, null, 1, 3, 2]]]))).toThrow(/numeric hierarchy order/);
  const good = fixture({ dictionaryValues: [1, 2, 3], dictionaryType: 'real' }), { table } = open(good.input, good.path);
  const input = replaceDataModelArchiveFiles(good.input, new Map([[good.path, text(new TextDecoder().decode(table.read()).replaceAll('<SortOrder>0', '<SortOrder>2'))]]));
  expect(() => rewriteModelDictionaryColumns(input, good.path, new Map([['Amount', [4, null, 1, 3, 2]]]))).toThrow(/ascending order/);
});
it('keeps nullability and uniqueness constraints when numeric dictionaries grow', () => {
  const f = fixture({ ids: [8, 9, 10], dictionaryValues: [1, 2, 3], dictionaryType: 'real', materialization: 0 }), { table } = open(f.input, f.path);
  const xml = new TextDecoder().decode(table.read());
  const required = replaceDataModelArchiveFiles(f.input, new Map([[f.path, text(xml.replaceAll('<ColumnFlags>8', '<ColumnFlags>9'))]]));
  expect(() => rewriteModelDictionaryColumns(required, f.path, new Map([['Amount', [7, null, 1]]]))).toThrow(/forbids null/);
  const unique = replaceDataModelArchiveFiles(f.input, new Map([[f.path, text(xml.replaceAll('<ColumnFlags>8', '<ColumnFlags>10'))]]));
  expect(() => rewriteModelDictionaryColumns(unique, f.path, new Map([['Amount', [7, 7, 1]]]))).toThrow(/requires unique/);
});
it('retains 32-bit integer dictionary encoding and rejects overflow', () => {
  const f = fixture({ dictionaryValues: [1n, 2n, 3n], dictionaryType: 'long', operatingOn32: true, materialization: 0 });
  const values = [-2147483648n, null, 2147483647n, 4n, 2n];
  const next = open(rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', values]])), f.path);
  expectNumericHierarchy(next.archive, next.table, 'Amount', values);
  expect(readModelDictionary(next.archive, next.table, 'Amount').storage.operatingOn32).toBe(true);
  for (const value of [2147483648n, -2147483649n]) expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [value, null, 2n, 1n, 3n]]]))).toThrow(/numeric dictionary value/);
});
it('rebuilds numeric dictionaries across full and final compressed segments', () => {
  const ids = Array(16387).fill(8); ids[0] = 2;
  const f = fixture({ ids, counts: [16384, 3], dictionaryValues: [1], dictionaryType: 'real', materialization: 0 });
  const values = Array(16387).fill(7.5); values[0] = null; values[16383] = -6.25; values[16384] = 80;
  const next = open(rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', values]])), f.path);
  expectNumericHierarchy(next.archive, next.table, 'Amount', values);
  expect(readModelColumnStorage(new TextDecoder().decode(next.table.read())).columns[0].segments.map(s => s.records)).toEqual([16384, 3]);
});
it('updates the native inverse-map end sentinel when existing members are removed', () => {
  const f = fixture({ dictionaryValues: ['a', 'b', 'c'], materialization: 0 });
  const next = open(rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', ['a', null, 'a', 'a', 'c']]])), f.path);
  const h = readModelIntrinsicHierarchy(next.archive, next.table, 'Amount');
  expect(h.distinctDataIds).toBe(3); expect(h.idToPosition[1]).toBe(3);
});
it('rejects an inconsistent native inverse-map end position before any rewrite', () => {
  const f = fixture({ dictionaryValues: [1, 2, 3], dictionaryType: 'real', materialization: 0 }), before = open(f.input, f.path);
  const h = readModelIntrinsicHierarchy(before.archive, before.table, 'Amount'), inverse = h.idToPosition.slice(); inverse[1] = 0;
  const storage = before.archive.files.find(file => file.path === h.storagePath), layout = readModelColumnStorage(new TextDecoder().decode(storage.read()), { hierarchy: true });
  const segments = layout.columns.find(c => c.name === 'ID_TO_POS').segments;
  const invalid = replaceDataModelArchiveFiles(f.input, new Map([['scope/i0.idf', encodeModelMappingIds(inverse, segments).bytes]])), copy = invalid.slice();
  expect(() => rewriteModelDictionaryColumns(invalid, f.path, new Map([['Amount', [7, null, 2, 1, 3]]]))).toThrow(/inverse end position/);
  expect(invalid).toEqual(copy);
});
it('does not reinterpret nonzero reserved mapping slots during a numeric NULL transition', () => {
  const f = fixture({ ids: [8, 9, 10, 8, 9], dictionaryValues: [1, 2, 3], dictionaryType: 'real', tailValue: 7 });
  expect(() => rewriteModelDictionaryColumns(f.input, f.path, new Map([['Amount', [4, null, 2, 1, 3]]]))).toThrow(/zero-filled mapping/);
});

it.each(['string', 'real', 'long'])('atomically rewrites a complete mixed value/%s table projection', dictionaryType => {
  const dictionaryValues = dictionaryType === 'string' ? ['a', 'b', 'c'] : dictionaryType === 'long' ? [1n, 2n, 3n] : [1, 2, 3];
  const f = fixture({ columnDictionaries: [null, { dictionaryValues, dictionaryType }] }), copy = f.input.slice();
  const other = dictionaryType === 'string' ? ['c', null, 'a', 'b', 'a'] : dictionaryType === 'long' ? [9007199254740993n, null, -5n, 1n, 4n] : [4.5, null, -2.25, 1, 6];
  const updates = new Map([['Amount', [30n, null, 10n, 20n, 10n]], ['Other', other]]);
  const next = open(rewriteModelTableRows(f.input, f.path, updates), f.path);
  for (const [name, values] of updates) expect(readModelColumnValues(next.archive, next.table, name)).toEqual(values);
  expect(f.input).toEqual(copy);
});
it('keeps reordered row tuples aligned across string and numeric dictionary columns', () => {
  const f = fixture({ ids: [8, 9, 10, 8, 9], columnDictionaries: [{ dictionaryValues: ['a', 'b', 'c'], materialization: 0 }, { dictionaryValues: [1, 2, 3], dictionaryType: 'real', materialization: 0 }] });
  const updates = new Map([['Other', [30, 10, 20, 10, 20]], ['Amount', ['c', 'a', 'b', 'a', 'b']]]);
  const next = open(rewriteModelTableRows(f.input, f.path, updates), f.path);
  const labels = readModelColumnValues(next.archive, next.table, 'Amount'), values = readModelColumnValues(next.archive, next.table, 'Other');
  expect(labels.map((label, i) => [label, values[i]])).toEqual([['c', 30], ['a', 10], ['b', 20], ['a', 10], ['b', 20]]);
});
it('retains unchanged generated sequence storage in a complete projection', () => {
  const f = fixture({ rowNumbers: true, columnDictionaries: [null, { dictionaryValues: [1, 2, 3], dictionaryType: 'real' }] }), before = open(f.input, f.path);
  const updates = new Map([['Other', [5, null, 2, 1, 3]], ['RowNumber', [0n, 1n, 2n, 3n, 4n]], ['Amount', [50n, null, 6n, 5n, 7n]]]);
  const next = open(rewriteModelTableRows(f.input, f.path, updates, { maxValues: 15 }), f.path);
  for (const [name, values] of updates) expect(readModelColumnValues(next.archive, next.table, name)).toEqual(values);
  expect(next.archive.files.find(f => f.path === 'scope/sequence.idf').read()).toEqual(before.archive.files.find(f => f.path === 'scope/sequence.idf').read());
  expect(() => rewriteModelTableRows(f.input, f.path, updates, { maxValues: 14 })).toThrow(/value limit/);
});
it('recognizes generated sequences by compression rather than their column name', () => {
  const f = fixture({ rowNumbers: true }), before = open(f.input, f.path);
  const input = replaceDataModelArchiveFiles(f.input, new Map([[f.path, text(new TextDecoder().decode(before.table.read()).replace('name="RowNumber"', 'name="Opaque identity"'))]]));
  const updates = new Map([['Amount', [5n, null, 6n, 5n, 7n]], ['Other', [5n, null, 6n, 5n, 7n]], ['Opaque identity', [0n, 1n, 2n, 3n, 4n]]]);
  const next = open(rewriteModelTableRows(input, f.path, updates), f.path);
  expect(readModelColumnValues(next.archive, next.table, 'Opaque identity')).toEqual([0n, 1n, 2n, 3n, 4n]);
});
it.each(['missing', 'unknown', 'short', 'long', 'non-array', 'changed-sequence', 'coerced-sequence'])('rejects incomplete or inconsistent whole-table rows: %s', problem => {
  const f = fixture({ rowNumbers: true }), copy = f.input.slice();
  const updates = new Map([['Amount', [5n, null, 6n, 5n, 7n]], ['Other', [5n, null, 6n, 5n, 7n]], ['RowNumber', [0n, 1n, 2n, 3n, 4n]]]);
  if (problem === 'missing') updates.delete('Other');
  if (problem === 'unknown') { updates.delete('Other'); updates.set('Different', [5n, null, 6n, 5n, 7n]); }
  if (problem === 'short') updates.get('Other').pop();
  if (problem === 'long') updates.get('Other').push(7n);
  if (problem === 'non-array') updates.set('Other', {});
  if (problem === 'changed-sequence') updates.get('RowNumber')[0] = 99n;
  if (problem === 'coerced-sequence') updates.get('RowNumber')[0] = 0;
  expect(() => rewriteModelTableRows(f.input, f.path, updates)).toThrow(/projection|row count|sequence/);
  expect(f.input).toEqual(copy);
});
it.each([-1, 0.5, NaN, Infinity, 16 * 1048576 + 1])('rejects invalid table work limit %s', maxValues => {
  const f = fixture();
  expect(() => rewriteModelTableRows(f.input, f.path, new Map(), { maxValues })).toThrow(/value limit/);
});
it('does not publish an earlier column when a later dictionary needs unsupported collation', () => {
  const f = fixture({ columnDictionaries: [null, { dictionaryValues: ['a', 'b', 'c'] }] }), copy = f.input.slice();
  expect(() => rewriteModelTableRows(f.input, f.path, new Map([['Amount', [99n, null, 6n, 5n, 7n]], ['Other', ['new', null, 'b', 'a', 'c']]]))).toThrow(/dictionary member rebuild/);
  expect(f.input).toEqual(copy);
});

const stringKeys = entries => ({ stringSortKeys: new Map([['Amount', new Map(entries.map(([value, bytes]) => [value, Uint8Array.from(bytes)]))]]) });
it.each([0, 1])('rebuilds string members using explicit binary keys, materialization %s', materialization => {
  const { input, path } = fixture({ dictionaryValues: ['z', 'a', 'é'], materialization }), copy = input.slice();
  const options = stringKeys([['z', [0]], ['a', [128]], ['é', [255]], ['Z', [0]], ['new', [0, 0]], ['NEW', [0, 0]]]);
  const values = ['NEW', 'Z', 'new', 'é', null];
  const { archive, table } = open(rewriteModelDictionaryColumns(input, path, new Map([['Amount', values]]), options), path);
  expect(readModelColumnValues(archive, table, 'Amount')).toEqual(['NEW', 'z', 'NEW', 'é', null]);
  const dictionary = readModelDictionary(archive, table, 'Amount');
  expect(dictionary.values).toEqual(['z', 'é', 'NEW']);
  const hierarchy = readModelIntrinsicHierarchy(archive, table, 'Amount');
  expect([...hierarchy.positionToId.slice(0, hierarchy.distinctDataIds)]).toEqual([2, 8, 10, 9]);
  if (materialization === 0) {
    expect(hierarchy.idToPosition[1]).toBe(4);
    for (const [position, id] of [2, 8, 10, 9].entries()) expect(hierarchy.idToPosition[id]).toBe(position);
  } else expect([...readModelHierarchyHash(archive, table, 'Amount')]).toEqual(expect.arrayContaining([[2, 0], [8, 1], [10, 2], [9, 3]]));
  expect(input).toEqual(copy);
});
it.each([0, 1])('grows, shrinks and changes NULL membership in keyed string dictionaries %s', materialization => {
  const { input, path } = fixture({ dictionaryValues: ['a', 'b', 'c'], materialization });
  const options = stringKeys([['a', []], ['b', [0]], ['c', [1]], ['d', [128]], ['e', [255]]]);
  let output = input;
  for (const values of [['a', 'b', 'c', 'd', 'e'], ['e', null, 'a', 'e', 'a'], Array(5).fill(null), Array(5).fill('b')]) {
    output = rewriteModelDictionaryColumns(output, path, new Map([['Amount', values]]), options);
    const { archive, table } = open(output, path);
    expect(readModelColumnValues(archive, table, 'Amount')).toEqual(values);
    const hierarchy = readModelIntrinsicHierarchy(archive, table, 'Amount');
    expect(hierarchy.distinctDataIds).toBe(new Set(values).size);
  }
});
it.each([
  [['a', [1]], ['b', [0]], ['c', [2]]],
  [['a', [0]], ['b', [0]], ['c', [2]]],
  [['a', [0]], ['b', [1]]],
])('rejects contradictory or incomplete old string keys %j', (...entries) => {
  const { input, path } = fixture({ dictionaryValues: ['a', 'b', 'c'] });
  expect(() => rewriteModelDictionaryColumns(input, path, new Map([['Amount', ['a', null, 'b', 'a', 'c']]]), stringKeys(entries))).toThrow(/collation/);
});
it('rejects missing new keys and nonbinary keys without mutating the archive', () => {
  const { input, path } = fixture({ dictionaryValues: ['a', 'b', 'c'] }), copy = input.slice();
  const options = stringKeys([['a', [0]], ['b', [1]], ['c', [2]]]);
  const updates = new Map([['Amount', ['d', null, 'b', 'a', 'c']]]);
  expect(() => rewriteModelDictionaryColumns(input, path, updates, options)).toThrow(/collation key/);
  options.stringSortKeys.get('Amount').set('d', [3]);
  expect(() => rewriteModelDictionaryColumns(input, path, updates, options)).toThrow(/collation key/);
  expect(input).toEqual(copy);
});
it('rejects collation keys for unknown columns and value-encoded columns', () => {
  const { input, path } = fixture(), updates = new Map([['Amount', [5n, null, 6n, 5n, 7n]]]);
  expect(() => rewriteModelTableRows(input, path, updates, { stringSortKeys: new Map([['Absent', new Map()]]) })).toThrow(/column keys/);
  expect(() => rewriteModelValueColumns(input, path, updates)).not.toThrow();
  expect(() => rewriteModelTableRows(input, path, new Map([...updates, ['Other', updates.get('Amount')]]), stringKeys([]))).toThrow(/string dictionary/);
});
it('applies a shared byte budget to distinct string keys across columns', () => {
  const { input, path } = fixture({ ids: [8, 8, 8, 8, 8], dictionaryValues: ['a'] });
  const bytes = new Uint8Array(9 * 1048576), keys = new Map([['a', bytes]]), values = Array(5).fill('a');
  expect(() => rewriteModelDictionaryColumns(input, path, new Map([['Amount', values]]), { stringSortKeys: new Map([['Amount', keys]]) })).not.toThrow();
  expect(() => rewriteModelDictionaryColumns(input, path, new Map([['Amount', values], ['Other', values]]), { stringSortKeys: new Map([['Amount', keys], ['Other', keys]]) })).toThrow(/key limit/);
});
it('rewrites complete mixed string/numeric projections with new canonical members', () => {
  const { input, path } = fixture({ columnDictionaries: [{ dictionaryValues: ['a', 'b', 'c'] }, {}] });
  const updates = new Map([['Amount', ['D', null, 'd', 'a', 'c']], ['Other', [100n, null, -4n, 3n, 10n]]]);
  const options = stringKeys([['a', [0]], ['b', [1]], ['c', [2]], ['d', [3]], ['D', [3]]]);
  const { archive, table } = open(rewriteModelTableRows(input, path, updates, options), path);
  expect(readModelColumnValues(archive, table, 'Amount')).toEqual(['D', null, 'D', 'a', 'c']);
  expect(readModelColumnValues(archive, table, 'Other')).toEqual(updates.get('Other'));
});
it('checks uniqueness after collation-equivalent spellings collapse', () => {
  const { input, path } = fixture({ ids: [8, 9, 10], dictionaryValues: ['a', 'b', 'c'] }), { table } = open(input, path);
  const xml = new TextDecoder().decode(table.read()).replaceAll('<ColumnFlags>8', '<ColumnFlags>10');
  const constrained = replaceDataModelArchiveFiles(input, new Map([[path, text(xml)]]));
  expect(() => rewriteModelDictionaryColumns(constrained, path, new Map([['Amount', ['d', 'D', 'a']]]), stringKeys([['a', [0]], ['b', [1]], ['c', [2]], ['d', [3]], ['D', [3]]]))).toThrow(/requires unique/);
});
it('fails atomically when later string keys conflict after an earlier column rebuild', () => {
  const { input, path } = fixture({ dictionaryValues: ['a', 'b', 'c'] }), copy = input.slice();
  const options = stringKeys([['a', [0]], ['b', [1]], ['c', [2]], ['d', [3]]]);
  options.stringSortKeys.set('Other', new Map([['a', Uint8Array.of(1)], ['b', Uint8Array.of(0)], ['c', Uint8Array.of(2)]]));
  expect(() => rewriteModelDictionaryColumns(input, path, new Map([['Amount', ['d', null, 'b', 'a', 'c']], ['Other', ['a', null, 'b', 'a', 'c']]]), options)).toThrow(/collation order/);
  expect(input).toEqual(copy);
});

it('rejects conflicting file writes across complete table updates', () => {
  const f = fixture(), archive = readDataModelArchive(f.input), main = archive.files.find(file => file.path === f.path);
  const second = 'scope/second.tbl.xml', input = modelArchive([...archive.files.map(file => ({ path: file.path, xml: file.read() })), { path: second, xml: main.read() }]);
  const columns = new Map([['Amount', [5n, null, 6n, 5n, 7n]], ['Other', [5n, null, 6n, 5n, 7n]]]), before = input.slice();
  expect(() => rewriteModelTables(input, new Map([[f.path, columns], [second, columns]]))).toThrow(/shared table storage dependency/);
  expect(input).toEqual(before);
});
it.each([false, {}, null])('rejects invalid per-table collation maps %j', columns => {
  const f = fixture(), values = new Map([['Amount', [5n, null, 6n, 5n, 7n]], ['Other', [5n, null, 6n, 5n, 7n]]]);
  expect(() => rewriteModelTables(f.input, new Map([[f.path, values]]), { stringSortKeys: new Map([[f.path, columns]]) })).toThrow(/collation table keys/);
});
