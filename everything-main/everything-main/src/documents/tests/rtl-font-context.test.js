import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {layoutDocument} from '../src/engine/layout.js';
import {rtlFontControlParagraphs} from './helpers/rtl-font-controls.js';
const root='tests/fixtures/rtl-font-context/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
const fonts={'Arial':'Arial-BoldMT','Courier New':'CourierNewPS-BoldMT','Times New Roman':'TimesNewRomanPS-BoldMT'};
// The native reference Courier PDF maps Persian zero to its shared Arabic-zero glyph.
const glyph=text=>text.replaceAll('۰','٠');
const inventory=items=>items.filter(x=>!/\s/u.test(x[0])).map(x=>JSON.stringify(x)).sort();

it('binds native numeric font evidence to the independent XML source and PDF',()=>{
  for(const [n,k] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']]) expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(reference[k]);
});
it.each(cases)('matches the native reference font/weight for case $index ($flag): $text',c=>{
  const ps=rtlFontControlParagraphs([c]),snapshot=structuredClone(ps);
  const layout=layoutDocument(ps,(text)=>({width:text.length*5,ascent:12,descent:3}));
  const actual=layout.lines.flatMap(l=>l.fragments.filter(f=>f.fontSize===16).flatMap(f=>[...f.text].map(t=>[glyph(t),fonts[f.fontFamily],f.bold?700:400])));
  const native=reference.samples[c.index].glyphs.filter(g=>g.size>15).map(g=>[glyph(g.text),g.font,g.weight]);
  expect(inventory(actual)).toEqual(inventory(native));
  expect(ps).toEqual(snapshot);
});
