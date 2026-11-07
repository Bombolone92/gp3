import { expect, it } from 'vitest';
import { readXlsxSlicers } from '../src/core/xlsx-slicers.js';

const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const Y = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const S = 'http://schemas.microsoft.com/office/2007/relationships';
const text = xml => ({ content: new TextEncoder().encode(xml) });
const rels = entries => `<Relationships xmlns="${P}">${entries.map(([Id, Type, Target]) => `<Relationship Id="${Id}" Type="${Type}" Target="${Target}"/>`).join('')}</Relationships>`;
function fixture() {
  return { Directory: { workbooks: ['/documents/book.xml'] }, files: Object.fromEntries(Object.entries({
    'documents/book.xml': `<w:workbook xmlns:w="${M}" xmlns:r="${R}" xmlns:a="${X}" xmlns:b="${Y}"><w:sheets><w:sheet name="Dashboard" r:id="view"/><w:sheet name="Source" r:id="data"/></w:sheets><w:extLst><w:ext><b:slicerCaches><a:slicerCache r:id="cache"/></b:slicerCaches></w:ext></w:extLst></w:workbook>`,
    'documents/_rels/book.xml.rels': rels([['view', `${R}/worksheet`, '../sheets/view.xml'], ['data', `${R}/worksheet`, '../sheets/data.xml'], ['cache', `${S}/slicerCache`, '../caches/./cache.xml']]),
    'sheets/view.xml': `<worksheet xmlns="${M}" xmlns:r="${R}" xmlns:a="${X}"><extLst><ext><a:slicerList><a:slicer r:id="s"/></a:slicerList></ext></extLst></worksheet>`,
    'sheets/data.xml': `<worksheet xmlns="${M}" xmlns:r="${R}"><tableParts><tablePart r:id="t"/></tableParts></worksheet>`,
    'sheets/_rels/view.xml.rels': rels([['s', `${S}/slicer`, '../views/controls.xml']]),
    'sheets/_rels/data.xml.rels': rels([['t', `${R}/table`, '/tables/orders.xml']]),
    'tables/orders.xml': `<table xmlns="${M}" id="17" name="Orders"><tableColumns><tableColumn id="42" name="Cost"/><tableColumn id="7" name="Region &amp; zone"/></tableColumns></table>`,
    'caches/cache.xml': `<slicerCacheDefinition xmlns="${X}" xmlns:w="${M}" xmlns:b="${Y}" name="Regions" sourceName="Display caption"><extLst><w:ext><b:tableSlicerCache tableId="17" column="7"/></w:ext></extLst></slicerCacheDefinition>`,
    'views/controls.xml': `<slicers xmlns="${X}"><slicer name="Locations" cache="Regions" caption="Territory" rowHeight="228600" style="SlicerStyleLight1"/></slicers>`,
  }).map(([path, xml]) => [path, text(xml)])) };
}
function change(book, path, before, after) { book.files[path] = text(new TextDecoder().decode(book.files[path].content).replace(before, after)); }

