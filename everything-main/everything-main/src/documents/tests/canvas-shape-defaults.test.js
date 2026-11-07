import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source = readFileSync('public/fixtures/shape-defaults.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
function changed(change) {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  change(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
it('preserves dormant normal autofit through editing, export, reopen and undo', async () => {
  const bytes=readFileSync('public/fixtures/inactive-normal-autofit.docx'),pkg=await DocxPackage.open(bytes);
  expect(Object.values(pkg.assets).map(a=>a.scene.text)).toEqual(Array(8).fill(null));
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>unzipSync(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()));
  expect(await save()).toEqual(unzipSync(bytes));
  doc.select(0);doc.replace('Edited ');const out=await save();
  expect(strFromU8(out['word/document.xml']).match(/<a:normAutofit\b/g)).toHaveLength(8);
  for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(out[name]).toEqual(pkg.parts[name]);
  expect(Object.values((await DocxPackage.open(zipSync(out))).assets).map(a=>a.scene.text)).toEqual(Array(8).fill(null));
  doc.undo();expect(await save()).toEqual(pkg.parts);
});
it.each(['fontScale="999"','fontScale="100001"','lnSpcReduction="-1"','lnSpcReduction="13200001"','fontScale="no"','unknown="0"'])('rejects malformed dormant normal autofit %s', async attrs => {
  const bytes=changed(xml=>{
    const shape=xml.getElementsByTagNameNS(S,'wsp')[0],body=shape.getElementsByTagNameNS(S,'bodyPr')[0];
    while(body.firstChild)body.firstChild.remove();
    const fit=new DOMParser().parseFromString(`<a:normAutofit xmlns:a="${A}" ${attrs}/>`, 'application/xml').documentElement;
    body.appendChild(xml.importNode(fit,true));
  });
  await expect(DocxPackage.open(bytes)).rejects.toThrow(/autofit/);
});
it('keeps normal autofit with a real text box guarded', async () => {
  const bytes=changed(xml=>{
    const shape=[...xml.getElementsByTagNameNS(S,'wsp')].find(s=>s.getElementsByTagNameNS(S,'txbx').length);
    const body=shape.getElementsByTagNameNS(S,'bodyPr')[0];while(body.firstChild)body.firstChild.remove();
    body.appendChild(xml.createElementNS(A,'a:normAutofit'));
  });
  await expect(DocxPackage.open(bytes)).rejects.toThrow(/normal autofit in text-bearing/);
});
it('retains unused positional tabs without changing the shape text or artwork', async () => {
  const original = await DocxPackage.open(source);
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/shape-inactive-tabs.docx'));
  const scenes = p => Object.values(p.assets).map(a => a.scene);
  const expected = scenes(original), actual = scenes(pkg);
  expect(actual).toHaveLength(8);
  for (let i = 0; i < actual.length; i++) {
    const paragraphs = actual[i].text.paragraphs;
    expect(paragraphs[0].format.tabs).toEqual([{ position: 600, alignment: ['left', 'center', 'right', 'decimal'][i % 4], leader: 'dot' }]);
    for (const p of paragraphs) p.format.tabs = [];
    // Compare resolved appearance; the retained shell and inheritance metadata
    // deliberately continue to contain the original tab declarations.
    for (const p of [...paragraphs, ...(expected[i].text?.paragraphs || [])]) {
      for (const key of ['id', 'shell', 'listContext', 'styleContext']) delete p[key];
    }
    if (i < 4) { expect(paragraphs[0].runs).toEqual([]); actual[i].text = null; }
    expect(actual[i]).toEqual(expected[i]);
  }
});
it.each(['left', 'center', 'right', 'decimal', 'bar'])('still rejects active or unsupported %s shape tab stops', async alignment => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  await expect(DocxPackage.open(changed(x => {
    const p = x.getElementsByTagNameNS(S, 'txbx')[0].getElementsByTagNameNS(W, 'p')[0];
    const pr = p.getElementsByTagNameNS(W, 'pPr')[0], tabs = x.createElementNS(W, 'w:tabs'), tab = x.createElementNS(W, 'w:tab');
    tab.setAttributeNS(W, 'w:val', alignment); tab.setAttributeNS(W, 'w:pos', '600'); tabs.append(tab); pr.append(tabs);
    // Bar tabs must be rejected even without any tab character.
    if (alignment !== 'bar') p.getElementsByTagNameNS(W, 'r')[0].append(x.createElementNS(W, 'w:tab'));
  }))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
it.each(['shape-defaults', 'shape-upright-inactive'])('retains identical scenes for inactive declarations in %s', async fixture => {
  const source = readFileSync(`public/fixtures/${fixture}.docx`);
  const p = await DocxPackage.open(source), scenes = Object.values(p.assets).map(a => a.scene);
  expect(scenes).toHaveLength(8);
  for (const scene of scenes) for (const p of scene.text?.paragraphs || []) delete p.id;
  if (fixture === 'shape-upright-inactive') {
    expect(scenes[3].text.paragraphs).toHaveLength(1);
    expect(scenes[3].text.paragraphs[0].runs).toEqual([]);
    scenes[3].text = null;
  }
  for (let i = 0; i < 8; i++) expect(scenes[i]).toEqual(scenes[i < 4 ? 0 : 4]);
});
it.each([
  ['effect', x => x.getElementsByTagNameNS(A, 'effectLst')[0].appendChild(x.createElementNS(A, 'a:glow'))],
  ['extrusion', x => x.getElementsByTagNameNS(A, 'sp3d')[0].setAttribute('extrusionH', '1000')],
  ['bevel', x => x.getElementsByTagNameNS(A, 'sp3d')[0].appendChild(x.createElementNS(A, 'a:bevelT'))],
  ['unknown effect attribute', x => x.getElementsByTagNameNS(A, 'effectLst')[0].setAttribute('unknown', '0')],
  ['duplicate effect list', x => { const n = x.getElementsByTagNameNS(A, 'effectLst')[0]; n.parentNode.appendChild(n.cloneNode(true)); }],
  ['multiple columns', x => x.getElementsByTagNameNS(S, 'bodyPr')[0].setAttribute('numCol', '2')],
  ...['2', 'yes', 'TRUE', ''].map(value => ['malformed upright ' + value, x => x.getElementsByTagNameNS(S, 'bodyPr')[0].setAttribute('upright', value)]),
  ...['1', 'true'].map(value => ['reflected upright text ' + value, x => {
    const body = x.getElementsByTagNameNS(S, 'bodyPr')[4]; body.setAttribute('upright', value);
    body.parentNode.getElementsByTagNameNS(A, 'xfrm')[0].setAttribute('flipV', '1');
  }]),
  ...['-1', '2147483648', '1.5', 'oops'].map(value => ['invalid gap ' + value, x => x.getElementsByTagNameNS(S, 'bodyPr')[0].setAttribute('spcCol', value)]),
])('keeps unsupported or malformed %s out of editable scenes', async (_, change) => {
  await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
