import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutShapeText } from '../src/engine/canvas-shapes.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/ellipses.docx');
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize / 3 });
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

it('reads exact ellipse geometry and inscribed text frames through nonuniform group transforms', async () => {
  const pkg = await DocxPackage.open(source);
  const shapes = Object.values(pkg.assets).filter(a => a.scene).map(a => a.scene.children[0]);
  expect(shapes).toHaveLength(3);
  for (const shape of shapes) expect(shape.paths[0].points).toEqual([['E'], ['Z']]);
  const top = layoutShapeText(shapes[1], measure, { x: 2, y: .5 });
  const center = layoutShapeText(shapes[2], measure);
  expect(top.left).toBeCloseTo(144 * (1 - Math.SQRT1_2) + 4 / 3);
  expect(top.top).toBeCloseTo(48 * (1 - Math.SQRT1_2) + 4 / 3);
  expect(center.left).toBeCloseTo(top.left);
  expect(center.layout.lines.map(l => l.width)).toEqual(top.layout.lines.map(l => l.width));
  expect(top.shift).toBe(0);
  expect(center.shift).toBeGreaterThan(0);
});

it('resolves theme fill and outline colors without replacing the source declarations', async () => {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const shape = xml.getElementsByTagNameNS(WPS, 'wsp')[0];
  for (const [i, fill] of [...shape.getElementsByTagNameNS(A, 'solidFill')].entries()) {
    const color = xml.createElementNS(A, 'a:schemeClr'); color.setAttribute('val', i ? 'accent3' : 'accent2'); fill.replaceChildren(color);
  }
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const pkg = await DocxPackage.open(zipSync(parts));
  const theme = new DOMParser().parseFromString(strFromU8(parts['word/theme/theme1.xml']), 'application/xml');
  const color = name => '#' + theme.getElementsByTagNameNS(A, name)[0].firstElementChild.getAttribute('val');
  const read = Object.values(pkg.assets).find(a => a.scene).scene.children[0];
  expect(read.fill).toBe(color('accent2')); expect(read.outline.color).toBe(color('accent3'));
  const saved = unzipSync(new Uint8Array(await pkg.export(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets).arrayBuffer()));
  expect(saved['word/document.xml']).toEqual(parts['word/document.xml']);
});

it('uses shape font references below explicit paragraph and run formatting', async () => {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const shape = xml.getElementsByTagNameNS(WPS, 'wsp')[1];
  const style = xml.createElementNS(WPS, 'wps:style');
  for (const [name, idx] of [['lnRef', '0'], ['fillRef', '0'], ['effectRef', '0'], ['fontRef', 'major']]) {
    const ref = xml.createElementNS(A, 'a:' + name); ref.setAttribute('idx', idx);
    const color = xml.createElementNS(A, 'a:schemeClr'); color.setAttribute('val', 'accent2'); ref.append(color); style.append(ref);
  }
  shape.insertBefore(style, shape.getElementsByTagNameNS(WPS, 'txbx')[0]);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const pkg = await DocxPackage.open(zipSync(parts));
  const run = Object.values(pkg.assets).filter(a => a.scene)[1].scene.children[0].text.paragraphs[0].runs[0];
  expect(run.fontAscii).toBe('Arial'); // The authored Normal paragraph style wins.
  expect(run.color).toBe('123456'); // Direct run color wins over fontRef color.
  const styles = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const normal = [...styles.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'Normal');
  normal.getElementsByTagNameNS(W, 'rFonts')[0].remove();
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
  const inherited = await DocxPackage.open(zipSync(parts));
  const theme = new DOMParser().parseFromString(strFromU8(parts['word/theme/theme1.xml']), 'application/xml');
  const major = theme.getElementsByTagNameNS(A, 'majorFont')[0].getElementsByTagNameNS(A, 'latin')[0].getAttribute('typeface');
  expect(Object.values(inherited.assets).filter(a => a.scene)[1].scene.children[0].text.paragraphs[0].runs[0].fontAscii).toBe(major);
});

it.each(['shape-text-overflow', 'shape-text-overflow-zero', 'shape-text-overflow-rect'])('clips overflowing shape text and keeps its first line for %s', async name => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/${name}.docx`));
  const shapes = Object.values(pkg.assets).filter(a => a.scene).map(a => a.scene.children[0]);
  for (const [i, shape] of shapes.entries()) {
    const result = layoutShapeText(shape, measure, i === 1 ? { x: 2, y: .5 } : undefined);
    expect(result.shift).toBe(0);
    expect(result.clip.height).toBeLessThan(result.layout.endY);
    expect(result.clip.height).toBeGreaterThan(0);
    // Native reference PDF text clip rectangles relative to each shape frame, in points.
    const expected = name.endsWith('rect') ? (i === 1 ? [1, 74.52, 9.84] : [1, 36.24, 29.04]) : (i === 1 ? [12.24, 51.96, 4.32] : [6.6, 24.96, 17.76]);
    expect(Math.abs(result.clip.left * .75 - expected[0])).toBeLessThan(.15);
    expect(Math.abs(result.clip.width * .75 - expected[1])).toBeLessThan(.15);
    expect(Math.abs(result.clip.height * .75 - expected[2])).toBeLessThan(.15);
  }
});

it('retains ellipse source and unrelated package parts through editing, reopening and full undo', async () => {
  const pkg = await DocxPackage.open(source);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0); doc.replace('Edited ');
  const bytes = await save(), parts = unzipSync(bytes);
  expect((await DocxPackage.open(bytes)).paragraphs[0].runs.map(r => r.text).join('')).toBe('Edited Ellipse geometry');
  expectBodyEditParts(parts, pkg.parts);
  doc.undo();
  const restored = unzipSync(await save());
  for (const [name, part] of Object.entries(pkg.parts)) expect(Buffer.from(restored[name]).equals(Buffer.from(part)), name).toBe(true);
});