it('resolves table and column identities through relocated, namespace-qualified package references', () => {
  const book = fixture(), copy = structuredClone(book), result = readXlsxSlicers(book);
  expect(result.caches[0]).toMatchObject({ kind: 'table', name: 'Regions', sourceName: 'Display caption', tableId: 17, columnId: 7,
    sortOrder: 'ascending', customListSort: true, crossFilter: 'showItemsWithDataAtTop',
    table: { part: 'tables/orders.xml', sheet: 'Source', name: 'Orders', column: { id: 7, name: 'Region & zone', index: 1 } } });
  expect(result.views[0]).toMatchObject({ name: 'Locations', cache: 'Regions', owner: 'Dashboard', caption: 'Territory', style: 'SlicerStyleLight1', rowHeight: 228600,
    columnCount: 1, startItem: 0, showCaption: true, lockedPosition: false });
  expect(result.caches[0].xml).toContain('tableSlicerCache'); expect(result.views[0].xml).toContain('SlicerStyleLight1');
  expect(book).toEqual(copy);
});
it('retains multiple views sharing a cache, explicit settings and case-insensitive names', () => {
  const book = fixture();
  change(book, 'views/controls.xml', '</slicers>', '<slicer name="Second" cache="regions" rowHeight="300000" columnCount="4" showCaption="0" lockedPosition="1" startItem="9"/></slicers>');
  change(book, 'caches/cache.xml', 'column="7"', 'column="7" sortOrder="descending" customListSort="false" crossFilter="showItemsWithNoData"');
  const result = readXlsxSlicers(book);
  expect(result.views).toHaveLength(2); expect(result.views[1]).toMatchObject({ cache: 'Regions', columnCount: 4, showCaption: false, lockedPosition: true, startItem: 9 });
  expect(result.caches[0]).toMatchObject({ sortOrder: 'descending', customListSort: false, crossFilter: 'showItemsWithNoData' });
});
it('does not discover orphan parts or mistake a foreign namespace for a native cache list', () => {
  expect(readXlsxSlicers({})).toBeNull();
  const book = fixture(); change(book, 'documents/book.xml', `xmlns:b="${Y}"`, 'xmlns:b="urn:foreign"');
  expect(() => readXlsxSlicers(book)).toThrow(/missing slicer cache/);
  change(book, 'sheets/view.xml', '<a:slicerList><a:slicer r:id="s"/></a:slicerList>', '');
  expect(readXlsxSlicers(book)).toBeNull();
});
it.each([
  ['sheets/_rels/view.xml.rels', 'Target="../views/controls.xml"', 'Target="https://example.com/view.xml" TargetMode="External"'],
  ['documents/_rels/book.xml.rels', '../caches/./cache.xml', '../../outside.xml'],
  ['documents/_rels/book.xml.rels', `${S}/slicerCache`, `${R}/slicerCache`],
  ['documents/_rels/book.xml.rels', '</Relationships>', `<Relationship Id="cache" Type="${S}/slicerCache" Target="../other.xml"/></Relationships>`],
  ['caches/cache.xml', 'tableId="17"', 'tableId="18"'],
  ['caches/cache.xml', 'column="7"', 'column="1"'],
  ['tables/orders.xml', 'id="42"', 'id="7"'],
  ['views/controls.xml', 'cache="Regions"', 'cache="Absent"'],
  ['views/controls.xml', 'rowHeight="228600"', ''],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="-1"'],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="4294967296"'],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="228600" columnCount="0"'],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="228600" columnCount="20001"'],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="228600" showCaption="yes"'],
  ['views/controls.xml', 'rowHeight="228600"', 'rowHeight="228600" level="0"'],
  ['views/controls.xml', '</slicers>', '<slicer name="LOCATIONS" cache="Regions" rowHeight="100"/></slicers>'],
])('rejects inconsistent slicer metadata in %s (%s)', (path, before, after) => {
  const book = fixture(); change(book, path, before, after); expect(() => readXlsxSlicers(book)).toThrow(/Invalid native slicer/);
});
it('retains pivot cache definitions without inventing a table source binding', () => {
  const book = fixture(); change(book, 'caches/cache.xml', '<b:tableSlicerCache tableId="17" column="7"/>', '');
  const result = readXlsxSlicers(book); expect(result.caches[0].kind).toBe('pivot'); expect(result.caches[0].table).toBeUndefined();
});
it('rejects missing parts, wrong root namespaces and duplicate cache references', () => {
  const missing = fixture(); delete missing.files['views/controls.xml']; expect(() => readXlsxSlicers(missing)).toThrow(/missing part/);
  const foreign = fixture(); change(foreign, 'tables/orders.xml', M, 'urn:foreign'); expect(() => readXlsxSlicers(foreign)).toThrow(/table root/);
  const duplicate = fixture(); change(duplicate, 'documents/book.xml', '<a:slicerCache r:id="cache"/>', '<a:slicerCache r:id="cache"/><a:slicerCache r:id="cache"/>');
  expect(() => readXlsxSlicers(duplicate)).toThrow(/duplicate cache name/);
});

