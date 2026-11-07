import { it, expect } from 'vitest';
import { readDataModelArchive } from '../src/core/data-model-archive.js';
import { readDataModelMetadata } from '../src/core/data-model-metadata.js';
import { resolveModelTableStorage } from '../src/core/data-model-table.js';
import { modelArchive, modelLoad } from './helpers/data-model-fixture.js';
const ns='http://schemas.microsoft.com/analysisservices/imbi';
const storage=(settings=4353,namespace=ns)=>`<XMObject xmlns="${namespace}" class="XMSimpleTable" name="A different caption"><Properties><Settings>${settings}</Settings></Properties></XMObject>`;
function fixture({folder='opaque/data',slash='/',inventory='physical.tbl.xml;hierarchy.tbl.xml;column.idf',settings=4353,namespace=ns,utf16=false}={}) {
  const group={id:'Orders',name:'Unrelated caption',class:100006,persistPath:folder},other={...group,persistPath:'elsewhere'};
  const records=[
    {path:'metadata/definition.dim.xml',group,xml:modelLoad('Dimension',`<ID>Orders</ID><Name>Caption</Name><DataFileList>${inventory}</DataFileList>`)},
    {path:folder+(folder.endsWith(slash)?'':slash)+'physical.tbl.xml',group,xml:storage(settings,namespace),utf16},
    {path:folder+(folder.endsWith(slash)?'':slash)+'hierarchy.tbl.xml',group,xml:storage(4)},
    {path:folder+(folder.endsWith(slash)?'':slash)+'column.idf',group,xml:'opaque'},
    {path:'elsewhere/physical.tbl.xml',group:other,xml:storage()},
  ];
  const bytes=modelArchive(records);return {bytes,archive:readDataModelArchive(bytes),table:readDataModelMetadata(bytes).tables[0]};
}
it.each([{},{folder:'C:\\database\\persisted',slash:'\\',utf16:true},{folder:'opaque/data/'}])('resolves inventory ownership and table kind using persisted object groups %j',options=>{
  const {archive,table}=fixture(options),file=resolveModelTableStorage(archive,table);
  expect(file).toBe(archive.files[1]);expect(file.group).toBe(archive.files[0].group);
  expect(file.group).not.toBe(archive.files[4].group);
});
it.each(['missing.tbl.xml','physical.tbl.xml;physical.tbl.xml','../physical.tbl.xml','physical.tbl.xml;missing.idf','hierarchy.tbl.xml',''])('rejects unresolved or invalid inventories %s',inventory=>{
  const {archive,table}=fixture({inventory});expect(()=>resolveModelTableStorage(archive,table)).toThrow(/inventory|ownership|main table/);
});
it('rejects same-path files owned by a different object group and contradictory identities',()=>{
  const {archive,table}=fixture();archive.files[1].group=archive.files[4].group;
  expect(()=>resolveModelTableStorage(archive,table)).toThrow(/ownership/);
  archive.files[0].group.class=100016;expect(()=>resolveModelTableStorage(archive,table)).toThrow(/object group/);
  const next=fixture();expect(()=>resolveModelTableStorage(next.archive,{...next.table,id:'Other'})).toThrow(/object group/);
});
it('rejects ambiguous main tables and duplicate paths rather than selecting the first',()=>{
  const {archive,table}=fixture(),extra={...archive.files[1],path:'opaque/data/second.tbl.xml'};
  archive.files.push(extra);expect(()=>resolveModelTableStorage(archive,{...table,dataFiles:[...table.dataFiles,'second.tbl.xml']})).toThrow(/ambiguous main/);
  archive.files.push({...extra});expect(()=>resolveModelTableStorage(archive,table)).toThrow(/duplicate archive path/);
});
it.each([{settings:'nonsense'},{settings:4368},{namespace:'urn:foreign'}])('rejects malformed table metadata %j',options=>{
  const {archive,table}=fixture(options);expect(()=>resolveModelTableStorage(archive,table)).toThrow(/Settings|table root/);
});
it('checks declared sizes before reading and verifies the materialized size',()=>{
  const {archive,table}=fixture();archive.files[1].size=16*1048576+1;archive.files[1].read=()=>{throw new Error('must not read')};
  expect(()=>resolveModelTableStorage(archive,table)).toThrow(/size limit/);
  const next=fixture();next.archive.files[1].size++;expect(()=>resolveModelTableStorage(next.archive,next.table)).toThrow(/size mismatch/);
});
