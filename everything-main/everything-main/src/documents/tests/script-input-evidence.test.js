import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';

const root = 'tests/fixtures/script-input/';
const cases = JSON.parse(readFileSync(root + 'cases.json', 'utf8'));
const recording = JSON.parse(readFileSync(root + 'native-recording.json', 'utf8'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(name) {
  const parts = unzipSync(readFileSync(root + name));
  const dom = new JSDOM(strFromU8(parts['word/document.xml']), { contentType: 'text/xml' });
  const enabled = (run,key) => {
    const node = run.getElementsByTagNameNS(W,key)[0];
    return !!node && !['0','false','off'].includes(node.getAttributeNS(W,'val'));
  };
  const paragraphs = [...dom.window.document.getElementsByTagNameNS(W,'p')].map(p => [...p.getElementsByTagNameNS(W,'r')].flatMap(r => {
    const text = [...r.children].map(n => n.localName === 't' ? n.textContent : n.localName === 'tab' ? '\t' : '').join('');
    return [...text].map(text => ({text,cs:enabled(r,'cs'),rtl:enabled(r,'rtl')}));
  }));
  dom.window.close(); return paragraphs;
}

it('binds every native insertion to the unchanged original context and exact input text', () => {
  expect(recording.caseCount).toBe(cases.length); expect(recording.method).toBe('Selection.TypeText');
  for (const [name,hash] of Object.entries(recording.hashes)) expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  const source = read('control.docx'), edited = read('native.docx');
  expect(source).toHaveLength(cases.length); expect(edited).toHaveLength(cases.length);
  for (const [index,c] of cases.entries()) {
    expect(source[index].map(r => r.text).join('')).toBe('AB');
    expect(edited[index].map(r => r.text).join(''), `case ${index}`).toBe('A'+c.text+'B');
    expect(edited[index][0]).toEqual(source[index][0]);
    expect(edited[index].at(-1)).toEqual(source[index].at(-1));
  }
});

it('retains native distinctions between Latin, neutral, mixed and complex-script insertions', () => {
  const edited = read('native.docx');
  const flags = (flag,text) => edited[cases.findIndex(c => c.flag === flag && c.text === text)].slice(1,-1).map(r => [r.text,r.cs,r.rtl]);
  expect(flags('rtl','X')).toEqual([['X',false,false]]);
  expect(flags('rtl','1')).toEqual([['1',false,true]]);
  expect(flags('cs','1')).toEqual([['1',false,false]]);
  expect(flags('rtl','क')).toEqual([['क',true,false]]);
  expect(flags('cs','א')).toEqual([['א',false,true]]);
  expect(flags('rtl','A س')).toEqual([['A',false,false],[' ',false,true],['س',false,true]]);
  expect(flags('rtl','\u200e')).toEqual([['\u200e',true,false]]);
  expect(flags('rtl','𐤀')).toEqual([['𐤀',false,false]]);
  expect(flags('rtl','𐩠')).toEqual([['𐩠',false,true]]);
});
