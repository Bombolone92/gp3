import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { readShapeGeometry } from '../src/engine/docx-shapes.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
function geometry(kind, formula, width=200, height=90, name='adj') {
  const xml = new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="${kind}"><a:avLst>${formula === undefined ? '' : `<a:gd name="${name}" fmla="${formula}"/>`}</a:avLst></a:prstGeom></a:spPr>`, 'application/xml');
  return readShapeGeometry(xml.documentElement, {width, height});
}
for (const kind of ['homePlate', 'chevron']) {
  it.each([[undefined,45],['val -5000',0],['val 100000',90],['val 120000',108],['val 300000',200]])(`${kind} resolves the standard clamped short-side depth for %s`, (formula, depth) => {
    const result=geometry(kind,formula);
    expect(result.paths[0].points).toEqual([
      ['M',0,0],['L',200-depth,0],['L',200,45],['L',200-depth,90],['L',0,90],
      ...(kind==='chevron' ? [['L',depth,45]] : []),['Z'],
    ]);
  });
  it.each(['val missing','*/ 1 2 0','val','bogus 12'])(`${kind} rejects invalid formula %s`, f => expect(()=>geometry(kind,f)).toThrow());
  it(`${kind} rejects unknown adjustment names`,()=>expect(()=>geometry(kind,'val 25000',200,90,'adj2')).toThrow());
  it(`${kind} retains independent controls and text`,async()=>{
    const pkg=await DocxPackage.open(readFileSync(`public/fixtures/arrow-${kind}.docx`));
    const scenes=Object.values(pkg.assets).map(a=>a.scene);
    expect(scenes).toHaveLength(8);
    expect(scenes.filter(s=>s.text)).toHaveLength(5);
    expect(scenes[5].paths[0].width).toBe(90*12700);
    expect(scenes[5].paths[0].height).toBe(100*12700);
  });
}
it('homePlate extends text halfway into its head',()=>{
  expect(geometry('homePlate').textRect).toEqual({left:0,top:0,right:.8875,bottom:1});
  expect(geometry('homePlate',undefined,90,120).textRect).toEqual({left:0,top:0,right:.75,bottom:1});
});
it('chevron uses its full width at and beyond the overlapping-slope threshold',()=>{
  expect(geometry('chevron').textRect).toEqual({left:.225,top:0,right:.775,bottom:1});
  expect(geometry('chevron',undefined,90,120).textRect).toEqual({left:0,top:0,right:1,bottom:1});
  expect(geometry('chevron','val 120000').textRect).toEqual({left:0,top:0,right:1,bottom:1});
});
