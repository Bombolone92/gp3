import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const A16 = 'http://schemas.microsoft.com/office/drawing/2014/main';
const source = readFileSync('tests/fixtures/blip-creation-ids/control.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const ids = root => [...root.getElementsByTagNameNS(A16, 'creationId')].filter(n => n.parentElement?.parentElement?.parentElement?.localName === 'blip');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const images = p => p.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
function changed(change) {
  const parts = unzipSync(source), xml = parse(parts['word/document.xml']);
  change(xml, ids(xml)[0]); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
function sameParts(actual, expected, edited = false) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) if (!edited || key !== 'word/document.xml') expect(Buffer.from(actual[key]).equals(Buffer.from(expected[key])), key).toBe(true);
}
const identities = p => images(p).map(image => ids(parse(strToU8(image.shell))).map(n => n.getAttribute('id')));

it('preserves optional image-data identities in pictures, shapes and nested groups without changing layout', async () => {
  const pkg = await DocxPackage.open(source);
  const bare = await DocxPackage.open(changed(root => ids(root).forEach(n => n.parentElement.remove())));
  const layout = p => layoutDocument(p.paragraphs, (text, style) => ({ width: text.length * style.fontSize / 2, ascent: style.fontSize, descent: style.fontSize / 3 }), pageGeometry(p.pageSettings), p.numbering, p.tables);
  const geometry = p => { const result = layout(p); return { pageCount: result.pageCount, drawings: result.floatingObjects.map(n => [n.x, n.y, n.width, n.height]), lines: result.lines.map(n => [n.x, n.y, n.width, n.height]) }; };
  expect(geometry(pkg)).toEqual(geometry(bare));
  expect(identities(pkg).flat().length).toBeGreaterThanOrEqual(2);
  expect(identities(pkg).flat()).toContain(null);
  const d = model(pkg);
  sameParts(unzipSync(await save(pkg, d)), pkg.parts);
  d.select(0); d.replace('Edited ');
  const edited = await save(pkg, d);
  expect(identities(await DocxPackage.open(edited))).toEqual(identities(pkg));
  expectBodyEditParts(unzipSync(edited), pkg.parts);
  d.undo(); sameParts(unzipSync(await save(pkg, d)), pkg.parts);
});

it('retains identity through picture resizing, deletion and undo/redo', async () => {
  const pkg = await DocxPackage.open(source), d = model(pkg), original = identities(pkg);
  const at = d.text.lastIndexOf('\ufffc'); d.select(at, at + 1);
  d.setImageProperties({ width: 685800, height: 685800, alt: 'Changed alt text' });
  const reopened = await DocxPackage.open(await save(pkg, d));
  expect(identities(reopened)).toEqual(original);
  expect(images(reopened).at(-1)).toMatchObject({ width: 685800, alt: 'Changed alt text' });
  d.replace(''); expect(images(await DocxPackage.open(await save(pkg, d)))).toHaveLength(1);
  d.undo(); expect(identities(d)).toEqual(original);
  d.redo(); expect(images(d)).toHaveLength(1);
  while (d.history.length) d.undo(); sameParts(unzipSync(await save(pkg, d)), pkg.parts);
});

it('accepts token whitespace and all GUID bit patterns without inventing UUID version constraints', async () => {
  for (const value of [' {00000000-0000-0000-0000-000000000000}\n', '{FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF}']) {
    const pkg = await DocxPackage.open(changed((root, n) => n.setAttribute('id', value)));
    expect(identities(pkg).flat()).toContain(value);
  }
});

it.each([
  ['malformed GUID', (root, n) => n.setAttribute('id', '123')],
  ['lowercase GUID', (root, n) => n.setAttribute('id', '{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}')],
  ['unbraced GUID', (root, n) => n.setAttribute('id', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')],
  ['empty GUID', (root, n) => n.setAttribute('id', '')],
  ['non-XML token whitespace', (root, n) => n.setAttribute('id', '\u00a0{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}')],
  ['unknown attribute', (root, n) => n.setAttribute('other', '1')],
  ['qualified ID', (root, n) => n.setAttributeNS(A16, 'identity:id', '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}')],
  ['nested content', (root, n) => n.append(root.createElementNS(A16, 'identity:creationId'))],
  ['text content', (root, n) => n.append('unexpected')],
  ['non-XML whitespace content', (root, n) => n.append('\u00a0')],
  ['duplicate ID', (root, n) => n.parentElement.append(n.cloneNode(true))],
  ['duplicate extension', (root, n) => n.parentElement.parentElement.append(n.parentElement.cloneNode(true))],
  ['wrong namespace', (root, n) => n.replaceWith(root.createElementNS('urn:wrong', 'x:creationId'))],
  ['unknown extension', (root, n) => n.parentElement.setAttribute('uri', 'urn:unknown')],
])('rejects %s before editing', async (_, change) => {
  await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
