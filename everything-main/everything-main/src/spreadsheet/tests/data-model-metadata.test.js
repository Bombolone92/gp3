import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { decodeModelXml, modelMeasureDeclarations, parseModelXml, readDataModelMetadata } from '../src/core/data-model-metadata.js';
import { modelArchive, modelLoad, simpleModel } from './helpers/data-model-fixture.js';

const comparisonVersionNs = 'http://schemas.microsoft.com/analysisservices/2012/engine/400';
const comparisonSchema = (database, dimension = '', key = '') => readDataModelMetadata(modelArchive([
  { path: 'db.db.xml', xml: modelLoad('Database', `<ID>db</ID>${database}`, '') },
  { path: 'table.dim.xml', xml: modelLoad('Dimension', `<ID>T</ID>${dimension}<Attributes><Attribute><ID>C</ID><KeyColumns><KeyColumn><DataType>WChar</DataType>${key}</KeyColumn></KeyColumns></Attribute></Attributes>`) },
]));
it('retains comparison declarations at their own database, dimension and key scopes', () => {
  const schema = comparisonSchema(`<Language>1033</Language><Collation>Latin1_General_AS</Collation><v:DefaultCollationVersion xmlns:v="${comparisonVersionNs}">100</v:DefaultCollationVersion>`,
    '<Language>1055</Language><Collation>Turkish_AS</Collation>', '<Collation>Turkish_CS_AS</Collation>');
  expect(schema.objects[0].comparison).toEqual({ locale: 1033, collation: 'Latin1_General_AS', version: '100' });
  expect(schema.objects[1].comparison).toEqual({ locale: 1055, collation: 'Turkish_AS' });
  expect(schema.tables[0].comparison).toEqual(schema.objects[1].comparison);
  expect(schema.tables[0].columns[0].keys[0].comparison).toEqual({ collation: 'Turkish_CS_AS' });
});
it('keeps absent and empty comparison settings distinct without guessing host defaults', () => {
  const absent = comparisonSchema(''), empty = comparisonSchema('<Language/><Collation/>', '<Language>0</Language><Collation/>', '<Collation/>');
  expect(absent.objects[0]).not.toHaveProperty('comparison');
  expect(absent.tables[0]).not.toHaveProperty('comparison');
  expect(absent.tables[0].columns[0].keys[0]).not.toHaveProperty('comparison');
  expect(empty.objects[0].comparison).toEqual({ locale: null, collation: '' });
  expect(empty.tables[0].comparison).toEqual({ locale: 0, collation: '' });
  expect(empty.tables[0].columns[0].keys[0].comparison).toEqual({ collation: '' });
});
it.each(['Earliest', '80', '90', '100'])('reads the declared collation version %s', version => {
  expect(comparisonSchema(`<v:DefaultCollationVersion xmlns:v="${comparisonVersionNs}">${version}</v:DefaultCollationVersion>`).objects[0].comparison).toEqual({ version });
});
it('ignores foreign namespaces and nested comparison declarations', () => {
  const schema = comparisonSchema('<Other><Language>1055</Language><Collation>nested</Collation></Other><x:Language xmlns:x="urn:foreign">1041</x:Language><DefaultCollationVersion>100</DefaultCollationVersion>',
    '<x:Collation xmlns:x="urn:foreign">wrong</x:Collation>');
  expect(schema.objects[0]).not.toHaveProperty('comparison');
  expect(schema.tables[0]).not.toHaveProperty('comparison');
});
it.each(['-1', '1.5', '0x409', '1e3', '4294967296', 'NaN'])('rejects invalid comparison locale %s', language => {
  expect(() => comparisonSchema(`<Language>${language}</Language>`)).toThrow(/comparison locale/);
});
it.each(['', '110', 'earliest'])('rejects an invalid declared comparison version %s', version => {
  expect(() => comparisonSchema(`<v:DefaultCollationVersion xmlns:v="${comparisonVersionNs}">${version}</v:DefaultCollationVersion>`)).toThrow(/comparison version/);
});
it.each(['<Language>1033</Language><Language>1055</Language>', '<Collation>A</Collation><Collation>B</Collation>', '<Collation><Value>A</Value></Collation>',
  `<v:DefaultCollationVersion xmlns:v="${comparisonVersionNs}">80</v:DefaultCollationVersion><w:DefaultCollationVersion xmlns:w="${comparisonVersionNs}">100</w:DefaultCollationVersion>`])('rejects malformed or ambiguous comparison declarations %s', content => {
  expect(() => comparisonSchema(content)).toThrow(/Data Model comparison/);
});
it('validates key and dimension comparison properties as well as database properties', () => {
  expect(() => comparisonSchema('', '<Language>bad</Language>')).toThrow(/comparison locale/);
  expect(() => comparisonSchema('', '', '<Collation>A</Collation><Collation>B</Collation>')).toThrow(/comparison Collation/);
});