it('accepts the native none cross-filter mode and rejects invented enum values', () => {
  const book = fixture(); change(book, 'caches/cache.xml', 'column="7"', 'column="7" crossFilter="none"');
  expect(readXlsxSlicers(book).caches[0].crossFilter).toBe('none');
  change(book, 'caches/cache.xml', 'crossFilter="none"', 'crossFilter="showItemsWithDataOnly"');
  expect(() => readXlsxSlicers(book)).toThrow(/crossFilter/);
});
it('reads UTF-16 XML and rejects declarations that could resolve external entities', () => {
  const book = fixture(), xml = new TextDecoder().decode(book.files['views/controls.xml'].content);
  book.files['views/controls.xml'].content = Uint8Array.from(Buffer.from('\ufeff' + xml, 'utf16le'));
  expect(readXlsxSlicers(book).views[0].name).toBe('Locations');
  book.files['views/controls.xml'] = text('<!DOCTYPE slicers SYSTEM "https://example.com/external.dtd">' + xml);
  expect(() => readXlsxSlicers(book)).toThrow(/declarations/);
});
function drawingFixture(viewName = 'Locations') {
  const book = fixture();
  change(book, 'sheets/view.xml', '<extLst>', '<drawing r:id="draw"/><extLst>');
  change(book, 'sheets/_rels/view.xml.rels', '</Relationships>', `<Relationship Id="draw" Type="${R}/drawing" Target="../art/view.xml"/></Relationships>`);
  const D = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', A = 'http://schemas.openxmlformats.org/drawingml/2006/main', SLE = 'http://schemas.microsoft.com/office/drawing/2010/slicer';
  book.files['art/view.xml'] = text(`<d:wsDr xmlns:d="${D}" xmlns:a="${A}" xmlns:s="${SLE}"><d:absoluteAnchor><d:pos x="9525" y="19050"/><d:ext cx="2857500" cy="1428750"/><d:graphicFrame><d:nvGraphicFramePr><d:cNvPr id="2" name="Frame"/></d:nvGraphicFramePr><a:graphic><a:graphicData uri="${SLE}"><s:slicer name="${viewName}"/></a:graphicData></a:graphic></d:graphicFrame></d:absoluteAnchor></d:wsDr>`);
  return book;
}
it('joins drawing frames to their owning worksheet views through relationships', () => {
  const book = drawingFixture(); expect(readXlsxSlicers(book).views[0].drawing).toMatchObject({ name: 'Locations', part: 'art/view.xml', x: 1, y: 2, w: 300, h: 150, kind: 'absoluteAnchor' });
  expect(readXlsxSlicers(fixture()).views[0].drawing).toBeNull();
  expect(() => readXlsxSlicers(drawingFixture('Unrelated'))).toThrow(/drawing slicer view/);
  const source = new TextDecoder().decode(book.files['art/view.xml'].content), anchor = source.match(/<d:absoluteAnchor>[\s\S]*?<\/d:absoluteAnchor>/)[0];
  change(book, 'art/view.xml', '</d:wsDr>', anchor + '</d:wsDr>');
  expect(() => readXlsxSlicers(book)).toThrow(/duplicate slicer drawing/);
});
it('resolves custom and default slicer styles from the workbook styles relationship', () => {
  const book = fixture();
  change(book, 'documents/_rels/book.xml.rels', '</Relationships>', `<Relationship Id="styles" Type="${R}/styles" Target="../formatting/custom.xml"/></Relationships>`);
  book.files['formatting/custom.xml'] = text(`<styleSheet xmlns="${M}" xmlns:a="${X}"><dxfs><dxf><font><b/></font></dxf></dxfs><tableStyles><tableStyle name="Custom" table="0" pivot="0"><tableStyleElement type="wholeTable" dxfId="0"/></tableStyle></tableStyles><extLst><ext><a:slicerStyles defaultSlicerStyle="Custom"><a:slicerStyle name="Custom"/></a:slicerStyles></ext></extLst></styleSheet>`);
  change(book, 'views/controls.xml', 'style="SlicerStyleLight1"', '');
  const result = readXlsxSlicers(book); expect(result.defaultStyle).toBe('Custom'); expect(result.styles[0].frame.wholeTable).toContain('<b/>');
  change(book, 'documents/_rels/book.xml.rels', 'Id="styles"', 'Id="styles" TargetMode="External"');
  expect(() => readXlsxSlicers(book)).toThrow(/relationship type or mode/);
});

