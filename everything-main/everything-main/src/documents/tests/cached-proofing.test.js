import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import nspell from 'nspell';
import { DocxPackage } from '../src/engine/docx.js';
import { proofingFingerprint, wordsInSavedRanges } from '../src/engine/docx-proofing-cache.js';
import { proofingText, wordsToCheck } from '../src/lib/spelling.js';
import { TextDocument } from '../src/engine/model.js';

let dom, speller;
beforeAll(() => {
  dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  speller = nspell(readFileSync('public/dictionaries/en-US.aff'), readFileSync('public/dictionaries/en-US.dic'));
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const cases = JSON.parse(readFileSync('tests/fixtures/cached-proofing/cases.json'));
it.each(cases)('imports %s saved ranges and agrees with hash-bound reference errors', async name => {
  const bytes = readFileSync(`tests/fixtures/cached-proofing/${name}.docx`), native = JSON.parse(readFileSync(`tests/fixtures/cached-proofing/${name}-native.json`, 'utf8').replace(/^\uFEFF/, ''));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  const pkg = await DocxPackage.open(bytes), saved = pkg.savedSpelling;
  expect(saved).not.toBeNull();
  const words = wordsInSavedRanges(wordsToCheck(proofingText(saved.text, pkg.paragraphs)), saved.ranges).filter(w => !speller.correct(w.word));
  expect(words.map(w => ({ start: w.start, end: w.end, word: saved.text.slice(w.start, w.end) }))).toEqual(native.errors);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
it('uses no saved cache for dirty or omitted spelling completion', async () => {
  const pkg = await DocxPackage.open(readFileSync('tests/fixtures/proofing-state/proofing-dirty.docx'));
  expect(pkg.savedSpelling).toBeNull();
  const parts = unzipSync(readFileSync('tests/fixtures/proofing-state/proofing-clean.docx'));
  parts['word/settings.xml'] = strToU8(strFromU8(parts['word/settings.xml']).replace(' w:spelling="clean"', ''));
  expect((await DocxPackage.open(zipSync(parts))).savedSpelling).toBeNull();
});
it('fingerprints proofing scope without treating run splitting or bold as a text change', () => {
  const original = [{ runs: [{ text: 'jumpd', fontLanguage: 'en-US' }] }];
  const split = [{ runs: [{ text: 'ju', fontLanguage: 'en-US', bold: true }, { text: 'mpd', fontLanguage: 'en-US' }] }];
  expect(proofingFingerprint(split)).toBe(proofingFingerprint(original));
  split[0].runs[0].noProof = true; expect(proofingFingerprint(split)).not.toBe(proofingFingerprint(original));
  delete split[0].runs[0].noProof; split[0].runs[0].fontLanguage = 'en-AU';
  expect(proofingFingerprint(split)).not.toBe(proofingFingerprint(original));
});
it.each(['control', 'hyperlink', 'table'])('retains source offsets through a supported %s wrapper', async name => {
  const parts = unzipSync(readFileSync('tests/fixtures/proofing-state/proofing-flagged.docx'));
  let document = strFromU8(parts['word/document.xml']);
  const start = document.indexOf('<w:p>'), end = document.indexOf('</w:p>') + 6, paragraph = document.slice(start, end), content = paragraph.slice(5, -6);
  if (name === 'control') document = document.slice(0, start) + `<w:p><w:sdt><w:sdtPr><w:id w:val="10"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt></w:p>` + document.slice(end);
  else if (name === 'hyperlink') {
    document = document.replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ').replace(paragraph, `<w:p><w:hyperlink r:id="link">${content}</w:hyperlink></w:p>`);
    parts['word/_rels/document.xml.rels'] = strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('</Relationships>', '<Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org" TargetMode="External"/></Relationships>'));
  } else document = document.replace(paragraph, `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2000"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl>`);
  parts['word/document.xml'] = strToU8(document);
  const pkg = await DocxPackage.open(zipSync(parts)); expect(pkg.savedSpelling.ranges).toEqual([{ start: 0, end: 5 }]);
  expect(pkg.savedSpelling.text).toContain('jumpd');
  const d = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  d.select(1, 3); d.setRunFormat({ bold: true });
  const exported = new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  const reopened = await DocxPackage.open(exported);
  expect(reopened.savedSpelling.ranges).toEqual([{ start: 0, end: 5 }]);
  const written = new DOMParser().parseFromString(strFromU8(unzipSync(exported)['word/document.xml']), 'application/xml');
  const markers = [...written.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'proofErr')];
  expect(markers).toHaveLength(2);
  expect(markers.map(marker => marker.parentNode.localName)).toEqual(Array(2).fill(name === 'control' ? 'sdtContent' : name === 'hyperlink' ? 'hyperlink' : 'p'));
  expect(unzipSync(exported)['word/settings.xml']).toEqual(parts['word/settings.xml']);
});
