import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { StorySession } from '../src/engine/story-session.js';
import { drawingImageCorrespondence } from '../src/engine/drawing-image-correspondence.js';
import { drawingTextFrames } from '../src/engine/drawing-text-edit.js';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const source = () => readFileSync('tests/fixtures/drawing-text-image-alias/control.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const branches = shell => [...new DOMParser().parseFromString(shell, 'application/xml').getElementsByTagNameNS(MC, 'AlternateContent')[0].children];
const refs = branch => [...branch.getElementsByTagName('*')].flatMap(n => [...n.attributes].filter(a => a.namespaceURI === R && a.localName === 'embed').map(a => a.value));

it('keeps exact source correspondence independent of image resource resolution', async () => {
  const pkg = await DocxPackage.open(source());
  const image = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  const exact = { ...image, shell: image.shell.replaceAll('rPngAlias', 'rPng').replaceAll('rSvgAlias', 'rSvg') };
  let resolutions = 0;
  const frames = drawingTextFrames(exact, pkg.assets[image.assetId], () => { resolutions++; return undefined; });
  expect(frames[0].reason).toBeNull();
  expect(frames[0].contents).toHaveLength(2);
  expect(resolutions).toBe(0);
}, 60000);

it('matches identical image parts but retains each branch reference through rich edits and picture geometry changes', async () => {
  const bytes = source(), parts = unzipSync(bytes), pkg = await DocxPackage.open(bytes);
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets), session = new StorySession(model);
  const position = model.text.indexOf('\ufffc'); model.select(position, position + 1);
  const image = model.selectedImage, frame = pkg.drawingTextFrames(image)[0]; expect(frame.reason).toBeNull();
  expect(drawingTextFrames(image, pkg.assets[image.assetId])[0].reason).toContain('differ');
  const draft = new TextDocument(frame.paragraphs, undefined, pkg.numbering, pkg.styles, frame.tables, pkg.assets);
  const text = draft.text.indexOf('Before'); draft.select(text, text + 6); draft.replace('Edited');
  const picture = draft.text.indexOf('\ufffc'); draft.select(picture, picture + 1); draft.setImageProperties({ width: 342900, height: 342900, alt: 'Edited original square', flipH: true });
  draft.moveImage(draft.text.length);
  const prepared = pkg.prepareDrawingTextEdit(image, 0, draft.paragraphs, model.assets, pkg.styles, pkg.numbering, draft.tables);
  expect(branches(prepared.shell).map(refs)).toEqual([['rPng', 'rSvg'], ['rPngAlias', 'rSvgAlias']]);
  const texts = branches(prepared.shell).map(b => [...b.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join(''));
  expect(texts[0]).toBe(texts[1]); expect(texts[0]).toContain('Edited');
  for (const b of branches(prepared.shell)) {
    const extent = b.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
    // The active outer frame has its own extent before the nested picture.
    const extents = [...b.getElementsByTagNameNS(extent.namespaceURI, 'extent')];
    expect(extents.at(-1).getAttribute('cx')).toBe('342900');
  }
  model.assets.aliasEdit = prepared.asset; session.run(() => model.replaceDrawingText(image, 'aliasEdit', prepared.shell));
  const save = async () => new Uint8Array(await session.export(pkg).arrayBuffer());
  const saved = await save(), reopened = await DocxPackage.open(saved);
  expect(reopened.drawingTextFrames(reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).image)[0].reason).toBeNull();
  for (const name of Object.keys(parts).filter(n => n !== 'word/document.xml')) expect(unzipSync(saved)[name]).toEqual(parts[name]);
  session.undo(); expect(unzipSync(await save())).toEqual(parts); session.redo(); expect(unzipSync(await save())).toEqual(unzipSync(saved));
}, 60000);

