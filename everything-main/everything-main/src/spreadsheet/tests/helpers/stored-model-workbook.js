import { Workbook } from '../../src/core/workbook.js';
import { encodeDataModelBytes } from '../../src/core/data-model.js';
import { encodeModelColumnIds } from '../../src/core/data-model-columns.js';
import { encodeModelStringDictionary } from '../../src/core/data-model-dictionaries.js';
import { modelArchive, modelLoad, escapeXml } from './data-model-fixture.js';
const props = values => `<Properties>${Object.entries(values).map(([k,v]) => `<${k}>${escapeXml(v)}</${k}>`).join('')}</Properties>`;
const obj = (kind, body, name = '') => `<XMObject class="${escapeXml(kind)}" name="${name}">${body}</XMObject>`;
const member = (name, body) => `<Member><Name>${name}</Name>${body}</Member>`;
const coll = (name, body) => `<Collection><Name>${name}</Name>${body}</Collection>`;
export function fixture({ expression = 'SUM(Orders[Net])', dataType = 'BigInt', base = 9007199254740990n, map = true, badCount = false, empty = false, real = false, groupIds = [3, 4, 3], secondary = 'DIVIDE([Total],2)' } = {}) {
  const group = { id: 'Orders', name: 'Unrelated caption', class: 100006, persistPath: 'opaque' };
  const ids = empty ? [] : [3, 2, 4], count = ids.length, fields = [['Net', ids, false], ['Group', empty ? [] : groupIds, true]], files = [];
  const columns = fields.map(([name, values, text]) => {
    files.push({ path: `opaque/${name}.idf`, group, xml: encodeModelColumnIds(Int32Array.from(values), [{ type: 'packed', records: count, min: 2, bits: 2 }]).bytes });
    const segment = obj('XMColumnSegment', props({ Records: badCount && text ? count - 1 : count }) + `<Members>${member('CompressionInfo', obj('XMRENoSplitCompressionInfo<2>', props({ Min: 2 })))}</Members>`);
    const dictionary = text ? obj('XMHashDataDictionary<XM_String>', props({ LastId: 4, Nullable: false, DictionaryFlags: 0 }), 'groups.dictionary')
      : obj(real ? 'XMValueDataDictionary<XM_Real>' : 'XMValueDataDictionary<XM_Long>', props({ BaseId: base, Magnitude: real ? 2 : 1 }));
    return obj('XMRawColumn', `<Members>${member('ColumnStats', obj('XMColumnStats', props({ MinDataID: 3, MaxDataID: 4, RowCount: count, HasNulls: !text && !empty, XMType: text ? 2 : real ? 1 : 0, DBType: text ? 130 : 20 })))}</Members><Collections>${coll('Segments', segment)}</Collections><DataObjects><DataObject>${dictionary}</DataObject><DataObject>${obj('XMRawColumnPartitionDataObject', props({ Partition: 7, SegmentCount: 1 }), `${name}.idf`)}</DataObject></DataObjects>`, name);
  }).join('');
  files.push({ path: 'opaque/groups.dictionary', group, xml: encodeModelStringDictionary(['A ', 'B']) });
  const table = obj('XMSimpleTable', props({ Settings: 1 }) + (map ? `<Members>${member('SegmentMap', obj('XMSegment1Map', props({ Records: count })))}</Members>` : '') + `<Collections>${coll('Partitions', obj('XMPartition', props({ Partition: 7 })))}${coll('Columns', columns)}</Collections>`).replace('<XMObject', '<XMObject xmlns="http://schemas.microsoft.com/analysisservices/imbi"');
  files.push({ path: 'opaque/main.tbl.xml', group, xml: table });
  files.push({ path: 'definitions/table.dim.xml', group, xml: modelLoad('Dimension', `<ID>Orders</ID><Name>Order caption</Name><DataFileList>main.tbl.xml;Net.idf;Group.idf;groups.dictionary</DataFileList><Attributes>${[['Net', dataType], ['Group', 'WChar']].map(([id, type]) => `<Attribute><ID>${id}</ID><Name>${id}</Name><KeyColumns><KeyColumn><DataType>${type}</DataType><NullProcessing>ZeroOrBlank</NullProcessing><Trimming>Right</Trimming></KeyColumn></KeyColumns></Attribute>`).join('')}</Attributes>`) });
  files.push({ path: 'script.scr.xml', xml: modelLoad('MdxScript', `<Commands><Command><Text>${escapeXml(`CREATE MEASURE [Model].Orders[Total] = ${expression}; CREATE MEASURE [Model].Orders[Half] = ${secondary};`)}</Text></Command></Commands>`) });
  return new Workbook({ sheets: [{ name: 'Unrelated', cells: { '0,0': { v: 999 } } }], dataModel: { version: 1, modelXml: '', connectionsXml: '', archive: encodeDataModelBytes(modelArchive(files)) } });
}
