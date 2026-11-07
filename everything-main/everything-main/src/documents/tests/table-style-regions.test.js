import { afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { conditionalStyleGroups, tableStyleLook, tableStyleRegions } from '../src/engine/table-style-regions.js';

const dom = new JSDOM('');
afterAll(() => dom.window.close());
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parts = unzipSync(readFileSync('public/fixtures/conditional-table-styles.docx'));
const xml = name => new dom.window.DOMParser().parseFromString(strFromU8(parts[name]), 'application/xml');
const child = (n, name) => [...(n?.children || [])].find(c => c.localName === name);
const attr = (n, name = 'val') => n?.getAttributeNS(W, name) ?? null;
const styles = [...xml('word/styles.xml').getElementsByTagNameNS(W, 'style')];
const word = JSON.parse(readFileSync('tests/fixtures/conditional-table-styles/reference.json', 'utf8'));
const tables = [...xml('word/document.xml').getElementsByTagNameNS(W, 'tbl')];
const groups = node => ({
  ...(child(node, 'rPr') ? { run: {
    ...(child(child(node, 'rPr'), 'color') ? { color: attr(child(child(node, 'rPr'), 'color')) } : {}),
    ...(child(child(node, 'rPr'), 'b') ? { bold: true } : {}),
  } } : {}),
  ...(child(node, 'tcPr') ? { cell: { fill: attr(child(child(node, 'tcPr'), 'shd'), 'fill') } } : {}),
});
function readCase(index) {
  const node = tables[index], pr = child(node, 'tblPr'), look = child(pr, 'tblLook');
  const settings = { look: tableStyleLook(look ? Object.fromEntries([...look.attributes].map(a => [a.localName, a.value])) : null),
    rowBandSize: Number(attr(child(pr, 'tblStyleRowBandSize')) || 0), columnBandSize: Number(attr(child(pr, 'tblStyleColBandSize')) || 0) };
  const table = { grid: [...child(node, 'tblGrid').children].map(() => 1872), rows: [...node.children].filter(n => n.localName === 'tr').map((row, r) => ({
    header: !!child(child(row, 'trPr'), 'tblHeader'),
    cells: [...row.children].filter(n => n.localName === 'tc').map((cell, c) => ({ id: `${r}:${c}`, text: cell.getElementsByTagNameNS(W, 't')[0].textContent, span: Number(attr(child(child(cell, 'tcPr'), 'gridSpan')) || 1) })),
  })) };
  const chain = [];
  for (let id = attr(child(pr, 'tblStyle')); id;) {
    const style = styles.find(n => attr(n, 'styleId') === id);
    chain.unshift({ ...groups(style), conditionals: Object.fromEntries([...style.children].filter(n => n.localName === 'tblStylePr').map(n => [attr(n, 'type'), groups(n)])) });
    id = attr(child(style, 'basedOn'));
  }
  settings.definedRegions = [...new Set(chain.flatMap(style => Object.keys(style.conditionals)))];
  return { table, settings, chain };
}

// These compare the region-selection layer with independently observed native reference
// output. They do not claim that the DOCX importer or canvas supports it yet.
for (const [index, [name, reference]] of Object.entries(word).entries()) it(`${name}: selects the conditional groups observed in the native reference`, () => {
  const { table, settings, chain } = readCase(index), selections = tableStyleRegions(table, settings);
  for (const row of table.rows) for (const cell of row.cells) {
    const selected = conditionalStyleGroups(chain, selections.get(cell.id));
    const run = Object.assign({}, ...chain.map(s => s.run), ...selected.map(s => s.run));
    const format = Object.assign({}, ...chain.map(s => s.cell), ...selected.map(s => s.cell));
    expect(run.color, cell.text).toBe(reference[cell.text].color);
    expect(format.fill, cell.text).toBe(reference[cell.text].fill);
    expect(!!run.bold, cell.text).toBe(reference[cell.text].font.includes('Bold'));
  }
});

it('reselects first/last rows and band parity from the changed structure', () => {
  const index = Object.keys(word).indexOf('horizontal'), { table, settings } = readCase(index);
  const first = table.rows[0].cells[2].id, second = table.rows[1].cells[2].id, last = table.rows.at(-1).cells[2].id;
  table.rows.unshift({ cells: table.rows[0].cells.map((c, i) => ({ ...c, id: `inserted:${i}` })) });
  let regions = tableStyleRegions(table, settings);
  expect(regions.get(first)).toEqual(['band1Horz']);
  expect(regions.get(second)).toEqual(['band2Horz']);
  expect(regions.get(last)).toEqual(['lastRow']);
  table.rows.pop(); regions = tableStyleRegions(table, settings);
  expect(regions.has(last)).toBe(false);
  expect(regions.get(table.rows.at(-1).cells[2].id)).toEqual(['lastRow']);
});

it('rejects malformed flags and unsupported band sizes before calculating regions', () => {
  expect(() => tableStyleLook({ val: 'oops' })).toThrow();
  expect(() => tableStyleLook({ firstRow: 'yes' })).toThrow();
  expect(() => tableStyleRegions({ grid: [1], rows: [] }, { rowBandSize: 4 })).toThrow();
});
