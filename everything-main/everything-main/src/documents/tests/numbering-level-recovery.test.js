import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/numbering-level-recovery/${name}.docx`);
const variants = ['duplicate-level', 'missing-level-index', 'invalid-level-index', 'duplicate-override', 'missing-override-index', 'invalid-override-index', 'invalid-start'];

it.each(variants)('isolates a malformed numbering level and preserves healthy lists: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  const args = [pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets];
  const doc = new TextDocument(...args, { displayOnly: true });
  expect(listMarkers(doc.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.', '2.']);
  const header = pkg.pageStories.stories['word/header1.xml'];
  const story = new TextDocument(header.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, header.tables, pkg.assets, { displayOnly: true });
  expect(listMarkers(story.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.']);
  const retained = [...doc.paragraphs, ...story.paragraphs].filter(p => p.runs[0]?.text.startsWith('Retained ') && p.runs.some(r => r.image));
  expect(retained).toHaveLength(3);
  for (const p of retained) {
    expect(p.list).toBeNull();
    expect(p.runs[0]).toMatchObject({ bold: true, color: '204080', fontSize: 18 });
    expect(p.runs.at(-1).italic).toBe(true);
  }
  const original = unzipSync(bytes);
  expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(pkg.parts[part], part).toEqual(original[part]);
  expect(pkg.previewIssues.some(message => message.includes('word/numbering.xml'))).toBe(true);
  expect(() => pkg.export()).toThrow('read-only');
});

it('keeps the matched healthy control editable and unchanged on export', async () => {
  const bytes = source('healthy');
  const pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('keeps an ambiguous level invalid after three declarations in either order', async () => {
  for (const reverse of [false, true]) {
    const parts = unzipSync(source('duplicate-level'));
    let xml = strFromU8(parts['word/numbering.xml']);
    const levels = xml.match(/<w:lvl w:ilvl="0?1">.*?<\/w:lvl>/g);
    expect(levels).toHaveLength(2);
    const declarations = [...levels, levels[0].replace('w:val="%2."', 'w:val="WRONG"')];
    xml = xml.replace(levels.join(''), (reverse ? declarations.reverse() : declarations).join(''));
    parts['word/numbering.xml'] = strToU8(xml);
    const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
    expect(pkg.numbering.abstracts['0'].levels[1].error).toContain('Duplicate lvl index 1');
    expect(pkg.numbering.abstracts['0'].levels[0].text).toBe('%1.');
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, {displayOnly:true});
    expect(listMarkers(doc.paragraphs, pkg.numbering).filter(Boolean).map(m => m.text)).toEqual(['1.', '2.']);
  }
});
