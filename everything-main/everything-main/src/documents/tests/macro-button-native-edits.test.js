import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { previewMacroButtons } from '../src/engine/docx-macro-buttons.js';

const root = 'tests/fixtures/macro-buttons/';
const evidence = JSON.parse(readFileSync(root + 'native-edits.json', 'utf8').replace(/^\uFEFF/, ''));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; });
const record = name => evidence.cases.find(item => item.name === name);
const paragraphs = item => [...new DOMParser().parseFromString(item.documentXml, 'application/xml').getElementsByTagNameNS(W, 'p')];
const displayed = p => previewMacroButtons(p).textContent;

it('ties the native selection evidence to the independently authored source', () => {
  expect(createHash('sha256').update(readFileSync(root + 'editing.docx')).digest('hex')).toBe(evidence.sourceSha256);
  expect(evidence.cases).toHaveLength(10);
  expect(new Set(evidence.cases.map(item => item.name)).size).toBe(10);
});

it.each([
  ['select-replace', 0, 'Unquoted'],
  ['extend-right-replace', 0, 'Unquoted'],
  ['select-replace-quoted', 1, 'Quoted'],
  ['select-replace-split', 2, 'Split'],
  ['select-replace-cached', 3, 'Cached'],
  ['select-replace-locked', 4, 'Locked'],
  ['select-replace-simple', 5, 'Simple'],
])('the native reference replaces the entire selected prompt: %s', (name, index, label) => {
  const item = record(name), p = paragraphs(item)[index];
  expect(item.fieldCount).toBe(item.before.count - 1);
  expect(item.selected.start).toBe(item.before.start);
  // before.end records Result.End. With a saved result the selected field
  // additionally includes its closing delimiter.
  expect(item.selected.end).toBe(item.before.end + (item.before.result === null ? 0 : 1));
  expect(displayed(p)).toBe(`${label}: Author | end`);
  expect(p.getElementsByTagNameNS(W, 'fldChar')).toHaveLength(0);
  expect(p.getElementsByTagNameNS(W, 'instrText')).toHaveLength(0);
  expect(item.fields.some(field => field.code === item.before.code)).toBe(false);
});

it('native reference formatting preserves the prompt and formats its instruction rather than inserting a result', () => {
  const item = record('select-format'), p = paragraphs(item)[0];
  expect(item.fieldCount).toBe(item.before.count);
  expect(item.fields[0]).toEqual({ code: item.before.code, result: null });
  const instruction = p.getElementsByTagNameNS(W, 'instrText')[0];
  expect(instruction.parentElement.getElementsByTagNameNS(W, 'i')).toHaveLength(1);
  const projected = previewMacroButtons(p);
  expect(projected.textContent).toBe('Unquoted: [Last, First Name of Author] | end');
  const label = [...projected.children].find(run => run.textContent === '[Last, First Name of Author]');
  expect(label.getElementsByTagNameNS(W, 'i')).toHaveLength(1);
});

it('the native reference moves across the prompt atomically and inserts subsequent typing outside it', () => {
  const item = record('right-type');
  expect(item.selected.start).toBe(item.before.end);
  expect(item.selected.end).toBe(item.before.end);
  expect(item.fieldCount).toBe(item.before.count);
  expect(item.fields[0]).toEqual({ code: item.before.code, result: null });
  expect(displayed(paragraphs(item)[0])).toBe('Unquoted: [Last, First Name of Author]Author | end');
});

it('does not mistake a hidden-code range probe for visible label replacement', () => {
  const item = record('code-label-replace');
  expect(item.fieldCount).toBe(item.before.count);
  expect(item.fields[0].code).toBe(item.before.code + 'Author');
});
