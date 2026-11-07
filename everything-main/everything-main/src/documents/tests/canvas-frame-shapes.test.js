import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { readShapeGeometry } from '../src/engine/docx-shapes.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
function geometry(adjustment, width = 200, height = 90) {
  const xml = new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="frame"><a:avLst>${adjustment === undefined ? '' : `<a:gd name="adj1" fmla="${adjustment}"/>`}</a:avLst></a:prstGeom></a:spPr>`, 'application/xml');
  return readShapeGeometry(xml.documentElement, { width, height });
}
it.each([[undefined,11.25],['val 6745',6.0705],['val 25000',22.5],['val 50000',45],['val 0',0],['val -5000',0],['val 75000',45]])('uses the published frame thickness and pin limits for %s', (formula, inset) => {
  const result = geometry(formula);
  expect(result.paths[0].points).toEqual([['M',0,0],['L',200,0],['L',200,90],['L',0,90],['Z'],['M',inset,inset],['L',inset,90-inset],['L',200-inset,90-inset],['L',200-inset,inset],['Z']]);
  expect(result.textRect).toEqual({left:inset/200,top:inset/90,right:(200-inset)/200,bottom:(90-inset)/90});
});
it('uses the shorter side for portrait frames too', () => {
  expect(geometry(undefined,90,200).textRect).toEqual({left:.125,top:.05625,right:.875,bottom:.94375});
});
it.each(['val missing','*/ 1 2 0','val','bogus 12'])('rejects invalid adjustment %s', formula => {
  expect(() => geometry(formula)).toThrow();
});
it('imports the independent native reference control as eight retained frame scenes', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/frame-shapes.docx'));
  const scenes = Object.values(pkg.assets).map(a => a.scene);
  expect(scenes).toHaveLength(8);
  expect(scenes.slice(0,3).map(s => s.text.paragraphs.flatMap(p => p.runs.map(r => r.text)).join(''))).toEqual(['Default frame','Thin frame','Thick frame']);
  for (const scene of scenes) expect(scene.paths[0].points).toHaveLength(10);
});