it('reads scoped table/column identity, types and the actual DAX expression', () => {
  const schema = readDataModelMetadata(simpleModel());
  expect(schema.objects.map(o => o.type)).toEqual(['Database', 'Dimension', 'MdxScript']);
  expect(schema.tables[0]).toMatchObject({ id: 'Orders', database: 'db', columns: [{ id: 'Net', keys: [{ dataType: 'Currency', nullProcessing: 'Preserve' }] }] });
  expect(schema.scripts[0]).toMatchObject({ cube: 'Model', database: 'db', commands: [{ measures: [{ table: 'Orders', name: 'Margin', expression: 'SUM(Orders[Net])' }] }] });
});
it('uses namespaces and direct children, retaining unsupported object properties', () => {
  const xml = modelLoad('Dimension', '<ID>商品</ID><Name>Visible caption</Name><Attributes><Attribute><ID>nested</ID><Name>Nested</Name><AttributeHierarchyVisible>false</AttributeHierarchyVisible></Attribute></Attributes><foreign:ID xmlns:foreign="urn:foreign">wrong</foreign:ID><CustomProperty><Value>keep</Value></CustomProperty>', '<DatabaseID>別のモデル</DatabaseID>', 'engine');
  const schema = readDataModelMetadata(modelArchive([{ path: 'anything.2.dim.xml', xml: xml.replace('<engine:Load ', '<engine:Load xmlns:binding="urn:types" '), utf16: true }]));
  expect(schema.tables[0]).toMatchObject({ id: '商品', name: 'Visible caption', database: '別のモデル', columns: [{ id: 'nested', visible: false }] });
  expect(schema.objects[0].xml).toContain('CustomProperty');
  expect(parseModelXml(schema.objects[0].xml).lookupNamespaceURI('binding')).toBe('urn:types');
});
it('keeps non-measure commands and ignores misleading annotations', () => {
  const text = 'CALCULATE; CREATE MEMBER CURRENTCUBE.Measures.[Fallback] AS 1; CREATE MEASURE Orders[Misleading Count] = SUM(Orders[Net]);';
  const result = modelMeasureDeclarations(text);
  expect(result.other).toHaveLength(2);
  expect(result.measures).toEqual([{ table: 'Orders', name: 'Misleading Count', expression: 'SUM(Orders[Net])' }]);
});
it('handles escaped names, comments, multiple declarations and delimiters in DAX strings', () => {
  const source = `-- CREATE MEASURE Fake[Ignore]=0;
    create measure [Cube]]name].'O''Brien'[A]]B] = IF(TRUE(), "x;""y", SUM('O''Brien'[Net]));
    /* ; [fake] */ CREATE MEASURE 商品[利益] = 1 + 2 // trailing comment
    ;`;
  const result = modelMeasureDeclarations(source);
  expect(result.measures).toEqual([
    { cube: 'Cube]name', table: "O'Brien", name: 'A]B', expression: `IF(TRUE(), "x;""y", SUM('O''Brien'[Net]))` },
    { table: '商品', name: '利益', expression: '1 + 2 // trailing comment' },
  ]);
});
it.each(["CREATE MEASURE 'broken[X]=1", 'CREATE MEASURE A[X] =', 'CREATE MEASURE A X = 1', '/* never closed', 'CREATE MEASURE A[X] = SUM(A[N]'])('rejects malformed declaration %s', text => {
  expect(() => modelMeasureDeclarations(text)).toThrow();
});
it('accepts CDATA and quoted greater-than signs without confusing XML depth checks', () => {
  const xml = '<a>' + '<b x=">"/>'.repeat(200) + '<c><![CDATA["<!DOCTYPE example>"; <]]></c></a>';
  expect(parseModelXml(xml).lastChild.textContent).toBe('"<!DOCTYPE example>"; <');
});
it.each(['<a><b></a>', '<!DOCTYPE a [<!ENTITY x "expansion">]><a>&x;</a>', '<a>&unknown;</a>', '<a/>garbage', '<a>' + '<b>'.repeat(129) + '</b>'.repeat(129) + '</a>'])('rejects malformed or unsupported XML', xml => {
  expect(() => parseModelXml(xml)).toThrow();
});
it('does not misidentify unrelated namespaces or unsupported storage as a parsed model', () => {
  expect(() => readDataModelMetadata(modelArchive([{ path: 'wrong.0.dim.xml', xml: '<Load xmlns="urn:unrelated"/>' }]))).toThrow(/Unsupported/);
  expect(() => readDataModelMetadata(modelArchive([{ path: 'metadata.sqlitedb', xml: 'not an Analysis Services XML object' }]))).toThrow(/Unsupported/);
});

