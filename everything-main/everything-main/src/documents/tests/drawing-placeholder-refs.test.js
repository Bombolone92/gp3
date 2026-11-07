import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { StorySession } from '../src/engine/story-session.js';
import { drawingTextSourceKey } from '../src/engine/drawing-text-edit.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const branches = text => [...parse(text).getElementsByTagNameNS(MC, 'AlternateContent')[0].children].map(b => b.getElementsByTagNameNS(W, 'txbxContent')[0]);
const refs = stories => stories.map(s => s.getElementsByTagNameNS(W, 'docPart')[0]?.getAttributeNS(W, 'val'));
async function setup() {
  const bytes = readFileSync('tests/fixtures/drawing-placeholder-refs/temporary.docx'), pkg = await DocxPackage.open(bytes);
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets), session = new StorySession(model);
  const at = model.text.indexOf('\ufffc'); model.select(at, at + 1);
  const image = model.selectedImage, frame = pkg.drawingTextFrames(image)[0];
  expect(frame.reason).toBeNull();
  const draft = new TextDocument(frame.paragraphs, undefined, pkg.numbering, pkg.styles, frame.tables);
  const apply = () => {
    const prepared = pkg.prepareDrawingTextEdit(image, 0, draft.paragraphs, model.assets, pkg.styles, pkg.numbering, draft.tables);
    model.assets['placeholder-edit'] = prepared.asset;
    session.run(() => model.replaceDrawingText(image, 'placeholder-edit', prepared.shell));
    return prepared;
  };
  const save = async () => new Uint8Array(await session.export(pkg).arrayBuffer());
  return { bytes, pkg, model, session, draft, apply, save };
}

it('retains each temporary placeholder reference during formatting and exact undo', async () => {
  const { bytes, draft, apply, save, session } = await setup(), original = unzipSync(bytes);
  expect(unzipSync(await save())).toEqual(original);
  draft.select(0, 'Standalone title'.length); draft.setRunFormat({ italic: true });
  const prepared = apply(), stories = branches(prepared.shell);
  expect(refs(stories)).toEqual(['ModernPrompt', 'LegacyPrompt']);
  expect(stories.map(s => s.getElementsByTagNameNS(W, 'showingPlcHdr').length)).toEqual([1, 1]);
  // The run is italic, and so is the paragraph mark: all paragraph text was selected (model.js setRunFormat).
  const italic = (s, parent) => [...s.getElementsByTagNameNS(W, 'i')].filter(i => i.parentElement.parentElement.localName === parent).length;
  expect(stories.map(s => [italic(s, 'r'), italic(s, 'pPr')])).toEqual([[1, 1], [1, 1]]);
  const saved = await save(), reopened = await DocxPackage.open(saved);
  const image = reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(reopened.drawingTextFrames(image)[0].reason).toBeNull();
  for (const name of Object.keys(original).filter(n => n !== 'word/document.xml')) expect(unzipSync(saved)[name]).toEqual(original[name]);
  session.undo(); expect(unzipSync(await save())).toEqual(original);
  session.redo(); expect(unzipSync(await save())).toEqual(unzipSync(saved));
}, 60000);

it('expires temporary wrappers on content edits in both branches and preserves exact undo', async () => {
  const { bytes, draft, apply, save, session } = await setup();
  draft.select(0, 'Standalone title'.length); draft.replace('Filled title');
  const stories = branches(apply().shell);
  expect(stories.map(s => s.getElementsByTagNameNS(W, 'sdt').length)).toEqual([0, 0]);
  expect(stories.map(s => [...s.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join(''))).toEqual(['Filled titleOriginal second paragraph', 'Filled titleOriginal second paragraph']);
  const saved = await save(), reopened = await DocxPackage.open(saved);
  const image = reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(reopened.drawingTextFrames(image)[0].reason).toBeNull();
  session.undo(); expect(unzipSync(await save())).toEqual(unzipSync(bytes));
}, 60000);

it('keeps persistent placeholder definitions, false/invalid temporary flags, and other semantics distinct', async () => {
  const bytes = readFileSync('tests/fixtures/drawing-placeholder-refs/persistent.docx'), pkg = await DocxPackage.open(bytes);
  const image = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(pkg.drawingTextFrames(image)[0].reason).toContain('differ');
  const xml = strFromU8(unzipSync(readFileSync('tests/fixtures/drawing-placeholder-refs/temporary.docx'))['word/document.xml']);
  const [a, b] = branches(xml);
  expect(drawingTextSourceKey(a)).not.toBe(drawingTextSourceKey(b));
  expect(drawingTextSourceKey(a, undefined, true)).toBe(drawingTextSourceKey(b, undefined, true));
  const temporary = b.getElementsByTagNameNS(W, 'temporary')[0];
  for (const flag of ['false', '0', 'off', 'invalid']) {
    temporary.setAttributeNS(W, 'w:val', flag);
    expect(drawingTextSourceKey(a, undefined, true)).not.toBe(drawingTextSourceKey(b, undefined, true));
  }
  temporary.removeAttributeNS(W, 'val');
  b.getElementsByTagNameNS(W, 'docPart')[0].setAttribute('unknown', '1');
  expect(drawingTextSourceKey(a, undefined, true)).not.toBe(drawingTextSourceKey(b, undefined, true));
  b.getElementsByTagNameNS(W, 'docPart')[0].removeAttribute('unknown');
  b.getElementsByTagNameNS(W, 'id')[0].setAttributeNS(W, 'w:val', '502');
  expect(drawingTextSourceKey(a, undefined, true)).not.toBe(drawingTextSourceKey(b, undefined, true));
  b.getElementsByTagNameNS(W, 'id')[0].setAttributeNS(W, 'w:val', '501');
  const reference = b.getElementsByTagNameNS(W, 'docPart')[0];
  reference.setAttributeNS(W, 'w:val', '');
  expect(drawingTextSourceKey(a, undefined, true)).not.toBe(drawingTextSourceKey(b, undefined, true));
  reference.setAttributeNS(W, 'w:val', 'LegacyPrompt');
  b.getElementsByTagNameNS(W, 't')[0].textContent = 'Different cached prompt';
  expect(drawingTextSourceKey(a, undefined, true)).not.toBe(drawingTextSourceKey(b, undefined, true));
});
