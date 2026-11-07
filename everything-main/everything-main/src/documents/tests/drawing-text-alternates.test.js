import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { StorySession } from '../src/engine/story-session.js';
import { drawingTextSourceKey } from '../src/engine/drawing-text-edit.js';
import { MC } from '../src/engine/docx-compatibility.js';
import { layoutShapeText } from '../src/engine/shape-text-layout.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const root = 'tests/fixtures/drawing-text-alternates/';
const read = name => readFileSync(root + name);
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const parse = shell => new DOMParser().parseFromString(shell, 'application/xml');
const text = node => [...node.getElementsByTagNameNS(W, 'p')].map(p => [...p.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('')).join('\n');
it('binds native branch synchronization to the original owned control', () => {
  for (const [name, digest] of Object.entries(JSON.parse(read('hashes.json')))) expect(createHash('sha256').update(read(name)).digest('hex')).toBe(digest);
  const reference = JSON.parse(read('native-edits.json').toString().replace(/^\uFEFF/, ''));
  expect(createHash('sha256').update(read('control.docx')).digest('hex')).toBe(reference.sourceSha256);
  expect(reference.sourceUnchanged).toBe(true);
  const doc = parse(new TextDecoder().decode(unzipSync(read('native-edited.docx'))['word/document.xml']));
  const alternates = [...doc.getElementsByTagNameNS(MC, 'AlternateContent')];
  expect(alternates).toHaveLength(2);
  expect(alternates.map(ac => [...ac.children].map(branch => [...branch.getElementsByTagNameNS(W, 'txbxContent')].map(text)))).toEqual([
    [['Updated title\nOriginal second paragraph'], ['Updated title\nOriginal second paragraph']],
    [['Revised grouped title\nOriginal second paragraph', 'Right grouped title\nOriginal second paragraph'], ['Revised grouped title\nOriginal second paragraph', 'Right grouped title\nOriginal second paragraph']],
  ]);
});
for (const name of ['control.docx', 'native-edited.docx']) it(`edits uniquely corresponding text in every alternate branch and undoes: ${name}`, async () => {
  const pkg = await DocxPackage.open(read(name)); expect(pkg.readOnly).toBeFalsy();
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets), session = new StorySession(model);
  const source = unzipSync(read(name));
  expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(source);
  const positions = []; let offset = 0;
  for (const p of model.paragraphs) { for (const r of p.runs) { if (r.image) positions.push(offset); offset += r.text.length; } offset++; }
  for (let drawing = 0; drawing < positions.length; drawing++) {
    model.select(positions[drawing], positions[drawing] + 1); const image = model.selectedImage;
    const frame = drawing ? 1 : 0, descriptor = pkg.drawingTextFrames(image, model.assets)[frame]; expect(descriptor.reason).toBeNull();
    const draft = new TextDocument(descriptor.paragraphs, undefined, pkg.numbering, pkg.styles);
    draft.select(0, drawing ? 5 : name === 'control.docx' ? 10 : 7); draft.replace(drawing ? 'Other' : 'Edited');
    const prepared = pkg.prepareDrawingTextEdit(image, frame, draft.paragraphs, model.assets);
    const doc = parse(prepared.shell), ac = doc.getElementsByTagNameNS(MC, 'AlternateContent')[0];
    if (ac) {
      const content = [...ac.children].map(branch => [...branch.getElementsByTagNameNS(W, 'txbxContent')]);
      for (const branch of content) expect(branch.map(text)).toEqual(content[0].map(text));
      const expected = drawing ? 'Other grouped title' : 'Edited title';
      expect(content[0].map(text).some(t => t.startsWith(expected))).toBe(true);
      if (drawing) expect(text(content[0][0])).toBe('Revised grouped title\nOriginal second paragraph');
    }
    const id = `edit:${drawing}`; model.assets[id] = prepared.asset;
    session.run(() => model.replaceDrawingText(image, id, prepared.shell));
  }
  const bytes = new Uint8Array(await session.export(pkg).arrayBuffer()), saved = unzipSync(bytes);
  expect((await DocxPackage.open(bytes)).readOnly).toBeFalsy();
  expectBodyEditParts(saved, source);
  expect(Object.keys(saved).some(p => p.startsWith('word/fonts/'))).toBe(false);
  session.undo(); session.undo(); expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(source);
  session.redo(); session.redo(); expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(saved);
}, 30000);
it('guards stale formatting and repeated indistinguishable source frames', async () => {
  const pkg = await DocxPackage.open(read('native-edited.docx'));
  const images = pkg.paragraphs.flatMap(p => p.runs).filter(r => r.image).map(r => r.image);
  const stale = parse(images[0].shell), fallback = stale.getElementsByTagNameNS(MC, 'Fallback')[0];
  fallback.getElementsByTagNameNS(W, 'b')[0].remove();
  const changed = { ...images[0], shell: new XMLSerializer().serializeToString(stale) };
  expect(pkg.drawingTextFrames(changed)[0].reason).toContain('differ');
  expect(() => pkg.prepareDrawingTextEdit(changed, 0, pkg.drawingTextFrames(changed)[0].paragraphs)).toThrow('differ');
  const duplicate = parse(images[1].shell);
  for (const branch of duplicate.documentElement.children) {
    const frames = branch.getElementsByTagNameNS(W, 'txbxContent');
    frames[1].replaceChildren(...[...frames[0].childNodes].map(n => n.cloneNode(true)));
  }
  expect(pkg.drawingTextFrames({ ...images[1], shell: new XMLSerializer().serializeToString(duplicate) }).every(f => f.reason?.includes('ambiguous'))).toBe(true);
}, 30000);
it('compares namespaces/properties/runs/spaces, independent of prefix and indentation', () => {
  const a = parse(`<w:txbxContent xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve"> A </w:t></w:r></w:p></w:txbxContent>`).documentElement;
  const b = parse(`<z:txbxContent xmlns:z="${W}">\n <z:p><z:r><z:t xml:space="preserve"> A </z:t></z:r></z:p>\n</z:txbxContent>`).documentElement;
  expect(drawingTextSourceKey(a)).toBe(drawingTextSourceKey(b));
  b.getElementsByTagNameNS(W, 't')[0].textContent = 'A'; expect(drawingTextSourceKey(a)).not.toBe(drawingTextSourceKey(b));
});
it('keeps invisible line text-frame insets while editing and after reopening', async () => {
  const parts = unzipSync(read('control.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll('<a:ln>', '<a:ln w="25400">'));
  const pkg = await DocxPackage.open(zipSync(parts)), model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const position = model.text.indexOf('\ufffc'); model.select(position, position + 1); const image = model.selectedImage;
  const scene = pkg.assets[image.assetId].scene, measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize * .2 });
  const before = layoutShapeText(scene, measure); expect(before.left).toBeCloseTo(9.333333333, 7);
  const draft = new TextDocument(pkg.drawingTextFrames(image)[0].paragraphs, undefined, pkg.numbering, pkg.styles); draft.select(0, 10); draft.replace('Updated');
  const prepared = pkg.prepareDrawingTextEdit(image, 0, draft.paragraphs);
  expect(layoutShapeText(prepared.asset.scene, measure).left).toBe(before.left);
  expect(layoutShapeText(prepared.asset.scene, measure).clip).toEqual(before.clip);
  model.assets.edited = prepared.asset; model.replaceDrawingText(image, 'edited', prepared.shell);
  const reopened = await DocxPackage.open(new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer()));
  const savedImage = reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(layoutShapeText(reopened.assets[savedImage.assetId].scene, measure).left).toBe(before.left);
}, 30000);
