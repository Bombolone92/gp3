import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { positionedImageFrame } from '../src/engine/positioned-images.js';
import { DRAWING_DASHES } from '../src/engine/drawing-line-dashes.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/header-drawings.docx');
const bodySource = readFileSync('public/fixtures/header-drawings-body.docx');
const measure = text => ({ width: text.length * 8, ascent: 12, descent: 4 });
const header = 'word/stories/header.xml', footer = 'word/stories/footer.xml';
const images = story => story.paragraphs.flatMap(p => p.runs.flatMap(r => r.image ? [r.image] : []));
const save = async (pkg, model) => unzipSync(new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer()));
function change(bytes, path, edit) {
  const parts = unzipSync(bytes); parts[path] = strToU8(edit(strFromU8(parts[path]))); return zipSync(parts);
}

it('resolves nested story-relative targets without borrowing the body relationship with the same ID', async () => {
  const pkg = await DocxPackage.open(source, { bestEffort: true });
  expect(pkg.readOnly).not.toBe(true);
  expect(images(pkg.pageStories.stories[header]).map(i => i.assetId)).toEqual([`${header}:drawing:10`, 'word/media/green.png']);
  expect(images(pkg.pageStories.stories[footer]).map(i => i.assetId)).toEqual(['word/media/blue.png', `${footer}:drawing:21`]);
  expect(images(pkg).map(i => i.assetId)).toEqual(['word/media/red.png']);
  expect(pkg.assets[`${header}:drawing:10`].scene.children.slice(0, 11).map(n => DRAWING_DASHES[n.outline.dash || 'solid'])).toEqual([
    [], [1, 3], [4, 3], [8, 3], [4, 3, 1, 3], [8, 3, 1, 3], [8, 3, 1, 3, 1, 3], [3, 1], [1, 1], [3, 1, 1, 1], [3, 1, 1, 1, 1, 1],
  ]); // Native reference PDF d operands divided by its 2 pt pen width.
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(pkg.parts);
  expect(pkg.parts).toEqual(unzipSync(source));
});

it('retains story drawings through body repagination, save/reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(source), model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const storyState = structuredClone(pkg.pageStories);
  const render = (p, d) => {
    const body = layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables, p.pageStories);
    return layoutPageStories(body, p.pageStories, [d.pageSettings], measure, d.numbering, { styles: d.styles });
  };
  const before = render(pkg, model);
  model.select(0); model.replace('Added page\f');
  const changed = render(pkg, model);
  expect(new Set(changed.lines.map(l => l.page)).size).toBe(4);
  expect(changed.floatingObjects.filter(o => o.pageStory === header)).toHaveLength(4);
  expect(pkg.pageStories).toEqual(storyState);
  const edited = await save(pkg, model);
  for (const [name, bytes] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(edited[name], name).toEqual(bytes);
  const reopened = await DocxPackage.open(zipSync(edited));
  expect(reopened.assets).toEqual(pkg.assets);
  const again = new TextDocument(reopened.paragraphs, reopened.pageSettings, reopened.numbering, reopened.styles, reopened.tables, reopened.assets);
  expect(render(reopened, again).floatingObjects.map(o => [o.page,o.x,o.y,o.width,o.height])).toEqual(changed.floatingObjects.map(o => [o.page,o.x,o.y,o.width,o.height]));
  model.undo(); expect(render(pkg, model)).toEqual(before); expect(await save(pkg, model)).toEqual(pkg.parts);
});

it('repeats page-relative drawings without adding the header offset, and translates paragraph-relative footer drawings', async () => {
  const pkg = await DocxPackage.open(source, { bestEffort: true });
  const body = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering);
  const before = structuredClone(body);
  const stories = layoutPageStories(body, pkg.pageStories, [pkg.pageSettings], measure, pkg.numbering);
  expect(stories.floatingObjects.filter(o => o.pageStory === header).map(({ page, x, y, width, height }) => ({ page, x, y, width, height }))).toEqual(
    [0, 1, 2].map(page => ({ page, x: 0, y: 0, width: 816, height: 1056 })),
  );
  for (const object of stories.floatingObjects.filter(o => o.pageStory === footer)) {
    const line = stories.lines.find(l => l.pageStory === footer && l.page === object.page);
    expect(object.x).toBe(192); expect(object.y).toBe(line.y);
  }
  expect(body).toEqual(before);
  expect(body.floatingObjects).toEqual([]);
});

