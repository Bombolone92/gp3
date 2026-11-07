import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { rotatedLinePoints } from '../src/engine/drawing-line-rotation.js';
const source = readFileSync('public/fixtures/rotated-group-lines.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/rotated-group-lines/reference.json', 'utf8'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
it('matches all native reference endpoint measurements after composing nested scales', async () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  const pkg = await DocxPackage.open(source), points = [];
  expect(Object.values(pkg.assets)[0].width * .75).toBeCloseTo(500, 8);
  const walk = (n, x, y, sx, sy) => {
    x += n.x * sx; y += n.y * sy;
    if (n.type === 'group') {
      sx *= n.width / n.childWidth; sy *= n.height / n.childHeight;
      n.children.forEach(child => walk(child, x - n.childX * sx, y - n.childY * sy, sx, sy));
    } else points.push(rotatedLinePoints({ ...n, lineRotation: n.lineRotation || 0 }, sx, sy).map(([px, py]) => [x + px, y + py]));
  };
  walk(Object.values(pkg.assets)[0].scene, 0, 0, 1 / 12700, 1 / 12700);
  expect(points).toHaveLength(reference.cases.length);
  reference.cases.forEach((c, i) => c.points.forEach((p, j) => p.forEach((v, k) => expect(Math.abs(points[i][j][k] - v), c.name).toBeLessThan(.015))));
});
it('retains source rotation, flips and geometry during text edits, reopening and exact undo', async () => {
  const pkg = await DocxPackage.open(source), scenes = Object.values(pkg.assets).map(a => a.scene);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0); doc.replace('Edited ');
  const edited = await save(), reopened = await DocxPackage.open(edited);
  expect(Object.values(reopened.assets).map(a => a.scene)).toEqual(scenes);
  const originalParts = unzipSync(source), editedParts = unzipSync(edited);
  for (const name of Object.keys(originalParts)) if (name !== 'word/document.xml') expect(editedParts[name], name).toEqual(originalParts[name]);
  doc.undo(); expect(unzipSync(await save())).toEqual(originalParts);
});
it.each(['1.5', 'NaN', '2147483648', '-2147483649'])('rejects malformed angle %s', async angle => {
  const parts = unzipSync(source);
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('rot="5400000"', `rot="${angle}"`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/rotated/);
});
it('retains reflection on groups containing rotated lines', async () => {
  for (const change of [xml => xml.replace('<a:xfrm>', '<a:xfrm flipH="1">')]) {
    const parts = unzipSync(source); parts['word/document.xml'] = strToU8(change(strFromU8(parts['word/document.xml'])));
    const pkg = await DocxPackage.open(zipSync(parts));
    expect(Object.values(pkg.assets)[0].scene.flipH).toBe(true);
  }
});
