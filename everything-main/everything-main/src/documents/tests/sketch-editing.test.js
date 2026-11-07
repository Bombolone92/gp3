import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { canonicalXml } from './helpers/canonical-xml.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const scenes = pkg => Object.values(pkg.assets).filter(a => a.scene).map(a => a.scene);
// Compare the sketch declarations as XML: export may hoist their namespace declarations to the part root.
const metadata = parts => [...new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml').getElementsByTagName('*')]
  .filter(n => n.localName === 'lineSketchStyleProps').map(n => canonicalXml(n));

for (const file of ['public/fixtures/picture-sketch-outlines.docx', ...['sketch-regeneration', 'sketch-heldout', 'sketch-ellipse', 'sketch-syntax'].map(name => `tests/fixtures/${name}/control.docx`)]) {
  it(`preserves sketch metadata, geometry and atomic guards through text edit, export and undo: ${file}`, async () => {
    const pkg = await DocxPackage.open(readFileSync(file));
    expect(pkg.readOnly).not.toBe(true);
    const before = scenes(pkg), originalMetadata = metadata(pkg.parts);
    expect(originalMetadata.length).toBeGreaterThan(0);
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
    const originalText = doc.text;
    const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
    expect(unzipSync(await save())).toEqual(pkg.parts);
    doc.select(0); doc.replace('Edited ');
    const edited = await save(), parts = unzipSync(edited);
    expect(metadata(parts)).toEqual(originalMetadata);
    expectBodyEditParts(parts, pkg.parts);
    const reopened = await DocxPackage.open(edited);
    expect(reopened.readOnly).not.toBe(true);
    expect(scenes(reopened)).toEqual(before);
    const at = doc.text.indexOf('\ufffc');
    expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + 1);
    expect(doc.selectedImage.retainedDrawing).toBe(true);
    expect(() => doc.setImageProperties({ width: doc.selectedImage.width + 100 })).toThrow(/retained as complete objects/);
    expect(unzipSync(await save())).toEqual(parts);
    // Rejection must not create an undo step or alter the original shell.
    doc.undo(); expect(doc.text).toBe(originalText);
    expect(unzipSync(await save())).toEqual(pkg.parts);
    doc.redo(); expect(doc.text).toBe('Edited ' + originalText);
    expect(scenes(await DocxPackage.open(await save()))).toEqual(before);
  });
}
