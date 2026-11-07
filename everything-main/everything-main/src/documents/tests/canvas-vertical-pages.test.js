import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { documentBlocks, verticalMerges } from '../src/engine/tables.js';
import { layoutDocument, hitTest, selectionRects, verticalLine, lineAtPosition } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/vertical-pages.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const fragments = (result, id) => result.cells.filter(c => c.id === id);
const geometry = result => result.lines.map(l => [l.start, l.end, l.page, l.y, l.height]);
function checkGeometry(result, doc) {
  const bottom = result.page.height - result.page.bottom;
  for (const box of result.cells) {
    expect(box.height).toBeGreaterThan(0); expect(box.y).toBeGreaterThanOrEqual(result.page.top - 1e-6); expect(box.y + box.height).toBeLessThanOrEqual(bottom + 1e-6);
    for (const other of result.cells) if (other !== box && other.page === box.page) {
      expect(Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x) > 1e-6 && Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y) > 1e-6, `overlapping cells ${box.id}/${other.id}`).toBe(false);
    }
  }
  for (const line of result.lines) if (line.cellId) {
    const box = result.cells.find(c => c.id === line.cellId && c.page === line.page);
    expect(box, `missing cell fragment for text ${line.start}`).toBeDefined();
    expect(line.y).toBeGreaterThanOrEqual(box.y - 1e-6); expect(line.y + line.height).toBeLessThanOrEqual(box.y + box.height + 1e-6);
    expect(line.stops[0].x).toBeGreaterThanOrEqual(box.x - 1e-6); expect(line.stops.at(-1).x).toBeLessThanOrEqual(box.x + box.width + 1e-6);
    const at = line.stops[Math.floor(line.stops.length / 2)]; expect(hitTest(result, line.page, at.x, line.y + line.height / 2)).toBe(at.offset);
  }
  expect(new Set(result.lines.map(l => `${l.paragraphId}/${l.start}/${l.end}`)).size).toBe(result.lines.length);
  for (const p of doc.paragraphs) expect(result.lines.some(l => l.paragraphId === p.id)).toBe(true);
}

it('flows independent staggered and rectangular merges across pages without losing text or overlapping cells', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), result = layout(doc), table = doc.tables[0];
  expect(table.rows.map(r => r.cantSplit)).toEqual([false, true, false, true]);
  expect(result.pageCount).toBeGreaterThan(5); checkGeometry(result, doc);
  for (const cell of [table.rows[0].cells[0], table.rows[1].cells[1], doc.tables[1].rows[0].cells[0]]) {
    const boxes = fragments(result, cell.id); expect(boxes.length).toBeGreaterThan(1);
    expect(new Set(result.lines.filter(l => l.cellId === cell.id).map(l => l.page)).size).toBeGreaterThan(1);
    for (const [i, box] of boxes.entries()) {
      // The fixture's half-point border reserves half its ink at a page top.
      if (i) { expect(box.page).toBe(boxes[i - 1].page + 1); expect(box.y).toBeCloseTo(result.page.top + 1 / 3); }
    }
  }
  // A kept following row leaves a gap; merged text must not fill that gap.
  const first = fragments(result, table.rows[0].cells[0].id)[0];
  expect(first.y + first.height).toBeLessThan(result.page.height - result.page.bottom);
  const parts = unzipSync(await save(pkg, doc)); for (const [name, bytes] of Object.entries(pkg.parts)) expect(Buffer.from(parts[name]).equals(Buffer.from(bytes)), name).toBe(true);
});

it('applies row keeps individually, lets oversized kept rows flow, and restores pagination on undo', async () => {
  const doc = model(await DocxPackage.open(source)), table = doc.tables[0], owner = table.rows[1].cells[1], before = layout(doc);
  doc.selectCell(owner.id); const snapshot = doc.snapshot(); doc.setTableRowKeep(false); const split = layout(doc);
  expect(fragments(before, owner.id)[0].page).toBeGreaterThan(fragments(split, owner.id)[0].page);
  expect(fragments(before, owner.id)[0].y).toBeCloseTo(before.page.top + 1 / 3); expect(fragments(split, owner.id).length).toBeGreaterThan(1); checkGeometry(split, doc);
  doc.undo(); expect(doc.snapshot()).toEqual(snapshot); expect(layout(doc)).toEqual(before);
  const tall = doc.tables[2].rows[0].cells[0]; doc.selectCell(tall.id); doc.setTableRowKeep(true); const result = layout(doc), boxes = fragments(result, tall.id);
  expect(boxes[0].y).toBeCloseTo(result.page.top + 1 / 3); expect(boxes).toHaveLength(1);
  // The declared minimum fills one writing area when its content fits there.
  expect(boxes[0].height).toBeCloseTo(result.page.height - result.page.top - result.page.bottom - 2 / 3); checkGeometry(result, doc);
});

