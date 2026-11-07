import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutDocument } from '../src/engine/layout.js';
import { positionedImageFrame } from '../src/engine/positioned-images.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure = (text,style) => ({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize/3});
const layout = d => layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
const save = async (p,d) => unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
// Image positions in points measured from the independently exported native reference PDFs.
const points = {
  body: [[144,360],[171,342],[171,342],[-28.8,72],[547.2,684],[144,27],[144,675],[171,342],[149,367],[176,349],[149,72],[72,367],[149,367],[149,367]],
  cell: [[132,64],[137,64],[137,64],[60,64],[300,64],[132,64],[132,64],[137,64],[137,71],[142,71],[137,136],[144,71],[137,71],[137,71]],
};

it('uses the full writing width for percentages at each column origin', async () => {
  const doc = model(await DocxPackage.open(readFileSync('tests/fixtures/percentage-anchors/columns.docx')));
  expect(layout(doc).floatingObjects.map(f => [f.x,f.y])).toEqual([[360,240],[648,480]]);
  const images = doc.paragraphs.flatMap(p => p.runs).filter(r => r.image);
  const frames = images.map((r,i) => positionedImageFrame(r,{page:0,y:72,columnLeft:i ? 384 : 96},pageGeometry(doc.pageSettings)));
  expect(frames.map(f => [f.x,f.y])).toEqual([[360,240],[648,480]]);
});

it('selects percentage coordinates when MCE wraps the position element itself', async () => {
  const parts = unzipSync(readFileSync('tests/fixtures/percentage-anchors/body.docx'));
  const from = '<wp:positionV relativeFrom="page"><wp14:pctPosVOffset>50000</wp14:pctPosVOffset></wp:positionV>';
  const xml = strFromU8(parts['word/document.xml']); expect(xml).toContain(from);
  parts['word/document.xml'] = strToU8(xml.replace(from, `<mc:AlternateContent><mc:Choice Requires="wp14">${from}</mc:Choice><mc:Fallback><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV></mc:Fallback></mc:AlternateContent>`));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(layout(doc).floatingObjects[0].y).toBe(480);
  doc.select(0); doc.replace('Edit ');
  expect(layout(model(await DocxPackage.open(zipSync(await save(pkg,doc))))).floatingObjects[0].y).toBe(480);
  doc.undo(); expect(await save(pkg,doc)).toEqual(parts);
});

it.each(['', 'NaN', '25.5', '10%%', '2147483648', '-2147483649', '<wp:posOffset>0</wp:posOffset>'])('rejects malformed percentage value %s', async value => {
  const parts = unzipSync(readFileSync('tests/fixtures/percentage-anchors/body.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<wp14:pctPosHOffset>25000</wp14:pctPosHOffset>', `<wp14:pctPosHOffset>${value}</wp14:pctPosHOffset>`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/percentage/);
});

it('does not silently discard effect extents hidden inside unsupported alternate properties', async () => {
  const parts = unzipSync(readFileSync('tests/fixtures/percentage-anchors/body.docx'));
  const xml = strFromU8(parts['word/document.xml']);
  const match = xml.match(/<wp:effectExtent[^>]*\/>/); expect(match).not.toBeNull();
  parts['word/document.xml'] = strToU8(xml.replace(match[0], `<mc:AlternateContent><mc:Choice Requires="wp14">${match[0]}</mc:Choice><mc:Fallback/></mc:AlternateContent>`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/alternate inline properties/);
});

it.each(['body','cell'])('matches the native reference percentage coordinates, mixed axes, effects, literal percentages and MCE in %s', async kind => {
  const bytes = readFileSync(`tests/fixtures/percentage-anchors/${kind}.docx`);
  const pkg = await DocxPackage.open(bytes), doc = model(pkg);
  const check = d => {
    const placed = layout(d);
    expect(placed.pageCount).toBe(14);
    expect(placed.floatingObjects).toHaveLength(14);
    placed.floatingObjects.forEach((f,i) => {
      expect(f.page).toBe(i);
      expect(f.x).toBeCloseTo(points[kind][i][0]*4/3,3);
      expect(f.y).toBeCloseTo(points[kind][i][1]*4/3,3);
      expect(f.width).toBe(96); expect(f.height).toBe(48);
    });
  };
  check(doc);
  expect(await save(pkg,doc)).toEqual(unzipSync(bytes));
  doc.select(0); doc.replace('Edit ');
  check(doc);
  const edited = await save(pkg,doc);
  for (const name of Object.keys(pkg.parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(pkg.parts[name]);
  check(model(await DocxPackage.open(zipSync(edited))));
  doc.undo(); expect(await save(pkg,doc)).toEqual(pkg.parts);
});
