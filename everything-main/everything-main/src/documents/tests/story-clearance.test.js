import { afterAll, beforeAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { paragraph, TextDocument } from '../src/engine/model.js';
import { emptyStyles } from '../src/engine/styles.js';
import { DEFAULT_PAGE_SETTINGS, pageGeometry } from '../src/engine/page-settings.js';
import { pageBounds, offsetPage, cellPageAt } from '../src/engine/page-bounds.js';

const measure = text => ({ width: text.length * 7, ascent: 12, descent: 4 });
const story = height => ({ paragraphs: [paragraph('Story', { format: { lineRule: 'exact', lineSpacing: height, spaceAfter: 0 } })] });
const settings = { ...DEFAULT_PAGE_SETTINGS, top: 720, bottom: 720, header: 720, footer: 720 };
const definition = {
  evenAndOdd: true,
  sections: [{ firstPageDifferent: true, header: { first: 'first', even: 'even', default: 'default' }, footer: {} }],
  stories: { first: story(24), even: story(36), default: story(12) },
};
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

it('selects first, even and default header clearance independently and retains serializable layout', () => {
  const paragraphs = [0, 1, 2].map(i => paragraph(`Body ${i}`, { format: { pageBreakBefore: !!i } }));
  const result = layoutDocument(paragraphs, measure, pageGeometry(settings), undefined, [], definition);
  const stories = layoutPageStories(result, definition, [settings], measure);
  expect(result.pageCount).toBe(3);
  result.lines.forEach((line, i) => {
    const header = stories.lines.find(h => h.page === i);
    expect(line.y).toBeCloseTo(header.y + header.height);
    expect(hitTest(result, i, line.stops[1].x, line.y + line.height / 2)).toBe(line.stops[1].offset);
    expect(caretRect(result, line.start).y).toBeCloseTo(line.y);
  });
  expect(new Set(result.lines.map(l => l.y)).size).toBe(3);
  expect(structuredClone(result)).toEqual(result);
});

it.each(['header', 'footer'])('honors signed margins for %s clearance', kind => {
  const def = { sections: [{ header: {}, footer: {}, [kind]: { default: 'story' } }], stories: { story: story(36) } };
  const paragraphs = Array.from({ length: 120 }, () => paragraph('Body', { format: { spaceAfter: 0 } }));
  const positive = layoutDocument(paragraphs, measure, pageGeometry(settings), undefined, [], def);
  const signed = { ...settings, [kind === 'header' ? 'top' : 'bottom']: -720 };
  const negative = layoutDocument(paragraphs, measure, pageGeometry(signed), undefined, [], def);
  if (kind === 'header') {
    expect(positive.lines[0].y - negative.lines[0].y).toBeCloseTo(48);
    expect(negative.lines[0].y).toBe(48);
  } else {
    const edge = pageGeometry(settings).height - 96;
    expect(positive.lines.every(l => l.y + l.height <= edge + 1e-6)).toBe(true);
    expect(negative.lines.some(l => l.y + l.height > edge)).toBe(true);
  }
});

it('carries physical page offsets through cell padding and disables them for natural measurement', () => {
  const base = { height: 300, top: 20, bottom: 30 };
  const page = { ...base, boundsBase: base, pageBounds: i => ({ top: 40 + i * 10, bottom: 260 - i * 10 }) };
  const cell = cellPageAt({ ...base, top: 25, bottom: 37 }, offsetPage(page, 1), 1);
  expect(pageBounds(cell)).toEqual({ top: 65, bottom: 233 });
  expect(pageBounds({ ...cell, height: 1e9 })).toEqual({ top: 25, bottom: 1e9 - 37 });
});

it('does not revive physical story bounds in nested intrinsic measurements', () => {
  const base = { height: 300, top: 20, bottom: 30 };
  const stale = { ...base, boundsBase: base, boundsOrigin: 9,
    pageBounds: () => { throw new Error('Page number not assigned during measurement'); } };
  const natural = { ...stale, height: 1e9, top: 0, bottom: 0 };
  const nested = cellPageAt(stale, natural, 2);
  expect(pageBounds(nested)).toEqual({ top: 20, bottom: 270 });
  expect(pageBounds(cellPageAt(stale, nested, 1))).toEqual({ top: 20, bottom: 270 });
  expect(pageBounds(cellPageAt(stale, base, 0))).toEqual({ top: 20, bottom: 270 });
  const physical = { ...base, boundsBase: base, boundsOrigin: 1,
    pageBounds: i => ({ top: 40 + i * 10, bottom: 260 - i * 10 }) };
  expect(pageBounds(cellPageAt(stale, cellPageAt(stale, physical, 1), 1)))
    .toEqual({ top: 70, bottom: 230 });
});

it('looks ahead through a shorter even page when avoiding paragraph widows', () => {
  const def = { evenAndOdd: true, sections: [{ header: { even: 'short' }, footer: {} }], stories: { short: story(45) } };
  const geometry = { width: 400, height: 120, top: 20, bottom: 20, left: 20, right: 20, header: 0 };
  const body = paragraph('', { runs: [{ text: 'a\vb\vc\vd\v', fontSize: 12 }, { text: 'e\v', fontSize: 24 }, { text: 'f', fontSize: 12 }], format: { spaceAfter: 0 } });
  const measured = (text, style) => ({ width: text.length * 5, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 });
  const result = layoutDocument([body], measured, geometry, undefined, [], def);
  expect(result.lines.map(l => l.page)).toEqual([0, 0, 1, 1, 2, 2]);
});

it.each(['NUMPAGES', 'SECTIONPAGES'])('stabilizes clearance when a %s field wraps after counting pages', type => {
  const def = { sections: [{ header: { default: 'count' }, footer: {} }], stories: { count: { paragraphs: [paragraph('', { runs: [{ text: '?', field: { type, cachedText: '1' } }], format: { spaceAfter: 0 } })] } } };
  const geometry = { width: 50, height: 120, left: 20, right: 20, top: 10, bottom: 10, header: 10 };
  const paragraphs = Array.from({ length: 10 }, (_, i) => paragraph('a', { format: { pageBreakBefore: i > 0, spaceAfter: 0 } }));
  const before = structuredClone(def);
  const result = layoutDocument(paragraphs, measure, geometry, undefined, [], def);
  const stories = layoutPageStories(result, def, [{ header: 150, footer: 0 }], measure);
  expect(result.pageCount).toBe(10);
  expect(stories.lines.filter(l => l.page === 0).map(l => l.fragments.map(f => f.text).join(''))).toEqual(['1', '0']);
  for (const line of result.lines) {
    const last = stories.lines.filter(l => l.page === line.page).at(-1);
    expect(line.y).toBeCloseTo(last.y + last.height);
  }
  expect(def).toEqual(before);
});

it('remeasures inherited story formatting from the current styles without changing source paragraphs', () => {
  const styles = emptyStyles();
  styles.defaults.properties.spacing = { after: '0', line: '240', lineRule: 'exact' };
  const def = { sections: [{ header: { default: 'empty' }, footer: {} }], stories: { empty: { paragraphs: [paragraph()] } } };
  const before = structuredClone(def), body = [paragraph('Body')];
  const render = () => layoutDocument(body, measure, pageGeometry(settings), undefined, [], def, { styles });
  const original = render();
  styles.defaults.properties.spacing.line = '480';
  const changed = render();
  expect(changed.lines[0].y - original.lines[0].y).toBeCloseTo(16);
  styles.defaults.properties.spacing.line = '240';
  expect(render()).toEqual(original); expect(def).toEqual(before);
});

it('reflows signed-margin edits and restores story parts and geometry on undo', async () => {
  const bytes = readFileSync('tests/fixtures/header-clearance/header-spacer-16-positive.docx');
  const pkg = await DocxPackage.open(bytes), doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const render = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables, pkg.pageStories, { styles: d.styles });
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  const original = render(doc); doc.setPageSettings({ top: -720 }); const changed = render(doc);
  expect(changed.cells[0].y).toBeLessThan(original.cells[0].y);
  const edited = await save(), parts = unzipSync(edited), source = unzipSync(bytes);
  for (const name of Object.keys(source)) if (name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(source[name])), name).toBe(true);
  // Reopening allocates new editing identities; all rendered geometry must
  // still match, including caret stops, fragments, row boxes and borders.
  const geometry = ({ tableWidths, ...rest }) => JSON.parse(JSON.stringify({ ...rest, tableWidths: Object.values(tableWidths) },
    (key, value) => ['id', 'paragraphId', 'cellId', 'rowId', 'tableId', 'cellIds'].includes(key) ? undefined : value));
  expect(geometry(render(await DocxPackage.open(edited)))).toEqual(geometry(changed));
  doc.undo(); expect(render(doc)).toEqual(original);
  const restored = unzipSync(await save()); expect(Object.keys(restored).sort()).toEqual(Object.keys(source).sort());
  for (const name of Object.keys(source)) expect(Buffer.from(restored[name]).equals(Buffer.from(source[name])), name).toBe(true);
});

