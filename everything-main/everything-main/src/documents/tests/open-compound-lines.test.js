import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { compoundContours } from '../src/engine/compound-outlines.js';

const folder = 'tests/fixtures/open-compound-lines/';
const cases = JSON.parse(readFileSync(folder + 'cases.json'));
const native = JSON.parse(readFileSync(folder + 'reference.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

it('binds all 48 native contours to the independently authored source and PDF', () => {
  expect(hash(readFileSync(folder + 'control.docx'))).toBe(native.sourceSha256);
  expect(hash(readFileSync(folder + 'native.pdf'))).toBe(native.pdfSha256);
  expect(hash(readFileSync(folder + 'cases.json'))).toBe(native.casesSha256);
  expect(cases).toHaveLength(48);
  expect(native.shapes.map(s => s.id)).toEqual(cases.map(c => c.id));
  const dom = new JSDOM();
  try {
    const xml = new dom.window.DOMParser().parseFromString(
      new TextDecoder().decode(unzipSync(readFileSync(folder + 'control.docx'))['word/document.xml']), 'application/xml');
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const lines = [...xml.getElementsByTagNameNS(A, 'ln')];
    const paths = [...xml.getElementsByTagNameNS(A, 'path')];
    expect(lines).toHaveLength(48);
    expect(paths).toHaveLength(48);
    cases.forEach((c, i) => {
      expect(lines[i].getAttribute('cmpd')).toBe(c.compound);
      expect(lines[i].getAttribute('cap')).toBe(c.cap);
      expect(lines[i].getAttribute('w')).toBe('76200');
      expect(paths[i].getElementsByTagNameNS(A, 'close')).toHaveLength(0);
      expect(paths[i].getElementsByTagNameNS(A, 'cubicBezTo')).toHaveLength(c.curve ? 1 : 0);
      const start = paths[i].getElementsByTagNameNS(A, 'pt')[0];
      expect(start.getAttribute('x')).toBe(c.reverse ? '1000' : '0');
      expect(start.getAttribute('y')).toBe(c.curve ? '1000' : '500');
      expect(native.shapes[i].fills).toBe(1);
      expect(native.shapes[i].paths.at(-1)).toEqual(['h']);
    });
  } finally { dom.window.close(); }
});

it.each(cases.filter(c => !c.curve))('records directed band widths and outer cap geometry: $id $compound $cap', c => {
  const measured = native.shapes[c.id - 1];
  const widths = measured.bands.map(b => +(b.bottomPt - b.topPt).toFixed(6));
  const forward = { dbl: [2, 2], tri: [1, 2, 1], thickThin: [3.6, 1.2], thinThick: [1.2, 3.6] }[c.compound];
  expect(widths).toEqual(c.reverse ? [...forward].reverse() : forward);
  expect(measured.bands[0].topPt).toBe(c.yPt + c.heightPt / 2 - 3);
  expect(measured.bands.at(-1).bottomPt).toBe(c.yPt + c.heightPt / 2 + 3);
  // Native square caps extend every band by half the TOTAL pen. Round caps
  // close the outer end separately, leaving the internal gaps flat-ended.
  const extension = c.cap === 'sq' ? 3 : 0;
  for (const b of measured.bands) {
    expect(b.leftPt).toBe(c.xPt - extension);
    expect(b.rightPt).toBe(c.xPt + c.widthPt + extension);
  }
  expect(measured.roundCapCount).toBe(c.cap === 'rnd' ? 2 : 0);
  const gaps = measured.bands.slice(1).map((b, i) => +(b.topPt - measured.bands[i].bottomPt).toFixed(6));
  expect(gaps).toEqual({ dbl: [2], tri: [1, 1], thickThin: [1.2], thinThick: [1.2] }[c.compound]);
});

it('retains open direction and closed seams in a mixed transformed path',()=>{
  const path={width:100,height:100,points:[['M',0,0],['C',0,50,100,50,100,0],['M',20,20],['L',30,20],['L',30,30],['Z']]};
  const contours=compoundContours(path,100,100,{a:-2,b:0,c:0,d:3,e:200,f:10},1);
  expect(contours.map(c=>c.closed)).toEqual([false,true]);
  expect(contours.map(c=>c.direction)).toEqual([-1,-1]);
  expect(contours[0].points[0]).toEqual([200,10]);
  expect(contours[0].points.at(-1)).toEqual([0,10]);
  expect(contours[1].points[0]).toEqual([140,100]);
});

it('imports all 48 outlines and confines unsupported markers to one drawing',async()=>{
  const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  try {
    const source=readFileSync(folder+'control.docx'),parts=unzipSync(source);
    const pkg=await DocxPackage.open(source);
    expect(pkg.readOnly).not.toBe(true);
    expect(Object.values(pkg.assets).filter(a=>a.scene)).toHaveLength(48);
    expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(parts);
    const xml=new DOMParser().parseFromString(new TextDecoder().decode(parts['word/document.xml']),'application/xml');
    const A='http://schemas.openxmlformats.org/drawingml/2006/main';
    const marker=xml.createElementNS(A,'a:headEnd');marker.setAttribute('type','oval');
    xml.getElementsByTagNameNS(A,'ln')[0].appendChild(marker);
    parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
    const bytes=zipSync(parts);
    await expect(DocxPackage.open(bytes)).rejects.toThrow(/line-end markers on open compound paths/);
    const preview=await DocxPackage.open(bytes,{bestEffort:true});
    expect(preview.readOnly).toBe(true);
    expect(preview.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image.id)).toEqual(cases.slice(1).map(c=>c.id));
    expect(preview.parts).toEqual(parts);
  } finally {dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
