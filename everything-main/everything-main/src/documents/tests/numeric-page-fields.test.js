import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { pageFieldInstruction, pageFieldValue } from '../src/engine/docx-page-fields.js';
const source = readFileSync('public/fixtures/numeric-page-fields.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/numeric-page-fields/reference.json'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const formatted = (picture, value) => pageFieldValue(pageFieldInstruction(`PAGE \\# "${picture}"`), { pageNumber: value });
it.each([
  ['0#', 0, '0 '], ['0#', 1, '01'], ['0#', 1234, '1234'],
  ['###', 0, '   '], ['###', 1, '  1'], ['#0#', 0, ' 0 '],
  ['#,##0', 0, '   0'], ['#,##0', 1234567, '1,234,567'],
  ['x##', 1234, '234'], ['0x0', 1234, '1234'],
  ['##0.##', 0, '  0.0 '], ['##0.##', 1, '  1.  '], ['0.0x', 1, '1.0'],
  ["'Page '000", 1, 'Page 001'], ['000%;-000%;zero', 0, 'zero'],
  ['000%;-000%;zero', 12, '012%'], ['+000', 0, ' 000'], ['-000', 1, ' 001'],
  ['00-00', 12, '00 12'], ["00'-'00", 12, '00-12'],
])('formats %s at %i with exact padding', (picture, value, result) => expect(formatted(picture, value)).toBe(result));
it('retains switches in either order, raw instructions, locked results and numeric override of section numbering', () => {
  for (const instruction of [' Page \\# 0# \\* MERGEFORMAT ', 'PAGE \\* MERGEFORMAT \\# "0#"']) {
    const field = pageFieldInstruction(instruction);
    expect(field.instruction).toBe(instruction); expect(field.mergeFormat).toBe(true);
    expect(pageFieldValue(field, {pageNumber:12, pageNumbering:{format:'upperRoman'}})).toBe('12');
    expect(pageFieldValue({...field, locked:true}, {pageNumber:12})).toBeNull();
    expect(pageFieldValue({...field, locked:true}, {pageNumber:12, pageStory:true})).toBe('12');
  }
});
it.each(['PAGE \\#', 'PAGE \\# "0', 'PAGE \\# "0"junk', 'PAGE \\# 0 \\# 00',
  'PAGE \\# "`table`"', 'PAGE \\# "\'broken"', 'PAGE \\# "0;0;0;0"', 'PAGE \\# 0.0.0', 'PAGE \\# 0.0,0'])('rejects malformed or unsupported %s', instruction => expect(() => pageFieldInstruction(instruction)).toThrow());
const measure = text => ({width:text.length*6, ascent:12, descent:4});
function render(p) {
  const body = layoutDocument(p.paragraphs, measure, pageGeometry(p.pageSettings), p.numbering, p.tables, p.pageStories);
  const stories = layoutPageStories(body, p.pageStories, [...p.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd),p.pageSettings], measure, p.numbering, {styles:p.styles});
  return {body, stories};
}
it('matches all original native reference control values across restarted sections without mutating story caches', async () => {
  const p = await DocxPackage.open(source), before = structuredClone(p.pageStories), {body, stories} = render(p);
  expect(body.pageCount).toBe(5); expect(stories.unsupported).toEqual([]);
  for (let page=0; page<5; page++) {
    const text = stories.lines.filter(l=>l.page===page).map(l=>l.fragments.map(f=>f.text).join('').replace(/ +/g,' '));
    expect(text).toEqual(reference.pages[page].slice(1).map(l=>l.text));
  }
  expect(p.pageStories).toEqual(before);
});
it('preserves field XML and caches through body editing, export, reopening and undo', async () => {
  const p = await DocxPackage.open(source), d = new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const save = async () => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(p.parts);
  d.select(0); d.replace('Edited ');
  const bytes = await save(), parts = unzipSync(bytes), reopened = await DocxPackage.open(bytes);
  for (const name of Object.keys(p.parts)) if (name !== 'word/document.xml') expect(parts[name],name).toEqual(p.parts[name]);
  expect(render(reopened).stories.lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(render(p).stories.lines.map(l=>l.fragments.map(f=>f.text).join('')));
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
});