it('keeps a heading with the first line of a fully merged table and credits space consumed by page moves', () => {
  const doc = model(createDocx([paragraph('Lead A'), paragraph('Lead B'), paragraph('Heading'), paragraph()]));
  doc.select(doc.text.length); doc.insertTable(3, 1); doc.mergeCellBelow(); doc.mergeCellBelow(); doc.replace('Word '.repeat(100));
  doc.paragraphs = doc.paragraphs.filter(p => p.cellId || paragraphText(p));
  for (const p of doc.paragraphs) p.format = { ...p.format, lineSpacing: 1, spaceAfter: 0, spaceBefore: 0, keepNext: paragraphText(p) === 'Heading' };
  // Leave room for the heading, two widow-controlled lines, cell padding and
  // border ink. The former70px writing area only fit when borders used no space.
  const page = { width: 816, height: 112, top: 20, bottom: 20, left: 96, right: 96, gap: 24 };
  const actual = layoutDocument(doc.paragraphs, text => ({ width: text.length * 8, ascent: 10, descent: 10 }), page, doc.numbering, doc.tables);
  const heading = actual.lines.find(l => l.paragraphId === doc.paragraphs[2].id), owner = doc.tables[0].rows[0].cells[0], lines = actual.lines.filter(l => l.cellId === owner.id), boxes = fragments(actual, owner.id);
  expect(heading.page).toBe(1); expect(lines[0].page).toBe(heading.page);
  expect(boxes.at(-1).page).toBe(lines.at(-1).page); expect(boxes.at(-1).y + boxes.at(-1).height - lines.at(-1).y - lines.at(-1).height).toBeLessThan(20);
  checkGeometry(actual, doc);
});

it('navigates within a merged cell across pages and maps empty cell space to its nearest text', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc), table = doc.tables[0], id = table.rows[0].cells[0].id;
  const lines = result.lines.filter(l => l.cellId === id), boundary = lines.findIndex((l, i) => i && l.page !== lines[i - 1].page);
  expect(boundary).toBeGreaterThan(0);
  expect(verticalLine(result, lines[boundary - 1], 1, lines[boundary - 1].stops[0].x)).toBe(lines[boundary]);
  expect(verticalLine(result, lines[boundary], -1, lines[boundary].stops[0].x)).toBe(lines[boundary - 1]);
  expect(verticalLine(result, lines.at(-1), 1, lines.at(-1).stops[0].x).cellId).toBe(table.rows[3].cells[0].id);
  const tall = doc.tables[2].rows[0].cells[1], box = fragments(result, tall.id).at(-1), last = result.lines.filter(l => l.cellId === tall.id).at(-1);
  expect(box.page).toBe(last.page); expect(box.y + box.height / 2).toBeGreaterThan(last.y + last.height);
  const at = hitTest(result, box.page, last.stops[0].x, box.y + box.height / 2); expect(at).toBe(last.start); expect(lineAtPosition(result, at).cellId).toBe(tall.id);
  const rects = selectionRects(result, lines[0].start, lines.at(-1).end); expect(new Set(rects.map(r => r.page)).size).toBeGreaterThan(1);
});

it('reflows inherited fonts and editing with identical text geometry after save/reopen and complete undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), id = doc.tables[0].rows[0].cells[0].id;
  doc.selectCell(id); const before = doc.snapshot(), original = layout(doc);
  doc.replace('Edited Á😀 '); doc.editParagraphStyle('Normal', { run: { fontSize: 12 } }); const result = layout(doc); checkGeometry(result, doc);
  const exported = await DocxPackage.open(await save(pkg, doc)), out = model(exported); expect(out.text).toBe(doc.text); expect(geometry(layout(out))).toEqual(geometry(result));
  expectBodyEditParts(exported.parts, pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); expect(layout(doc)).toEqual(original);
});

it('merges, splits and promotes long cells across pages while retaining grid ownership and text', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), id = doc.tables[0].rows[0].cells[0].id;
  doc.selectCell(id); const before = doc.snapshot(); doc.mergeCellBelow();
  expect(verticalMerges(doc.tables[0]).get(id).endRow).toBe(3); expect(doc.paragraphs.filter(p => p.cellId === id).map(paragraphText).at(-1)).toBe('Lower left');
  checkGeometry(layout(doc), doc); doc.splitCell(); checkGeometry(layout(doc), doc);
  let out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
  doc.deleteTablePart('row'); expect(doc.text).toContain('Left end Á😀'); expect(doc.text).not.toContain('Upper middle');
  documentBlocks(doc.paragraphs, doc.tables); checkGeometry(layout(doc), doc);
  out = model(await DocxPackage.open(await save(pkg, doc))); expect(geometry(layout(out))).toEqual(geometry(layout(doc))); doc.undo(); expect(doc.snapshot()).toEqual(before);
});

it('repaginates fixed/AutoFit width and column edits without modifying unaffected merge declarations', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); doc.selectCell(doc.tables[0].rows[0].cells[0].id); const before = doc.snapshot();
  doc.setTableProperties({ columns: [2520, 3240, 1440] }); const narrow = layout(doc); checkGeometry(narrow, doc);
  doc.insertTableColumn(); doc.replace('New'); checkGeometry(layout(doc), doc); doc.deleteTablePart('column');
  const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); expect(geometry(layout(out))).toEqual(geometry(layout(doc)));
  doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
  // Compatibility mode 14 includes the two exterior 108-twip margins in the
  // percentage basis: 360pt writing area + 10.8pt margins = 370.8pt.
  // Confirmed against the native reference after exporting this fixture with Fit to page.
  doc.selectCell(doc.tables[1].rows[0].cells[0].id); doc.fitTable('page'); expect(layout(doc).tableWidths[doc.tables[1].id].reduce((a,b) => a+b, 0)).toBeCloseTo(494.4);
  checkGeometry(layout(doc), doc);
});