it.each(['row-oversized-headers-14', 'row-oversized-headers-15', 'row-merged-oversized-14', 'row-merged-oversized-15', 'row-merged-exact-oversized-14', 'row-merged-exact-oversized-15'])('preserves existing row layout with empty page stories: %s', async name => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/row-geometry/${name}-probe.docx`));
  const args = [pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables];
  expect(layoutDocument(...args, { sections: [{ header: {}, footer: {} }], stories: {} })).toEqual(layoutDocument(...args));
});

it.each([14, 15])('keeps continued table text and repeated rows inside story bounds in mode %s', async compatibilityMode => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/table-headers.docx'));
  const geometry = pageGeometry({ ...pkg.pageSettings, header: pkg.pageSettings.top, compatibilityMode });
  const result = layoutDocument(pkg.paragraphs, measure, geometry, pkg.numbering, pkg.tables, definition);
  const stories = layoutPageStories(result, definition, [{ ...pkg.pageSettings, header: pkg.pageSettings.top }], measure, pkg.numbering);
  expect(result.pageCount).toBeGreaterThan(2);
  expect(result.repeatedLines.length).toBeGreaterThan(0);
  for (const line of [...result.lines, ...result.repeatedLines]) {
    const header = stories.lines.find(h => h.page === line.page);
    expect(line.y).toBeGreaterThanOrEqual(header.y + header.height - 1e-6);
    if (line.cellId) {
      const cell = result.cells.find(c => c.id === line.cellId && c.page === line.page);
      expect(line.y).toBeGreaterThanOrEqual(cell.y - 1e-6);
      expect(line.y + line.height).toBeLessThanOrEqual(cell.y + cell.height + 1e-6);
    }
  }
});