it.each(['<Source/>', '<Source xsi:type="a:b:c"/>', '<Source xsi:type="ColumnBinding"/><Source xsi:type="ColumnBinding"/>', '<Source xsi:type="ColumnBinding"><ColumnID>A</ColumnID><ColumnID>B</ColumnID></Source>'])('rejects malformed or ambiguous key source metadata %s', source => {
  const xml = modelLoad('Dimension', '<ID>Orders</ID><Attributes><Attribute><ID>Net</ID><KeyColumns><KeyColumn xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + source + '</KeyColumn></KeyColumns></Attribute></Attributes>');
  expect(() => readDataModelMetadata(modelArchive([{ path: 'orders.dim.xml', xml }]))).toThrow(/source binding/);
});

it('rejects contradictory duplicate null-processing declarations',()=>{
  const xml=modelLoad('Dimension','<ID>Orders</ID><Attributes><Attribute><ID>Net</ID><KeyColumns><KeyColumn><DataType>BigInt</DataType><NullProcessing>Preserve</NullProcessing><NullProcessing>Error</NullProcessing></KeyColumn></KeyColumns></Attribute></Attributes>');
  expect(()=>readDataModelMetadata(modelArchive([{path:'orders.dim.xml',xml}]))).toThrow(/Duplicate.*null processing/);
});

it('decodes XML BOMs consistently and rejects malformed code units', () => {
  const xml = '<Name>费用 🌍</Name>', be = Uint8Array.from(Buffer.from('\ufeff' + xml, 'utf16le'));
  for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
  expect(decodeModelXml(be)).toEqual({ xml, encoding: 'utf-16be' });
  expect(decodeModelXml(Uint8Array.from(Buffer.from('\ufeff' + xml, 'utf16le')))).toEqual({ xml, encoding: 'utf-16le' });
  for (const prefix of ['', '\ufeff']) expect(decodeModelXml(new TextEncoder().encode(prefix + xml))).toEqual({ xml, encoding: 'utf-8' });
  for (const bytes of [[254, 255, 0], [255, 254, 0], [254, 255, 216, 0], [255, 254, 0, 216], [195, 40]]) {
    expect(() => decodeModelXml(Uint8Array.from(bytes))).toThrow();
  }
});

it('decodes bounded octet views across realms and respects their byte offsets', () => {
  const foreign = runInNewContext('new Uint8Array([0, 60, 120, 47, 62, 0]).subarray(1, 5)');
  expect(foreign instanceof Uint8Array).toBe(false);
  expect(decodeModelXml(foreign)).toEqual({ xml: '<x/>', encoding: 'utf-8' });
  const signed = new Int8Array(Buffer.from('\ufeff<x/>', 'utf16le'));
  expect(decodeModelXml(signed)).toEqual({ xml: '<x/>', encoding: 'utf-16le' });
  for (const value of [[60, 120, 47, 62], new Uint16Array([60]), new DataView(new ArrayBuffer(4))]) {
    expect(() => decodeModelXml(value)).toThrow();
  }
});