it('guards differing image bytes, MIME declarations, missing, duplicate, external and non-image relationships', async () => {
  const parts = unzipSync(source());
  const changed = { ...parts, 'word/media/alias.svg': strToU8(strFromU8(parts['word/media/alias.svg']).replace('#f0281e', '#0028f0')) };
  const pkg = await DocxPackage.open(zipSync(changed)), image = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(pkg.drawingTextFrames(image)[0].reason).toContain('differ');
  for (const replacement of ['TargetMode="External" Target="https://example.invalid/image.svg"', 'Target="media/missing.svg"', 'Type="other" Target="media/alias.svg"']) {
    const modified = { ...parts, 'word/_rels/document.xml.rels': strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace(/Type="[^"]+" Target="media\/alias.svg"/, replacement)) };
    expect(drawingImageCorrespondence(modified, 'word/document.xml')('rSvgAlias')).toBeUndefined();
  }
  const duplicate = { ...parts, 'word/_rels/document.xml.rels': strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('</Relationships>', '<Relationship Id="rSvgAlias" Type="other" Target="media/alias.svg"/></Relationships>')) };
  expect(drawingImageCorrespondence(duplicate, 'word/document.xml')('rSvgAlias')).toBeUndefined();
  const badType = { ...parts, '[Content_Types].xml': strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/svg+xml', 'application/octet-stream')) };
  expect(drawingImageCorrespondence(badType, 'word/document.xml')('rSvgAlias')).toBeUndefined();
  const key = drawingImageCorrespondence(parts, 'word/document.xml');
  expect(key('rSvgAlias')).toBe(key('rSvg')); expect(key('rPngAlias')).toBe(key('rPng')); expect(key('rSvg')).not.toBe(key('rPng'));
  expect(drawingImageCorrespondence(parts, 'word/header1.xml')('rSvg')).toBeUndefined();
}, 60000);

it('resolves header aliases against their owning relationship part and preserves body/header resource ownership', async () => {
  const bytes = readFileSync('tests/fixtures/drawing-text-image-alias/header.docx'), parts = unzipSync(bytes);
  const pkg = await DocxPackage.open(bytes), model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets), session = new StorySession(model, pkg.pageStories);
  const story = session.activate('word/header1.xml'); story.select(0, 1);
  const image = story.selectedImage, frame = pkg.drawingTextFrames(image, model.assets)[0]; expect(frame.reason).toBeNull();
  const draft = new TextDocument(frame.paragraphs, undefined, pkg.numbering, pkg.styles, frame.tables, pkg.assets);
  draft.select(0, 10); draft.replace('Updated');
  const edit = pkg.prepareDrawingTextEdit(image, 0, draft.paragraphs, model.assets, pkg.styles, pkg.numbering, draft.tables);
  expect(branches(edit.shell).map(refs)).toEqual([['rPng', 'rSvg'], ['rPngAlias', 'rSvgAlias']]);
  model.assets.headerAliasEdit = edit.asset; session.run(() => story.replaceDrawingText(image, 'headerAliasEdit', edit.shell));
  const output = new Uint8Array(await session.export(pkg).arrayBuffer()), saved = unzipSync(output);
  for (const name of Object.keys(parts).filter(n => n !== 'word/header1.xml')) expect(saved[name]).toEqual(parts[name]);
  const reopened = await DocxPackage.open(output), picture = reopened.pageStories.stories['word/header1.xml'].paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(reopened.drawingTextFrames(picture)[0].reason).toBeNull();
  session.undo(); expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(parts);
  const scoped = { ...parts, 'word/_rels/header1.xml.rels': strToU8(strFromU8(parts['word/_rels/header1.xml.rels']).replace('media/alias.svg', 'media/missing.svg')) };
  const guarded = await DocxPackage.open(zipSync(scoped)), headerImage = guarded.pageStories.stories['word/header1.xml'].paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  expect(guarded.drawingTextFrames(headerImage)[0].reason).toContain('differ');
}, 60000);

it('retains untouched controlled picture markup when only neighboring text changes', async () => {
  const pkg = await DocxPackage.open(readFileSync('tests/fixtures/drawing-text-image-alias/controlled.docx'));
  const image = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image).image, frame = pkg.drawingTextFrames(image)[0];
  expect(frame.reason).toBeNull();
  const draft = new TextDocument(frame.paragraphs, undefined, pkg.numbering, pkg.styles, frame.tables, pkg.assets);
  const at = draft.text.indexOf('Before'); draft.select(at, at + 6); draft.replace('Edited');
  const prepared = pkg.prepareDrawingTextEdit(image, 0, draft.paragraphs, pkg.assets, pkg.styles, pkg.numbering, draft.tables);
  expect(branches(prepared.shell).map(b => b.getElementsByTagNameNS(W, 'sdt')[0].getElementsByTagNameNS(W, 'r')[0].getAttributeNS(W, 'rsidR'))).toEqual(['11223344', '11223344']);
  expect(branches(prepared.shell).map(refs)).toEqual([['rPng', 'rSvg'], ['rPngAlias', 'rSvgAlias']]);
}, 60000);
