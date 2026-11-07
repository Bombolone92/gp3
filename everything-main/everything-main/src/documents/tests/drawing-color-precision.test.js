import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { drawingPaintColor } from '../src/engine/docx-drawing-style.js';

const dom = new JSDOM();
const node = xml => new dom.window.DOMParser().parseFromString(xml, 'application/xml').documentElement;
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const folder of ['drawing-luminance-precision', 'drawing-color-sequences']) it(`matches every native DrawingML color: ${folder}`, () => {
  const dir = new URL(`./fixtures/${folder}/`, import.meta.url);
  const ref = JSON.parse(readFileSync(new URL('reference.json', dir)));
  expect(hash(readFileSync(new URL('source.docx', dir)))).toBe(ref.sourceSha256);
  expect(hash(readFileSync(new URL('native.pdf', dir)))).toBe(ref.pdfSha256);
  expect(ref.cases).toHaveLength(96);
  for (const c of ref.cases) {
    const color = node(`<a:${c.kind} xmlns:a="${a}" val="${c.base}">${c.transforms.map(([k,v]) => `<a:${k} val="${v}"/>`).join('')}</a:${c.kind}>`);
    expect(drawingPaintColor(color, () => 'FFFFFF'), `case ${c.id}`).toBe('#' + c.rgb);
  }
});
it('preserves every literal sRGB byte through linear percentage precision', () => {
  for (let i = 0; i < 256; i++) {
    const rgb = [i, 255-i, (i*73)%256].map(c => c.toString(16).padStart(2,'0')).join('').toUpperCase();
    expect(drawingPaintColor(node(`<a:srgbClr xmlns:a="${a}" val="${rgb}"/>`))).toBe('#' + rgb);
  }
});
for (const stem of ['neutral-stages', 'neutral-boundaries']) it(`matches native neutral conversion thresholds: ${stem}`, () => {
  const dir = new URL('./fixtures/drawing-luminance-precision/', import.meta.url);
  const ref = JSON.parse(readFileSync(new URL(stem + '-reference.json', dir)));
  expect(hash(readFileSync(new URL(stem + '.docx', dir)))).toBe(ref.sourceSha256);
  expect(hash(readFileSync(new URL(stem + '-native.pdf', dir)))).toBe(ref.pdfSha256);
  for (const c of ref.cases.filter(c => c.representation !== 'hsl')) {
    let base = c.representation === 'white-lumMod' ? 'FFFFFF' : '000000', transform = '';
    if (c.representation === 'literal') base = Math.round(c.value * 255 / 100000).toString(16).padStart(2,'0').repeat(3);
    else transform = `<a:${c.representation === 'white-lumMod' ? 'lumMod' : 'lumOff'} val="${c.value}"/>`;
    expect(drawingPaintColor(node(`<a:srgbClr xmlns:a="${a}" val="${base}">${transform}</a:srgbClr>`)), `case ${c.id}`).toBe('#' + c.rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase());
  }
});
