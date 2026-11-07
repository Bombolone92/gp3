import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { readMacroButtonField, writeMacroButtonLabel } from '../src/engine/docx-macro-buttons.js';
import { serializeFragment } from '../src/engine/docx-compatibility.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const parse = value => new DOMParser().parseFromString(value, 'application/xml');
const paragraph = value => parse(`<w:p xmlns:w="${W}">${value}</w:p>`).documentElement;
const xml = nodes => nodes.map(serializeFragment).join('');
const source = () => parse(strFromU8(unzipSync(readFileSync('tests/fixtures/macro-buttons/editing.docx'))['word/document.xml']));
function control(index) {
  const p = source().getElementsByTagNameNS(W, 'p')[index];
  p.firstElementChild.remove(); // paragraph properties
  p.firstElementChild.remove(); // ordinary label prefix
  p.lastElementChild.remove(); // ordinary suffix
  return p;
}
function italic(nodes) {
  return nodes.map(node => {
    const copy = node.cloneNode(true), doc = copy.ownerDocument;
    let properties = [...copy.children].find(n => n.localName === 'rPr');
    if (!properties) { properties = doc.createElementNS(W, 'w:rPr'); copy.prepend(properties); }
    if (!properties.getElementsByTagNameNS(W, 'i').length) properties.append(doc.createElementNS(W, 'w:i'));
    return copy;
  });
}

it.each([0, 1, 2, 3, 4, 5, 7])('preserves the complete untouched envelope for control %i', index => {
  const { field, labelNodes } = readMacroButtonField(control(index));
  const output = writeMacroButtonLabel(field, labelNodes, labelNodes[0].ownerDocument);
  expect(xml(output)).toBe(field.source);
});

it.each([0, 1, 2, 3, 4, 5, 7])('formats instruction labels while retaining command, result and flags for control %i', index => {
  const { field, labelNodes } = readMacroButtonField(control(index));
  const original = xml(labelNodes);
  const result = writeMacroButtonLabel(field, italic(labelNodes), labelNodes[0].ownerDocument);
  const again = readMacroButtonField(paragraph(xml(result)));
  expect(again.field.instruction).toBe(field.instruction);
  expect(again.field.locked).toBe(field.locked);
  expect(again.field.dirty).toBe(field.dirty);
  expect(again.labelNodes.every(run => run.getElementsByTagNameNS(W, 'i').length === 1)).toBe(true);
  const cachedText = nodes => nodes.flatMap(n => [...n.getElementsByTagNameNS(W, 't')]).map(n => n.textContent).join('');
  expect(cachedText(result)).toBe(cachedText([...paragraph(field.source).children]));
  expect(xml(labelNodes)).toBe(original);
});

it('matches the native whole-prompt italic display while preserving independent source metadata', () => {
  const native = JSON.parse(readFileSync('tests/fixtures/macro-buttons/native-edits.json', 'utf8').replace(/^\uFEFF/, '')).cases.find(c => c.name === 'select-format');
  const nativeP = parse(native.documentXml).getElementsByTagNameNS(W, 'p')[0];
  nativeP.firstElementChild.remove(); nativeP.firstElementChild.remove(); nativeP.lastElementChild.remove();
  const { field, labelNodes } = readMacroButtonField(control(0));
  const edited = readMacroButtonField(paragraph(xml(writeMacroButtonLabel(field, italic(labelNodes), labelNodes[0].ownerDocument))));
  const expected = readMacroButtonField(nativeP);
  expect(edited.field.instruction).toBe(expected.field.instruction);
  expect(edited.labelNodes.map(n => n.textContent)).toEqual(expected.labelNodes.map(n => n.textContent));
  expect(edited.labelNodes[0].getElementsByTagNameNS(W, 'i')).toHaveLength(1);
});

it('rejects text replacement, invalid envelopes and non-text label content', () => {
  const { field, labelNodes } = readMacroButtonField(control(0));
  const changed = labelNodes[0].cloneNode(true); changed.getElementsByTagNameNS(W, 't')[0].textContent = 'Author';
  expect(() => writeMacroButtonLabel(field, [changed], changed.ownerDocument)).toThrow('removing its field');
  expect(() => writeMacroButtonLabel({ ...field, instruction: 'MACROBUTTON Other Label' }, labelNodes, changed.ownerDocument)).toThrow('retained');
  expect(() => readMacroButtonField(paragraph('<w:r><w:t>outside</w:t></w:r>' + field.source))).toThrow('outside content');
  changed.append(changed.ownerDocument.createElementNS(W, 'w:drawing'));
  expect(() => writeMacroButtonLabel(field, [changed], changed.ownerDocument)).toThrow('text runs');
  expect(() => readMacroButtonField(paragraph('<w:fldSimple w:instr="MACROBUTTON Command Label"><w:fldData>data</w:fldData><w:r><w:t>Cache</w:t></w:r></w:fldSimple>'))).toThrow('metadata');
  expect(() => readMacroButtonField(paragraph('<w:fldSimple w:instr="MACROBUTTON Command Label" extra="keep"><w:r><w:t>Cache</w:t></w:r></w:fldSimple>'))).toThrow('metadata');
});

it('converts a simple field with split label formatting without changing dirty/lock flags or cache', () => {
  const p = paragraph('<w:fldSimple w:instr="MACROBUTTON Command First second" w:fldLock="true" w:dirty="true"><w:r><w:rPr><w:b/></w:rPr><w:t>Cached</w:t></w:r></w:fldSimple>');
  const { field, labelNodes } = readMacroButtonField(p);
  const first = labelNodes[0].cloneNode(true), second = labelNodes[0].cloneNode(true);
  first.getElementsByTagNameNS(W, 't')[0].textContent = 'First ';
  second.getElementsByTagNameNS(W, 't')[0].textContent = 'second';
  const nodes = writeMacroButtonLabel(field, [first, ...italic([second])], p.ownerDocument);
  const reread = readMacroButtonField(paragraph(xml(nodes)));
  expect(reread.field).toMatchObject({ locked: true, dirty: true, instruction: field.instruction });
  expect(reread.labelNodes.map(n => n.textContent)).toEqual(['First ', 'second']);
  expect(reread.labelNodes[0].getElementsByTagNameNS(W, 'i')).toHaveLength(0);
  expect(reread.labelNodes[1].getElementsByTagNameNS(W, 'i')).toHaveLength(1);
  expect(xml(writeMacroButtonLabel(reread.field, reread.labelNodes, p.ownerDocument))).toBe(reread.field.source);
  expect(nodes.flatMap(n => [...n.getElementsByTagNameNS(W, 't')]).map(n => n.textContent)).toEqual(['Cached']);
});
