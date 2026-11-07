import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = mode => readFileSync(`public/fixtures/story-controls-${mode}.docx`);

it('projects nested block and inline controls before resolving header/footer PAGE fields', async () => {
  const plain = await DocxPackage.open(source('plain'), { bestEffort: true });
  const wrapped = await DocxPackage.open(source('wrapped'));
  expect(wrapped.readOnly).toBeFalsy();
  expect(wrapped.parts).toEqual(unzipSync(source('wrapped')));
  expect(wrapped.pageStories.sections).toEqual(plain.pageStories.sections);
  expect(Object.keys(wrapped.pageStories.stories)).toHaveLength(6);
  for (const [path, story] of Object.entries(wrapped.pageStories.stories)) {
    expect(story.paragraphs).toHaveLength(1);
    expect(story.paragraphs[0].runs).toEqual(plain.pageStories.stories[path].paragraphs[0].runs);
    expect(story.paragraphs[0].format).toEqual(plain.pageStories.stories[path].paragraphs[0].format);
    expect(story.paragraphs[0].runs.at(-1).field).toMatchObject({ type:'PAGE', cachedText:'99' });
  }
  expect(unzipSync(new Uint8Array(await wrapped.export().arrayBuffer()))).toEqual(unzipSync(source('wrapped')));
});

it('retains cached text without interpreting ambiguous containers and keeps healthy story content beside malformed tables in preview', async () => {
  const plain = await DocxPackage.open(source('plain'), { bestEffort:true });
  for (const [replacement, ambiguous] of [['<w:sdtContent/><w:sdtContent>', true], ['<w:sdtContent><w:tbl/>', false]]) {
    const parts = unzipSync(source('wrapped'));
    parts['word/footer-default.xml'] = strToU8(strFromU8(parts['word/footer-default.xml']).replace('<w:sdtContent>', replacement));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
    const pkg = await DocxPackage.open(zipSync(parts), { bestEffort:true });
    expect(pkg.readOnly).toBe(true);
    const footer = pkg.pageStories.stories['word/footer-default.xml'];
    if (ambiguous) {
      expect(footer.paragraphs).toHaveLength(1);
      expect(footer.paragraphs[0].runs).toEqual([{text:'Default '},{text:'99'}]);
      expect(footer.paragraphs[0].format).toBeUndefined();
    }
    else {
      expect(footer.tables).toEqual([]);
      expect(footer.paragraphs.map(p => p.runs)).toEqual(plain.pageStories.stories['word/footer-default.xml'].paragraphs.map(p => p.runs));
    }
    expect(pkg.pageStories.stories['word/header-default.xml'].paragraphs).toHaveLength(1);
    expect(pkg.parts).toEqual(parts);
    expect(() => pkg.export()).toThrow(/read-only/);
  }
});
