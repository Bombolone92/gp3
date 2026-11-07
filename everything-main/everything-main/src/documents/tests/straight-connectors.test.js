import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const standalone = readFileSync('tests/fixtures/straight-flat-lines/flat-lines.docx');
const grouped = readFileSync('public/fixtures/straight-connector-groups.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
it.each([[standalone, 8], [grouped, 12], [readFileSync('tests/fixtures/straight-oval-lines/flat-lines.docx'),8]])('retains independent straight connector scenes through edits and exact undo', async (source, count) => {
  const pkg = await DocxPackage.open(source);
  expect(Object.keys(pkg.assets)).toHaveLength(count);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(unzipSync(source));
  doc.select(0); doc.replace('Edited ');
  const edited = await save(), original = unzipSync(source), parts = unzipSync(edited);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name], name).toEqual(original[name]);
  const reopened = await DocxPackage.open(edited);
  expect(Object.values(reopened.assets).map(a => a.scene)).toEqual(Object.values(pkg.assets).map(a => a.scene));
  doc.undo(); expect(unzipSync(await save())).toEqual(original);
});
it.each(['negative', 'point', 'unknown preset', 'adjustment'])('keeps %s geometry guarded', async kind => {
  const parts = unzipSync(standalone), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const ext = xml.getElementsByTagNameNS(A, 'ext')[0], preset = xml.getElementsByTagNameNS(A, 'prstGeom')[0];
  if (kind === 'negative') ext.setAttribute('cy', '-1');
  if (kind === 'point') ext.setAttribute('cx', '0');
  if (kind === 'unknown preset') preset.setAttribute('prst', 'futureConnector');
  if (kind === 'adjustment') {
    const gd = xml.createElementNS(A, 'a:gd'); gd.setAttribute('name', 'adj'); gd.setAttribute('fmla', 'val 25000');
    preset.firstElementChild.append(gd);
  }
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
