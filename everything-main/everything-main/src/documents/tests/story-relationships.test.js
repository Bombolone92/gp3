import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { strToU8, strFromU8, zipSync } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { imageWriter, A, WP, R } from '../src/engine/docx-images.js';
import { hyperlinkWriter, hyperlinkReader } from '../src/engine/docx-hyperlinks.js';
import { relationshipPartPath, relativePartTarget } from '../src/engine/package-part-paths.js';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const source = readFileSync('public/fixtures/inline-images.docx');
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => strToU8(new XMLSerializer().serializeToString(doc));
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

it('calculates OPC paths without assuming the story is beside the body', () => {
  expect(relationshipPartPath('word/stories/header.xml')).toBe('word/stories/_rels/header.xml.rels');
  expect(relationshipPartPath('header.xml')).toBe('_rels/header.xml.rels');
  expect(relativePartTarget('word/stories/header.xml', 'word/media/picture.png')).toBe('../media/picture.png');
  expect(relativePartTarget('header.xml', 'word/media/picture.png')).toBe('word/media/picture.png');
  expect(relativePartTarget('word/header%201.xml', 'word/media/picture%201.png')).toBe('media/picture%201.png');
  for (const invalid of ['', '/header.xml', 'word/../header.xml', 'word//header.xml', 'word\\header.xml']) {
    expect(() => relationshipPartPath(invalid)).toThrow('Invalid package part path');
  }
});

for (const part of ['word/header1.xml', 'word/stories/header1.xml', 'header1.xml']) {
  it(`writes and reopens a picture under ${part} without editing body relationships`, async () => {
    const pkg = await DocxPackage.open(source), parts = { ...pkg.parts };
    const before = parts['word/_rels/document.xml.rels'];
    const original = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image && pkg.assets[r.image.assetId]?.bytes).image;
    const image = { ...original, id: 901, name: 'Original story control' };
    delete image.shell; delete image.relId;
    const doc = parse(`<w:hdr xmlns:w="${W}"/>`);
    const path = relationshipPartPath(part);
    const collision = `<Relationship Id="rImage1" Type="${R}/hyperlink" TargetMode="External" Target="https://example.org/retained"/>`;
    parts[path] = strToU8(`<Relationships xmlns="${REL}">${collision}</Relationships>`);
    const draw = imageWriter(parts, [{ runs: [{ image }] }], pkg.assets, doc, part)(image);
    const p = doc.createElementNS(W, 'w:p'), run = doc.createElementNS(W, 'w:r');
    run.append(draw); p.append(run); doc.documentElement.append(p); parts[part] = serialize(doc);
    expect(parts['word/_rels/document.xml.rels']).toBe(before);
    const rels = parse(strFromU8(parts[path]));
    const id = draw.getElementsByTagNameNS(A, 'blip')[0].getAttributeNS(R, 'embed');
    expect(id).toBe('rImage2');
    const created = [...rels.documentElement.children].find(r => r.getAttribute('Id') === id);
    expect(created.getAttribute('Target')).toBe(relativePartTarget(part, Object.keys(parts).find(name => name.startsWith('word/media/canvas-image'))));
    expect(rels.documentElement.firstElementChild.getAttribute('Target')).toBe('https://example.org/retained');

    // Add the authored story to the package and use the normal importer to
    // prove its image target resolves in the owning part's directory.
    const bodyRels = parse(strFromU8(before)), relation = bodyRels.createElementNS(REL, 'Relationship');
    for (const [key, value] of Object.entries({ Id: 'rStoryControl', Type: `${R}/header`, Target: relativePartTarget('word/document.xml', part) })) relation.setAttribute(key, value);
    bodyRels.documentElement.append(relation); parts['word/_rels/document.xml.rels'] = serialize(bodyRels);
    const types = parse(strFromU8(parts['[Content_Types].xml'])), type = types.createElementNS(TYPES, 'Override');
    type.setAttribute('PartName', '/' + part); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');
    types.documentElement.append(type); parts['[Content_Types].xml'] = serialize(types);
    const body = parse(strFromU8(parts['word/document.xml'])), ref = body.createElementNS(W, 'w:headerReference');
    ref.setAttributeNS(W, 'w:type', 'default'); ref.setAttributeNS(R, 'r:id', 'rStoryControl');
    body.getElementsByTagNameNS(W, 'sectPr')[0].prepend(ref); parts['word/document.xml'] = serialize(body);
    const reopened = await DocxPackage.open(zipSync(parts));
    const picture = reopened.pageStories.stories[part].paragraphs.flatMap(p => p.runs).find(r => r.image).image;
    expect(reopened.assets[picture.assetId].bytes).toEqual(pkg.assets[original.assetId].bytes);
    expect(picture.relId).toBe('rImage2');
  });
}

it('allocates drawing and text links in the same story without ID or body collisions', async () => {
  const pkg = await DocxPackage.open(source), parts = { ...pkg.parts };
  const part = 'word/footer1.xml', path = relationshipPartPath(part), before = parts['word/_rels/document.xml.rels'];
  parts[path] = strToU8(`<Relationships xmlns="${REL}"><Relationship Id="rDrawingLink1" Type="${R}/hyperlink" TargetMode="External" Target="https://example.org/old"/><Relationship Id="rLink1" Type="${R}/hyperlink" TargetMode="External" Target="https://example.org/retained"/></Relationships>`);
  const doc = parse(`<w:ftr xmlns:w="${W}"/>`);
  const original = pkg.paragraphs.flatMap(p => p.runs).find(r => r.image).image;
  const image = { ...original, hyperlinkChanged: true, hyperlink: { target: 'https://example.org/drawing' } };
  const drawing = imageWriter(parts, [{ runs: [{ image }] }], pkg.assets, doc, part)(image);
  expect(drawing.getElementsByTagNameNS(WP, 'docPr')[0].getElementsByTagNameNS(A, 'hlinkClick')[0].getAttributeNS(R, 'id')).toBe('rDrawingLink2');
  const link = { id: 'new-story-link', target: 'https://example.org/text' };
  const node = hyperlinkWriter(parts, [{ runs: [{ link }] }], doc, part)(link);
  expect(node.getAttributeNS(R, 'id')).toBe('rLink2');
  expect(hyperlinkReader(parts, part)(node).target).toBe(link.target);
  expect(parts['word/_rels/document.xml.rels']).toBe(before);
  const entries = [...parse(strFromU8(parts[path])).documentElement.children];
  expect(entries.map(r => r.getAttribute('Target'))).toEqual(['https://example.org/old', 'https://example.org/retained', 'https://example.org/drawing', 'https://example.org/text']);
});
