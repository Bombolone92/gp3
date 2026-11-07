import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { projectRetainedStoryControls } from '../src/engine/docx-content-controls.js';
const source = readFileSync('public/fixtures/retained-story-controls.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = text => ({ width: text.length * 7, ascent: 12, descent: 4 });
function render(d, stories) {
  const body = layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables, stories);
  return { body, stories: layoutPageStories(body, stories, [d.pageSettings], measure, d.numbering, { styles: d.styles }) };
}

it('retains locked block and inline story controls through body repagination, export and undo', async () => {
  const pkg = await DocxPackage.open(source);
  expect(pkg.readOnly).toBeFalsy();
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const before = render(doc, pkg.pageStories);
  expect(before.body.pageCount).toBe(2);
  const text = stories => stories.lines.filter(l => l.pageStory === 'word/footer.xml').map(l => l.fragments.filter(f => !f.image).map(f => f.text).join(''));
  expect(text(before.stories)).toEqual(['Page 1 of 2', 'Page 2 of 2']);
  // Control delimiter formatting must not become formatting of saved content.
  expect(before.stories.lines.flatMap(l => l.fragments).filter(f => !f.image).every(f => f.color !== '#FF0000')).toBe(true);
  const save = async () => unzipSync(new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer()));
  expect(await save()).toEqual(unzipSync(source));
  doc.select(0); doc.replace('Added paragraph words '.repeat(100));
  const changed = render(doc, pkg.pageStories), count = changed.body.pageCount;
  expect(count).toBeGreaterThan(2);
  expect(text(changed.stories)).toEqual(Array.from({ length: count }, (_, i) => `Page ${i + 1} of ${count}`));
  expect(changed.stories.floatingObjects).toHaveLength(count);
  const exported = await save(), original = unzipSync(source);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(exported[name], name).toEqual(original[name]);
  const reopened = await DocxPackage.open(zipSync(exported));
  expect(text(render(reopened, reopened.pageStories).stories)).toEqual(text(changed.stories));
  doc.undo(); expect(await save()).toEqual(original); expect(render(doc, pkg.pageStories)).toEqual(before);
});

it.each([
  ['missing contents', s => s.replaceAll('sdtContent', 'missingContent')],
  ['unknown wrapper child', s => s.replace('<w:sdtPr>', '<w:unknown/><w:sdtPr>')],
  ['unsupported saved formatting', s => s.replace('<w:t xml:space="preserve">Retained header', '<w:rPr><w:fitText w:val="2000"/></w:rPr><w:t xml:space="preserve">Retained header')],
  ['unsupported saved blocks', s => s.replace('<w:p>', '<w:tbl/><w:p>')],
])('still refuses editable import with %s', async (_, change) => {
  const parts = unzipSync(source); parts['word/header.xml'] = strToU8(change(strFromU8(parts['word/header.xml'])));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it('cannot project editable body controls through the retained-story entry point', () => {
  const root = new DOMParser().parseFromString('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'application/xml').documentElement;
  expect(() => projectRetainedStoryControls(root)).toThrow(/outside a retained page story/);
});