function pivotFixture(attributes = '', items = '<i x="8" s="1"/><i x="2"/><i x="5" s="true" nd="1"/>') {
  const book = fixture();
  book.files['caches/cache.xml'] = text(`<slicerCacheDefinition xmlns="${X}" name="Regions" sourceName="Category"><pivotTables><pivotTable tabId="41" name="Report &amp; totals"/><pivotTable tabId="7" name="Other"/></pivotTables><data><tabular pivotCacheId="19" ${attributes}><items count="3">${items}</items></tabular></data></slicerCacheDefinition>`);
  change(book, 'documents/book.xml', 'name="Dashboard"', 'name="Dashboard" sheetId="41"');
  change(book, 'documents/book.xml', 'name="Source"', 'name="Source" sheetId="7"');
  change(book, 'documents/book.xml', '</w:sheets>', '</w:sheets><w:pivotCaches><w:pivotCache cacheId="3" r:id="pivotCache"/></w:pivotCaches>');
  change(book, 'documents/_rels/book.xml.rels', '</Relationships>', `<Relationship Id="pivotCache" Type="${R}/pivotCacheDefinition" Target="../pivots/cache.xml"/></Relationships>`);
  change(book, 'sheets/_rels/view.xml.rels', '</Relationships>', `<Relationship Id="pivot" Type="${R}/pivotTable" Target="../pivots/report.xml"/></Relationships>`);
  change(book, 'sheets/_rels/data.xml.rels', '</Relationships>', `<Relationship Id="pivot" Type="${R}/pivotTable" Target="../pivots/other.xml"/></Relationships>`);
  book.files['pivots/cache.xml'] = text(`<pivotCacheDefinition xmlns="${M}"><cacheSource type="worksheet"><worksheetSource name="Orders"/></cacheSource><cacheFields count="2"><cacheField name="Amount"/><cacheField name="Category"><sharedItems count="9">${Array.from({length: 9}, (_, i) => `<s v="Area ${i}"/>`).join('')}</sharedItems></cacheField></cacheFields><extLst><ext><a:pivotCacheDefinition xmlns:a="${X}" pivotCacheId="19"/></ext></extLst></pivotCacheDefinition>`);
  for (const [part, caption] of [['report', 'Report &amp; totals'], ['other', 'Other']]) {
    book.files[`pivots/${part}.xml`] = text(`<pivotTableDefinition xmlns="${M}" name="${caption}" cacheId="3"><location ref="A1:B2"/></pivotTableDefinition>`);
    book.files[`pivots/_rels/${part}.xml.rels`] = text(rels([['source', `${R}/pivotCacheDefinition`, 'cache.xml']]));
  }
  return book;
}
it('decodes non-OLAP member identities, selections and report connections without sorting them', () => {
  const book = pivotFixture(), before = structuredClone(book);
  expect(readXlsxSlicers(book).caches[0]).toMatchObject({ kind: 'pivot', pivotCacheId: 19,
    sourceName: 'Category', pivotTables: [{ tabId: 41, name: 'Report & totals' }, { tabId: 7, name: 'Other' }],
    items: [{ index: 8, selected: true, noData: false }, { index: 2, selected: false, noData: false }, { index: 5, selected: true, noData: true }],
    sortOrder: 'ascending', customListSort: true, showMissing: true, crossFilter: 'showItemsWithDataAtTop' });
  expect(book).toEqual(before);
});
it('decodes explicit non-OLAP settings and distinguishes an omitted item list', () => {
  const book = pivotFixture('sortOrder="descending" customListSort="0" showMissing="false" crossFilter="none"', '<i x="8" s="1"/><i x="2"/><i x="5" s="true"/>');
  expect(readXlsxSlicers(book).caches[0]).toMatchObject({ sortOrder: 'descending', customListSort: false, showMissing: false, crossFilter: 'none' });
  change(book, 'caches/cache.xml', '<items count="3"><i x="8" s="1"/><i x="2"/><i x="5" s="true"/></items>', '');
  expect(readXlsxSlicers(book).caches[0].items).toBeNull();
});
it.each([
  ['pivotCacheId="19"', 'pivotCacheId="-1"'],
  ['tabId="41"', 'tabId="4294967296"'],
  ['count="3"', 'count="2"'],
  ['x="2"', 'x="8"'],
  ['x="2"', 'x="bad"'],
  ['s="1"', 's="yes"'],
  ['nd="1"', 'nd="invalid"'],
  ['<tabular ', '<tabular crossFilter="none" '],
  ['<tabular ', '<tabular sortOrder="manual" '],
  ['<tabular ', '<tabular showMissing="yes" '],
  ['<data>', '<data><olap/>'],
  ['</data>', '</data><data/>'],
  ['</tabular>', '<items/></tabular>'],
])('rejects malformed tabular slicer metadata (%s)', (before, after) => {
  const book = pivotFixture(); change(book, 'caches/cache.xml', before, after);
  expect(() => readXlsxSlicers(book)).toThrow(/Invalid native slicer/);
});
it('requires at least one selected member in a present tabular item list', () => {
  const book = pivotFixture('', '<i x="8"/><i x="2" s="0"/><i x="5" s="false"/>');
  expect(() => readXlsxSlicers(book)).toThrow(/empty tabular slicer selection/);
});

