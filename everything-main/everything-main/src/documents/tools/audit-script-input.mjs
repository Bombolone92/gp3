// Compare insertion flags without enabling unsupported source editing.
// This diagnostic reports differences; it is not a test requiring them to stay.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

const root = fileURLToPath(new URL('../tests/fixtures/script-input/', import.meta.url));
const dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
try {
  const cases = JSON.parse(readFileSync(root+'cases.json','utf8'));
  const source = await DocxPackage.open(readFileSync(root+'control.docx'),{bestEffort:true});
  const native = await DocxPackage.open(readFileSync(root+'native.docx'),{bestEffort:true});
  const flags = p => p.runs.flatMap(r => Array(r.text.length).fill([!!r.cs,!!r.rtl]));
  const differences = [];
  for (const [index,c] of cases.entries()) {
    // Already-resolved paragraph component: do not remove the package guard.
    const doc = new TextDocument([source.paragraphs[index]]); doc.select(1); doc.replace(c.text);
    const actual = flags(doc.paragraphs[0]), expected = flags(native.paragraphs[index]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) differences.push({index,...c,actual,expected});
  }
  console.log(JSON.stringify({cases:cases.length,mismatches:differences.length,
    byFlag:Object.fromEntries(['','cs','rtl'].map(flag => [flag||'ordinary',differences.filter(c => c.flag===flag).length])),differences},null,2));
} finally { dom.window.close(); }
