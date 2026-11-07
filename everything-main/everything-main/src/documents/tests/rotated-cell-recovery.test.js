import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = name => readFileSync(`tests/fixtures/rotated-cell-recovery/${name}.docx`);
const measure = text => ({ width: text.length * 6, ascent: 10, descent: 3 });
const place = (pkg, bestEffort) => layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });
const geometry = lines => lines.map(l => ({ page: l.page, x: l.x, y: l.y, baseline: l.baseline, height: l.height,
  rotation: l.cellText?.matrix, fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width })) }));

it.each(['before', 'after', 'both', 'nested', 'stories'])('contains %s rotation failures and preserves the original package', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes);
  const control = await DocxPackage.open(source(`${name}-control`));
  const originalModel = JSON.stringify(pkg.tables);
  expect(() => place(pkg, false)).toThrow(/rotated|terminal marks/i);
  const result = place(pkg, true), expected = place(control, false);
  expect(result.pageCount).toBe(expected.pageCount);
  expect(geometry(result.lines)).toEqual(geometry(expected.lines));
  expect(result.lines.some(l => l.cellText)).toBe(true);
  if (name !== 'stories') {
    expect(result.rotatedCellApproximations).toHaveLength(name === 'both' ? 2 : 1);
    for (const item of result.rotatedCellApproximations) {
      expect(item.cellId).toBeTruthy(); expect(item.message).toContain('shown horizontally');
      expect(result.lines.filter(l => l.cellId === item.cellId).every(l => !l.cellText)).toBe(true);
    }
  } else {
    const story = layoutPageStories(result, pkg.pageStories, [pkg.pageSettings], measure, pkg.numbering, { bestEffort: true });
    const matched = layoutPageStories(expected, control.pageStories, [control.pageSettings], measure, control.numbering);
    expect(geometry(story.lines)).toEqual(geometry(matched.lines));
    expect(story.lines.some(l => l.cellText)).toBe(true);
    expect(story.unsupported.length).toBeGreaterThan(0);
    expect(story.unsupported.every(i => i.message.includes('shown horizontally'))).toBe(true);
  }
  expect(JSON.stringify(pkg.tables)).toBe(originalModel);
  expect(pkg.parts).toEqual(unzipSync(bytes));
});
