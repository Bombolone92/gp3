import { encodeModelColumnIds, encodeModelMappingIds } from '../../src/core/data-model-columns.js';
import { encodeModelHierarchyHash } from '../../src/core/data-model-hash-index.js';
import { encodeModelStringDictionary, encodeModelNumericDictionary } from '../../src/core/data-model-dictionaries.js';
const ns = 'http://schemas.microsoft.com/analysisservices/imbi';
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const props = values => '<Properties>' + Object.entries(values).map(([k,v]) => `<${k}>${escape(v)}</${k}>`).join('') + '</Properties>';
const obj = (type, content, name = '') => `<XMObject class="${escape(type)}" name="${escape(name)}">${content}</XMObject>`;
const member = (name, content) => `<Member><Name>${name}</Name>${content}</Member>`;
const coll = (name, content) => `<Collection><Name>${name}</Name>${content}</Collection>`;
const document = s => s.replace('<XMObject', `<XMObject xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" custom="retain"`);
const utf16 = s => new Uint8Array(Buffer.from(s, 'utf16le'));
const text = s => new TextEncoder().encode(s);
function stats(ids, column = false) {
  const nonnull = ids.filter(id => id !== 2);
  return obj(column ? 'XMColumnStats' : 'XMColumnSegmentStats', props({ DistinctStates: new Set(ids).size, MinDataID: Math.min(...nonnull, 2147483647), MaxDataID: Math.max(...nonnull, 2), OriginalMinSegmentDataID: Math.min(...ids, 2), RLESortOrder: -1, RowCount: ids.length, HasNulls: ids.includes(2), RLERuns: 0, OthersRLERuns: 1, ...(column ? { XMType: 0, DBType: 20 } : {}) }));
}
const packedInfo = s => obj(`XMRENoSplitCompressionInfo<${s.bits}>`, props({ Min: s.min }));
function segment(s, ids) {
  if (s.type === 'packed') return obj('XMColumnSegment', props({ Records: s.records, Mask: 0 }) + `<Members>${member('CompressionInfo', packedInfo(s))}${member('ColumnSegmentStats', stats([]))}</Members>`);
  const sub = obj('XMColumnSegment', props({ Records: s.packedRecords, Mask: 0 }) + `<Members>${member('CompressionInfo', packedInfo(s))}${member('ColumnSegmentStats', stats([]))}</Members>`);
  const info = obj(`XMHybridRLECompressionInfo<class XMRENoSplitCompressionInfo<${s.bits}>>`, `<Members>${member('SubCompression', packedInfo(s))}${member('RLECompression', obj('XMRLECompressionInfo', props({ BookmarkBits: 6, StorageAllocSize: s.allocated, StorageUsedSize: s.used, SegmentNeedsResizing: false })))}</Members>`);
  return obj('XMColumnSegment', props({ Records: s.records, Mask: 0 }) + `<Members>${member('SubSegment', sub)}${member('CompressionInfo', info)}${member('ColumnSegmentStats', stats(ids))}</Members>`);
}
function container(files) {
  const p = (k, v) => `<${k}>${escape(v)}</${k}>`, PAGE = 4096;
  const log = utf16('\ufeff<BackupLog><FileGroups><FileGroup><ID>group</ID><Name>Group</Name><Class>1</Class><PersistLocationPath>scope</PersistLocationPath><FileList>' + files.map((f,i) => '<BackupFile>'+p('Path',f.path)+p('StoragePath','FILE'+i)+p('Size',f.bytes.length)+'</BackupFile>').join('') + '</FileList></FileGroup></FileGroups></BackupLog>');
  const stored = [...files.map((f,i) => ({name:'FILE'+i,bytes:f.bytes})), {name:'LOG',bytes:log}]; let offset=PAGE;
  stored.forEach(f=>{f.offset=offset;offset+=f.bytes.length;});const directoryOffset=Math.ceil(offset/PAGE)*PAGE;
  const directory=utf16('<VirtualDirectory>'+stored.map(f=>'<BackupFile>'+p('Path',f.name)+p('Size',f.bytes.length)+p('m_cbOffsetHeader',f.offset)+p('Delete',false)+'</BackupFile>').join('')+'</VirtualDirectory>');
  const header=utf16('\ufeffSTREAM_STORAGE_SIGNATURE_)!@#$%^&*('+ '<BackupLog>'+Object.entries({BackupRestoreSyncVersion:140,Fault:false,ErrorCode:false,EncryptionFlag:false,ApplyCompression:false,m_cbOffsetHeader:directoryOffset,DataSize:directory.length,Files:stored.length,m_cbOffsetData:PAGE}).map(([k,v])=>p(k,v)).join('')+'</BackupLog>');
  const bytes=new Uint8Array(Math.ceil((directoryOffset+directory.length)/PAGE)*PAGE);bytes.set(header);stored.forEach(f=>bytes.set(f.bytes,f.offset));bytes.set(directory,directoryOffset);return bytes;
}
export function fixture({ ids = [8, 2, 9, 8, 10], magnitude = 1, counts = [ids.length], unicode = false, partitionCounts = null, flatMap = false, dictionaryValues = null, dictionaryType = 'string', operatingOn32 = false, materialization = 1, tailSlots = 2, tailValue = 0, columnDictionaries = null, rowNumbers = false } = {}) {
  const files=[], columns=[], plans=partitionCounts||[counts], partitionIds=plans.map((_,i)=>41-i*7);
  const partitionMap=records=>records.length===1?obj('XMSegment1Map',props({Records:records[0]})):obj('XMSegmentEqualMapEx<XMSegmentEqualMap_ComplexInstantiation>',props({Segments:records.length,Records:records.reduce((n,v)=>n+v,0),RecordsPerSegment:records[0]}));
  const defaults = { dictionaryValues, dictionaryType, materialization, operatingOn32 };
  for(let c=0;c<2;c++) {
    const { dictionaryValues, dictionaryType, materialization, operatingOn32 } = { ...defaults, ...columnDictionaries?.[c] };
    const name=c?'Other':'Amount', mapping='Store'+c, values=Int32Array.from(ids), encoded={segments:[]}, columnFiles=[];let position=0;
    for(const [i,plan]of plans.entries()) {
      const records=plan.reduce((n,v)=>n+v,0),part=encodeModelColumnIds(values.subarray(position,position+records),plan.map(records=>({type:'hybrid',records,min:0,bits:32})));position+=records;
      const file=`c${c}-p${i}.idf`;files.push({path:`scope/${file}`,bytes:part.bytes});columnFiles.push({name:file,partition:partitionIds[i],segments:plan.length});encoded.segments.push(...part.segments);
    }
    const ordered=[...new Set(ids)].sort((a,b)=>a===2?-1:b===2?1:(a-b)*Math.sign(magnitude)), forward=Int32Array.from([...ordered,...Array(materialization===0?Math.max(3,...ids)+1-ordered.length:tailSlots).fill(tailValue)]);
    const mapped=encodeModelMappingIds(forward,[{type:'packed',bits:32,min:0,records:ordered.length},{type:'packed',bits:32,min:0,records:forward.length-ordered.length}]);
    files.push({path:`scope/p${c}.idf`,bytes:mapped.bytes});
    if(materialization===1)files.push({path:`scope/h${c}.hidx`,bytes:encodeModelHierarchyHash(new Map(ordered.map((id,i)=>[id,i])))});
    else {const inverse=new Int32Array(forward.length);inverse[1]=ordered.length;ordered.forEach((id,i)=>{inverse[id]=i;});files.push({path:`scope/i${c}.idf`,bytes:encodeModelMappingIds(inverse,mapped.segments).bytes});}
    if(dictionaryValues)files.push({path:`scope/d${c}.dictionary`,bytes:dictionaryType==='string'?encodeModelStringDictionary(dictionaryValues,{flags:0}):encodeModelNumericDictionary(dictionaryValues,{type:dictionaryType,operatingOn32,hashHeader:{algorithm:-1,entrySize:8,binSize:64,localCount:6}})});
    const data=(name,count,partition=41)=>`<DataObject>${obj('XMRawColumnPartitionDataObject',props({Partition:partition,SegmentCount:count}),name)}</DataObject>`;
    const mappingColumn=obj('XMRawColumn',`<Members>${member('ColumnStats',stats([],true))}</Members><Collections>${coll('Segments',mapped.segments.map(s=>segment(s,[])).join(''))}</Collections><DataObjects>${data('p'+c+'.idf',2)}</DataObjects>`,'POS_TO_ID');
    const map=obj('XMSegmentEqualMapEx<XMSegmentEqualMap_ComplexInstantiation>',props({Segments:2,Records:forward.length,RecordsPerSegment:ordered.length}));
    const xml=document(obj('XMSimpleTable',props({Settings:4})+`<Members>${member('SegmentMap',map)}</Members><Collections>${coll('Partitions','')}${coll('Columns',mappingColumn+(materialization===0?mappingColumn.replace('POS_TO_ID','ID_TO_POS').replace('p'+c+'.idf','i'+c+'.idf'):''))}</Collections>`,mapping));
    files.push({path:`scope/hierarchy${c}.tbl.xml`,bytes:text(xml)});
    const hierarchy=obj('XMHierarchy',props({TableStore:mapping,TypeMaterialization:materialization,ColumnPosition2DataID:0,ColumnDataID2Position:materialization===0?1:-1,DistinctDataIDs:ordered.length,SortOrder:0,IsProcessed:true})+`<DataObjects>${materialization===1?'<DataObject>'+obj('XMHierarchyDataID2PositionHashIndex','','h'+c+'.hidx')+'</DataObject>':''}</DataObjects>`);
    let at=0;const segments=encoded.segments.map(s=>{const result=segment(s,ids.slice(at,at+s.records));at+=s.records;return result;}).join('');
    columns.push(obj('XMRawColumn',props({ColumnFlags:8,Settings:1})+`<Members>${member('IntrinsicHierarchy',hierarchy)}${member('ColumnStats',stats(ids,true).replace('<XMType>0','<XMType>'+(dictionaryValues?{string:2,long:0,real:1}[dictionaryType]:0)))}</Members><Collections>${coll('Segments',segments)}</Collections><DataObjects><DataObject>${dictionaryValues?obj('XMHashDataDictionary<XM_'+{string:'String',long:'Long',real:'Real'}[dictionaryType]+'>',props({LastId:7+dictionaryValues.length,Nullable:ids.includes(2),...(dictionaryType==='string'?{DictionaryFlags:0}:dictionaryType==='long'?{OperatingOn32:operatingOn32}:{})}),'d'+c+'.dictionary'):obj('XMValueDataDictionary<XM_Long>',props({BaseId:-3,Magnitude:magnitude}))}</DataObject>${columnFiles.reverse().map(f=>data(f.name,f.segments,f.partition)).join('')}</DataObjects>`,name));
  }
  if (rowNumbers) {
    if (plans.length !== 1 || plans[0].length !== 1) throw Error('Sequence fixture uses one partition/segment');
    const sequence = Int32Array.from(ids, (_, i) => i + 3), encoded = encodeModelColumnIds(sequence, [{ type: 'sequence', bits: null, min: 3, records: ids.length }]);
    files.push({ path: 'scope/sequence.idf', bytes: encoded.bytes });
    const segments = segment(encoded.segments[0], [...sequence]).replaceAll('XMRENoSplitCompressionInfo&lt;null>', 'XM123CompressionInfo');
    const hierarchy = obj('XMHierarchy', props({ TableStore: '', TypeMaterialization: 3, ColumnPosition2DataID: -1, ColumnDataID2Position: -1, DistinctDataIDs: ids.length, SortOrder: 0, IsProcessed: true }));
    const source = obj('XMRawColumnPartitionDataObject', props({ Partition: partitionIds[0], SegmentCount: 1 }), 'sequence.idf');
    columns.push(obj('XMRawColumn', props({ ColumnFlags: 31, Settings: 1 }) + `<Members>${member('IntrinsicHierarchy', hierarchy)}${member('ColumnStats', stats([...sequence], true))}</Members><Collections>${coll('Segments', segments)}</Collections><DataObjects><DataObject>${obj('XMValueDataDictionary<XM_Long>', props({ BaseId: -3, Magnitude: 1 }))}</DataObject><DataObject>${source}</DataObject></DataObjects>`, 'RowNumber'));
  }
  const xml=document(obj('XMSimpleTable',`<Members>${member('SegmentMap',flatMap ? partitionMap(plans[0]) : obj('XMMultiPartSegmentMap',props({FirstPartitionRecordCount:0,FirstPartitionSegmentCount:0})+`<Collections>${coll('Partitions',plans.map(partitionMap).join(''))}</Collections>`))}</Members><Collections>${coll('Partitions',partitionIds.map(Partition=>obj('XMPartition',props({Partition}))).join(''))}${coll('Columns',columns.join(''))}</Collections>`,'Orders'));
  const path='scope/main.tbl.xml';files.push({path,bytes:unicode?utf16('\ufeff'+xml):text(xml)});return {input:container(files),path};
}
