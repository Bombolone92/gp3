import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { previewParagraphs } from '../src/engine/docx-preview.js';
import { previewMacroButtons, macroButtonLabelStart } from '../src/engine/docx-macro-buttons.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/macro-button-labels.docx');
const text = pkg => new TextDocument(pkg.paragraphs).text;
const expected = [
  'Unquoted: [Last, First Name of Author] | end',
  'Quoted: "Quoted display label"  | end',
  'Split: Split label | end',
  'Cached: Instruction label | end',
  'Locked: Locked instruction | end',
  'Simple: Simple display | end',
  'Multiple: [First] / [Second] | end',
  'Quoted command: "Safe display" | end',
  'Not a button: Cached date | end',
].join('\n');
const paragraph = contents => new DOMParser().parseFromString(`<w:p xmlns:w="${W}">${contents}</w:p>`, 'application/xml').documentElement;
const run = content => `<w:r>${content}</w:r>`;
const begin = run('<w:fldChar w:fldCharType="begin"/>');
const end = run('<w:fldChar w:fldCharType="end"/>');
const separate = run('<w:fldChar w:fldCharType="separate"/>');
const instruction = text => run(`<w:instrText>${text}</w:instrText>`);

it('displays the independent reference MACROBUTTON labels while leaving unrelated field results cached', async () => {
  // The cached DATE result made this fixture read-only until DATE became a retained field (2026-10-09).
  const pkg = await DocxPackage.open(source, { bestEffort: true });
  expect(pkg.readOnly).toBeFalsy(); expect(text(pkg)).toBe(expected);
  expect(text(DocxPackage.preview(pkg.parts))).toBe(expected);
  expect(pkg.parts).toEqual(unzipSync(source));
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(source));
  expect(text(await DocxPackage.open(source))).toBe(expected);
});

it('retains the display fragments’ own bold, italic and color properties across split instruction runs', async () => {
  const pkg = await DocxPackage.open(source, { bestEffort: true });
  const runs = pkg.paragraphs[2].runs;
  expect(runs.find(r => r.text === 'Split ')).toMatchObject({ bold: true, color: '2050C0' });
  expect(runs.find(r => r.text === 'label')).toMatchObject({ italic: true, color: 'C02050' });
  expect(runs.map(r => r.text).join('')).toBe('Split: Split label | end');
});

it.each(['MACROBUTTON', 'MACROBUTTON NoMacro', 'MACROBUTTON NoMacro ', 'MACROBUTTON "Unclosed command Safe', 'DATE NoMacro Label'])('leaves malformed or unrelated instruction %s unprojected', value => {
  expect(macroButtonLabelStart(value)).toBeNull();
});

it('handles delimiters and text in the same run without leaking the command name or mutating XML', () => {
  const node = paragraph(run('<w:t>Before </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>MACROBUTTON NeverInvoke Label</w:instrText><w:fldChar w:fldCharType="end"/><w:t> after</w:t>'));
  const original = new XMLSerializer().serializeToString(node);
  const projected = previewMacroButtons(node);
  expect(projected.textContent).toBe('Before Label after');
  expect(projected.getElementsByTagNameNS(W, 'instrText')).toHaveLength(0);
  expect(new XMLSerializer().serializeToString(node)).toBe(original);
});

it('keeps nested, incomplete and multiply separated fields on the cached-result fallback path', () => {
  for (const contents of [
    begin + instruction('MACROBUTTON NoMacro Outer') + begin + instruction('MACROBUTTON NoMacro Inner') + end + end,
    begin + instruction('MACROBUTTON NoMacro Incomplete'),
    begin + instruction('MACROBUTTON NoMacro Duplicate') + separate + separate + run('<w:t>Cached</w:t>') + end,
  ]) {
    const node = paragraph(contents);
    expect(previewMacroButtons(node)).toBe(node);
    expect(text({ paragraphs: previewParagraphs(node) })).not.toMatch(/MACROBUTTON|NoMacro|Outer|Inner|Incomplete|Duplicate/);
  }
});

it('preserves the inherited namespace context of neighboring alternate drawings', () => {
  const doc = new DOMParser().parseFromString(`<root xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:shape="urn:fixture-shape"><w:p>${begin + instruction('MACROBUTTON NoMacro Label') + end}<w:r><mc:AlternateContent><mc:Choice Requires="shape"><w:drawing/></mc:Choice><mc:Fallback/></mc:AlternateContent></w:r></w:p></root>`, 'application/xml');
  const projected = previewMacroButtons(doc.documentElement.firstElementChild);
  expect(projected.lookupNamespaceURI('shape')).toBe('urn:fixture-shape');
  expect(projected.getElementsByTagNameNS(W, 'drawing')).toHaveLength(1);
});
