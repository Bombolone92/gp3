import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { drawingPageContexts } from '../src/engine/shape-page-fields.js';
import { pageNumberSequence } from '../src/engine/page-numbering.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/continuous-numbering-recovery/${name}.docx`);
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize * .25 });
const layout = (pkg, bestEffort = false, metrics = measure) => layoutDocument(pkg.paragraphs, metrics, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });
const stories = (pkg, body) => layoutPageStories(body, pkg.pageStories, [...pkg.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), pkg.pageSettings], measure, pkg.numbering, { bestEffort: true });

it.each(['restart-zero', 'restart-even', 'restart-odd', 'combined'])('retains rich layout and continued page fields for %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes, { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, pageStories: pkg.pageStories, settings: pkg.pageSettings, tables: pkg.tables });
  expect(() => layout(pkg)).toThrow('Page-number restarts in continuous sections');
  const recovered = layout(pkg, true), expected = layout(control);
  // IDs differ between independent imports; compare the visible measurements.
  const visible = body => ({ pages: body.pageCount, owners: body.pageSections, lines: body.lines.map(l => ({ page: l.page, x: l.x, y: l.y, height: l.height, fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width })) })), cells: body.cells.map(c => ({ page: c.page, x: c.x, y: c.y, width: c.width, height: c.height })) });
  expect(visible(recovered)).toEqual(visible(expected));
  const text = result => result.lines.map(l => ({ page: l.page, text: l.fragments.map(f => f.text || '').join(''), y: l.y }));
  expect(text(stories(pkg, recovered))).toEqual(text(stories(control, expected)));
  expect(text(stories(pkg, recovered)).map(l => l.text)).toEqual(['Retained header page 1', 'Retained header page 2', 'Retained header page 7']);
  expect(pageNumberSequence(recovered.pageSections, pkg.pageStories, recovered.numberingApproximations)).toEqual([1, 2, 7]);
  expect(drawingPageContexts(recovered, pkg.pageStories).map(c => c.pageNumber)).toEqual([1, 2, 7]);
  expect(recovered.numberingApproximations.map(a => a.section)).toEqual([1]);
  expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, pageStories: pkg.pageStories, settings: pkg.pageSettings, tables: pkg.tables })).toBe(before);
  const original = unzipSync(bytes);
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(() => layout(pkg, true, () => { throw new Error('measurement failure'); })).toThrow('measurement failure');
});

it.each(['healthy', 'paper-change', 'next-page'])('keeps supported restarts and physical page transitions strict: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  const actual = layout(pkg);
  expect(actual.numberingApproximations).toBeUndefined();
  if (name !== 'healthy') expect(pageNumberSequence(actual.pageSections, pkg.pageStories)).toContain(10);
  const original = unzipSync(bytes), exported = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(original)) expect(Buffer.from(exported[part]).equals(Buffer.from(original[part])), part).toBe(true);
});
