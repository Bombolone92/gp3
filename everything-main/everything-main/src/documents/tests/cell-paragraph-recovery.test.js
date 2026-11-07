import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/cell-paragraph-recovery/${name}.docx`);
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize * .25 });
const layout = (pkg, bestEffort = false, metrics = measure) => layoutDocument(pkg.paragraphs, metrics, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });
const stories = (pkg, body, bestEffort = false) => layoutPageStories(body, pkg.pageStories, [pkg.pageSettings], measure, pkg.numbering, { bestEffort });
const visible = body => ({ lines: body.lines.map(l => ({ page: l.page, x: l.x, y: l.y, height: l.height, fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold, picture: !!f.image })) })), cells: body.cells.map(c => ({ page: c.page, x: c.x, y: c.y, width: c.width, height: c.height })) });

it.each(['first', 'second', 'inherited', 'story', 'combined'])('retains rich cell content around a rejected paragraph break: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow(name === 'combined' ? 'paragraph shading pattern' : 'paragraph page breaks inside table cells');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).toBe(true);
  // Reconstructing the display model must retain inherited properties and rich runs.
  new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, pageStories: pkg.pageStories, tables: pkg.tables });
  expect(() => layout(pkg)).toThrow(/[Pp]age breaks inside table cells/);
  const recovered = layout(pkg, true), expected = layout(control);
  expect(recovered.pageCount).toBe(2); expect(visible(recovered)).toEqual(visible(expected));
  const recoveredStories = stories(pkg, recovered, true);
  expect(recoveredStories.unsupported).toEqual([]);
  expect(visible(recoveredStories)).toEqual(visible(stories(control, expected)));
  const rich = [...pkg.paragraphs, ...pkg.pageStories.stories['word/header1.xml'].paragraphs].filter(p => p.cellId);
  expect(rich).toHaveLength(3);
  for (const p of rich) {
    expect(p.runs.some(r => r.image)).toBe(true);
    expect(p.runs.filter(r => r.text && !r.image).every(r => r.bold && r.fontSize === 18)).toBe(true);
  }
  expect(rich.some(p => p.format.pageBreakBefore)).toBe(true);
  expect(pkg.previewIssues.some(m => m.includes('paragraph page break is ignored'))).toBe(true);
  expect(pkg.previewIssues).not.toContain('paragraph page breaks inside table cells');
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, pageStories: pkg.pageStories, tables: pkg.tables })).toBe(before);
  const original = unzipSync(bytes);
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(() => pkg.export()).toThrow();
  expect(() => layout(pkg, true, () => { throw new Error('measurement failure'); })).toThrow('measurement failure');
});

it.each(['healthy', 'off'])('keeps supported cell content editable and preserves source bytes: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true); expect(layout(pkg).pageCount).toBe(2);
  const original = unzipSync(bytes), exported = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(original)) expect(Buffer.from(exported[part]).equals(Buffer.from(original[part])), part).toBe(true);
});
