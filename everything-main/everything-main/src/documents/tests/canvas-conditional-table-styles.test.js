import { beforeAll, afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';

let dom, singleTable;
beforeAll(() => {
  dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  // Structural operations need the first independently authored table, not
  // fourteen unrelated oracle pages on every edit/reopen cycle.
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const body = xml.documentElement.firstElementChild, table = [...body.children].find(n => n.localName === 'tbl');
  for (const n of [...body.children]) if (n !== table && n.localName !== 'sectPr') n.remove();
  body.insertBefore(xml.createElementNS(body.namespaceURI, 'w:p'), body.lastElementChild);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); singleTable = zipSync(parts);
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/conditional-table-styles.docx');
const word = JSON.parse(readFileSync('tests/fixtures/conditional-table-styles/reference.json', 'utf8'));
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const snapshot = doc => doc.tables.map(table => table.rows.map(row => row.cells.map(cell => ({ fill: cell.fill, borders: cell.borders,
  content: doc.paragraphs.filter(p => p.cellId === cell.id).map(p => p.runs.map(r => ({ text: r.text, color: r.color, bold: r.bold }))),
}))));

it('imports all 374 native reference cells with conditional color, shading and bold', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(pkg.readOnly).toBeFalsy(); expect(doc.tables).toHaveLength(15);
  for (const [index, reference] of Object.values(word).entries()) {
    const table = doc.tables[index];
    for (const row of table.rows) for (const cell of row.cells) {
      const p = doc.paragraphs.find(p => p.cellId === cell.id), expected = reference[paragraphText(p)];
      expect(expected).toBeDefined();
      expect(p.runs[0].color).toBe(expected.color);
      expect(p.runs[0].bold).toBe(expected.font.includes('Bold'));
      expect(cell.fill).toBe('#' + expected.fill);
    }
  }
  const exported = unzipSync(await save(pkg, doc)), original = unzipSync(source);
  for (const name of Object.keys(original)) expect(Buffer.from(exported[name]).equals(Buffer.from(original[name])), name).toBe(true);
}, 30000);

for (const operation of ['insert-row', 'insert-column', 'delete-row', 'delete-column', 'header', 'merge-split']) it(`${operation}: conditional formatting survives edit/export/reopen and undo`, async () => {
  const pkg = await DocxPackage.open(singleTable), doc = model(pkg), initial = snapshot(doc);
  const table = doc.tables[0]; doc.selectCell(table.rows[0].cells[0].id);
  if (operation === 'insert-row') {
    doc.insertTableRow();
    expect(table.rows[1].cells[1].fill).toBe('#EEEEEE');
  } else if (operation === 'insert-column') {
    doc.insertTableColumn();
    expect(table.rows[1].cells[1].fill).toBe('#EEEEEE');
  } else if (operation === 'delete-row') {
    doc.deleteTablePart('row'); expect(table.rows[0].cells[1].fill).toBe('#CC4400');
  } else if (operation === 'delete-column') {
    doc.deleteTablePart('column'); expect(table.rows[1].cells[0].fill).toBe('#880088');
  } else if (operation === 'header') {
    doc.setTableHeaderRows(2); expect(table.rows[1].cells[1].fill).toBe('#CC4400');
  } else {
    const p = doc.paragraphs.findIndex(p => p.cellId === table.rows[0].cells[1].id);
    doc.select(doc.range[0], doc.paragraphOffset(p) + 1); doc.mergeCells();
    expect(table.rows[0].cells[0].span).toBe(2);
  }
  const expected = snapshot(doc), bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(snapshot(reopened)).toEqual(expected);
  const edited = unzipSync(bytes), original = unzipSync(singleTable);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(Buffer.from(edited[name]).equals(Buffer.from(original[name])), name).toBe(true);
  if (operation === 'merge-split') { doc.splitCell(); expect(table.rows[0].cells[1].fill).toBe('#CC4400'); doc.undo(); }
  doc.undo(); expect(snapshot(doc)).toEqual(initial);
  const undone = unzipSync(await save(pkg, doc));
  for (const name of Object.keys(original)) expect(Buffer.from(undone[name]).equals(Buffer.from(original[name])), name).toBe(true);
});

it('nil shading follows the current region while explicit shading survives topology changes', async () => {
  const parts = unzipSync(singleTable);
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:tcPr>', '<w:tcPr><w:shd w:val="nil" w:fill="FFFFFF"/>'));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg), table = doc.tables[0], first = table.rows[0].cells[0];
  expect(first.fill).toBe('#CC0044');
  doc.selectCell(first.id); doc.setCellShading('112233'); doc.insertTableRow();
  expect(table.rows[1].cells[0].fill).toBe('#112233');
  doc.selectCell(table.rows[1].cells[0].id); doc.setCellShading(null);
  expect(table.rows[1].cells[0].fill).toBe('#880088');
  expect(snapshot(model(await DocxPackage.open(await save(pkg, doc))))).toEqual(snapshot(doc));
});

for (const suffix of ['', '-12']) it(`preserves declared table font inheritance in the independent ${suffix || '16pt'} control probe`, async () => {
  const reference = JSON.parse(readFileSync(`tests/fixtures/table-style-font-defaults${suffix}/reference.json`, 'utf8'));
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/table-style-font-defaults${suffix}.docx`));
  const cells = pkg.paragraphs.filter(p => paragraphText(p).startsWith('Cell_'));
  expect(cells).toHaveLength(13);
  for (const p of cells) expect(Math.abs(p.runs[0].fontSize - reference[paragraphText(p).slice(5)])).toBeLessThan(.1);
});

it('inherits the outer conditional region in a paragraph inserted beside a nested table', async () => {
  const pkg = await DocxPackage.open(singleTable), doc = model(pkg), outer = doc.tables[0].rows[0].cells[0];
  doc.selectCell(outer.id); doc.insertTable(1, 1, 1500);
  doc.insertTableParagraph(true); doc.replace('After nested');
  const inserted = doc.paragraphs.find(p => paragraphText(p) === 'After nested');
  expect(inserted.cellId).toBe(outer.id); expect(inserted.runs[0].color).toBe('CC0044');
  const reopened = await DocxPackage.open(await save(pkg, doc));
  expect(reopened.paragraphs.find(p => paragraphText(p) === 'After nested').runs[0].color).toBe('CC0044');
});