it('binds tabular slicers to field identities and only their declared reports', () => {
  const book = pivotFixture();
  change(book, 'caches/cache.xml', '<pivotTable tabId="7" name="Other"/>', '');
  const pivot = readXlsxSlicers(book).caches[0].pivot;
  expect(pivot).toMatchObject({ cacheKey: 'pivots/cache.xml', field: { index: 1, name: 'Category', databaseField: true, serverField: false },
    reports: [{ name: 'Report & totals', sheet: 'Dashboard' }] });
  expect(pivot.field.items[8]).toEqual({ type: 'string', value: 'Area 8' });
  expect(pivot.reports).toHaveLength(1);
});
it('resolves case-insensitive escaped field/report names, not source captions or field offsets', () => {
  const book = pivotFixture();
  change(book, 'pivots/cache.xml', 'name="Category"', 'name="Category_x000A_name"');
  change(book, 'caches/cache.xml', 'sourceName="Category"', 'sourceName="CATEGORY_x000A_NAME"');
  change(book, 'pivots/report.xml', 'Report &amp; totals', 'Report_x000A_name');
  change(book, 'caches/cache.xml', 'Report &amp; totals', 'REPORT_x000A_NAME');
  expect(readXlsxSlicers(book).caches[0].pivot).toMatchObject({ field: { name: 'Category\nname' },
    reports: [{ name: 'Report\nname', sheet: 'Dashboard' }, { name: 'Other', sheet: 'Source' }] });
});
it('ignores tabId for an explicitly connected non-worksheet pivot report', () => {
  const book = pivotFixture();
  change(book, 'sheets/_rels/data.xml.rels', `<Relationship Id="pivot" Type="${R}/pivotTable" Target="../pivots/other.xml"/>`, '');
  change(book, 'documents/book.xml', '</w:extLst>', '<w:ext><b:pivotTableReference r:id="standalone"/></w:ext></w:extLst>');
  change(book, 'documents/_rels/book.xml.rels', '</Relationships>', `<Relationship Id="standalone" Type="${R}/pivotTable" Target="../pivots/other.xml"/></Relationships>`);
  change(book, 'caches/cache.xml', 'tabId="7"', 'tabId="999"');
  expect(readXlsxSlicers(book).caches[0].pivot.reports[1]).toEqual({ name: 'Other', sheet: null });
});
it.each([
  ['caches/cache.xml', 'pivotCacheId="19"', 'pivotCacheId="3"'],
  ['pivots/cache.xml', 'pivotCacheId="19"', 'pivotCacheId="20"'],
  ['caches/cache.xml', 'sourceName="Category"', 'sourceName="Caption"'],
  ['caches/cache.xml', 'x="8"', 'x="9"'],
  ['caches/cache.xml', 'tabId="41"', 'tabId="7"'],
  ['caches/cache.xml', 'Report &amp; totals', 'Missing'],
  ['caches/cache.xml', '</pivotTables>', '<pivotTable tabId="41" name="Report &amp; totals"/></pivotTables>'],
  ['documents/book.xml', 'sheetId="7"', 'sheetId="41"'],
  ['pivots/cache.xml', 'name="Category"', 'name="Category" serverField="1"'],
  ['pivots/cache.xml', 'name="Amount"', 'name="CATEGORY"'],
])('rejects inconsistent pivot slicer binding in %s (%s)', (part, before, after) => {
  const book = pivotFixture(); change(book, part, before, after);
  expect(() => readXlsxSlicers(book)).toThrow(/Invalid native slicer/);
});