it('preserves body drawing XML and unrelated story parts through surrounding edits, reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(bodySource);
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  expect(await save(pkg, model)).toEqual(pkg.parts);
  model.select(0); model.replace('Edited ');
  const edited = await save(pkg, model);
  for (const [path, bytes] of Object.entries(pkg.parts)) if (path !== 'word/document.xml') expect(edited[path]).toEqual(bytes);
  const reopened = await DocxPackage.open(zipSync(edited));
  expect(images(reopened)[0].anchor.relativeSize).toEqual({ width: { base: 'page', percentage: 100000 }, height: { base: 'page', percentage: 100000 } });
  expect(reopened.assets['drawing:10'].scene).toEqual(pkg.assets['drawing:10'].scene);
  model.undo(); expect(await save(pkg, model)).toEqual(pkg.parts);
});

it('computes relative dimensions from each page geometry, including margin percentages and retained zero placeholders', async () => {
  const changed = change(bodySource, 'word/document.xml', xml => xml.replace('relativeFrom="page"><wp14:pctWidth>100000', 'relativeFrom="margin"><wp14:pctWidth>50%').replace('<wp14:pctHeight>100000', '<wp14:pctHeight>0.0%'));
  const pkg = await DocxPackage.open(changed), image = images(pkg)[0];
  expect(image.anchor.relativeSize).toEqual({ width: { base: 'margin', percentage: 50000 } });
  const frame = positionedImageFrame({ image }, { page: 0, y: 24 }, pageGeometry(pkg.pageSettings));
  expect(frame.width).toBe(312); expect(frame.height).toBe(1056);
  const landscape = { ...pageGeometry(pkg.pageSettings), width: 1056, height: 816 };
  expect(positionedImageFrame({ image }, { page: 1, y: 24 }, landscape).width).toBe(432);
});

it.each(['-1', 'banana', '0.00001%', '2147483648'])('rejects invalid relative size %s before editable import', async raw => {
  await expect(DocxPackage.open(change(bodySource, 'word/document.xml', xml => xml.replace('<wp14:pctWidth>100000', `<wp14:pctWidth>${raw}`)))).rejects.toThrow();
});

it('does not fall back to a body image when a story-local relationship is missing or external', async () => {
  for (const edit of [xml => xml.replace('Id="paint"', 'Id="missing"'), xml => xml.replace('Target="../media/green.png"', 'TargetMode="External" Target="https://example.invalid/image.png"')]) {
    const bytes = change(source, 'word/stories/_rels/header.xml.rels', edit);
    const pkg = await DocxPackage.open(bytes, { bestEffort: true });
    expect(pkg.readOnly).toBe(true);
    expect(() => pkg.export()).toThrow(/read-only/);
    expect(pkg.parts).toEqual(unzipSync(bytes));
    expect(images(pkg.pageStories.stories[header]).map(i => i.assetId)).toEqual([`${header}:drawing:10`, 'preview:unsupported-drawing']);
    expect(images(pkg).map(i => i.assetId)).toEqual(['word/media/red.png']);
  }
});

it.each([
  ['relative', 0, 814, 1054],
  ['fixed', -1, 816, 1056],
])('matches the native reference effect bounds for a %s centered anchor', async (mode, x, width, height) => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/header-drawings-${mode}-effects.docx`), { bestEffort: true });
  const image = images(pkg.pageStories.stories[header])[0];
  const frame = positionedImageFrame({ image }, { page: 0, y: 24 }, pageGeometry(pkg.pageSettings));
  expect(frame).toMatchObject({ x, y: 0, width, height });
  // The native reference vertical line is at 305.25 pt in both controls.
  expect((frame.x + frame.width / 2) * .75).toBe(305.25);
});
