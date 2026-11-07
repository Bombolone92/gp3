import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('tests/fixtures/nonrotating-picture-fill/controls.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/nonrotating-picture-fill/native.json','utf8'));
const scenes = pkg => Object.values(pkg.assets).filter(asset => asset.scene).map(asset => asset.scene);
function equalParts(actual, expected) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const name of Object.keys(expected)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])),name).toBe(true);
}

it('retains nonrotating fills, custom clipping, flips and asymmetric insets from the native controls', async () => {
  const pkg = await DocxPackage.open(source), nodes = scenes(pkg);
  expect(createHash('sha256').update(pkg.parts['word/document.xml']).digest('hex')).toBe(reference.documentXmlSha256);
  expect(nodes).toHaveLength(12);
  expect(nodes.every(node => node.fill.image.rotateWithShape === false)).toBe(true);
  expect(nodes.map(node => node.shapeRotation || 0)).toEqual([0,0,45,45,90,90,180,180,270,270,180,90].map(angle => angle*60000));
  expect(nodes[1].flipH).toBe(true);
  expect(nodes[10].fill.destination).toEqual({left:25000,top:10000,right:0,bottom:20000});
});

it('preserves picture-fill controls through editing, export/reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(source);
  const model = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save = async () => unzipSync(new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer()));
  equalParts(await save(),pkg.parts);
  model.select(0); model.replace('Edited ');
  const edited = await save(), reopened = await DocxPackage.open(zipSync(edited));
  expect(scenes(reopened)).toEqual(scenes(pkg));
  expectBodyEditParts(edited, pkg.parts);
  model.undo(); equalParts(await save(),pkg.parts);
});

it('binds nested-group, ancestor-rotation and curved-path controls to their native reference', async () => {
  const pkg = await DocxPackage.open(readFileSync('tests/fixtures/nonrotating-picture-fill/grouped.docx'));
  const native = JSON.parse(readFileSync('tests/fixtures/nonrotating-picture-fill/grouped-native.json','utf8'));
  expect(createHash('sha256').update(pkg.parts['word/document.xml']).digest('hex')).toBe(native.documentXmlSha256);
  const flatten = node => [node,...(node.children || []).flatMap(flatten)];
  const nodes = scenes(pkg).flatMap(flatten);
  expect(nodes.filter(node => node.fill?.image?.rotateWithShape === false)).toHaveLength(16);
  expect(nodes.some(node => node.groupRotation === 30*60000)).toBe(true);
  expect(nodes.some(node => node.groupRotation === 90*60000)).toBe(true);
  expect(nodes.some(node => node.paths?.some(path => path.points.some(command => command[0] === 'E')))).toBe(true);
});