it('reads hide-no-data by extension presence, including an empty zero-count element', () => {
  const book = fixture();
  change(book, 'caches/cache.xml', '<b:tableSlicerCache', '<b:slicerCacheHideItemsWithNoData count="0"/><b:tableSlicerCache');
  expect(readXlsxSlicers(book).caches[0].hideItemsWithNoData).toBe(true);
  change(book, 'caches/cache.xml', 'count="0"', 'count="1"');
  expect(() => readXlsxSlicers(book)).toThrow(/level count/);
});
it('does not infer hide-no-data from a foreign namespace and rejects duplicate declarations', () => {
  const book = fixture();
  change(book, 'caches/cache.xml', '<b:tableSlicerCache', '<foreign:slicerCacheHideItemsWithNoData xmlns:foreign="urn:foreign"/><b:tableSlicerCache');
  expect(readXlsxSlicers(book).caches[0].hideItemsWithNoData).toBe(false);
  change(book, 'caches/cache.xml', '<b:tableSlicerCache', '<b:slicerCacheHideItemsWithNoData/><b:slicerCacheHideItemsWithNoData/><b:tableSlicerCache');
  expect(() => readXlsxSlicers(book)).toThrow(/hide-no-data extension/);
});
it('reads structural metadata after large cell contents without parsing cells into its metadata DOM', () => {
  const book = fixture();
  change(book, 'sheets/data.xml', '<tableParts>', `<sheetData><row><c><is><t>${'x'.repeat(17 * 1024 * 1024)}</t></is></c></row></sheetData><tableParts>`);
  expect(readXlsxSlicers(book).caches[0].table.name).toBe('Orders');
  change(book, 'sheets/view.xml', '<extLst>', `<sheetData>${'<row><c/></row>'.repeat(60000)}</sheetData><extLst>`);
  expect(readXlsxSlicers(book).views[0].name).toBe('Locations');
});
