import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/clearing-break-recovery/${name}.docx`);
const cases = ['before', 'after', 'both'].flatMap(position => ['left', 'right', 'all'].map(clear => ({ position, clear })));

it.each(cases)('retains rich content around $position clearing breaks ($clear)', async ({ position, clear }) => {
  const bytes = source(`${position}-${clear}`);
  const pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(pkg.tables).toHaveLength(1);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const paragraphs = [...doc.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(story => story.paragraphs)];
  for (const number of [10, 20, 30, 40]) {
    const p = paragraphs.find(p => paragraphText(p).includes(`Linked ${number}`));
    expect(p.format.indentLeft).toBe(360);
    const picture = p.runs.find(run => run.image);
    expect(picture, `picture in story ${number}`).toBeDefined();
    expect(picture.link.target).toBe('https://example.com/retained');
    expect(p.runs.find(run => run.text.startsWith(`Linked ${number}`))).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
    expect(p.runs.find(run => run.text === 'Linked tail')).toMatchObject({ italic: true, link: { target: 'https://example.com/retained' } });
    expect(paragraphText(p).match(/\v/g)).toHaveLength(position === 'both' ? 2 : 1);
    expect(p.runs.filter(run => run.breakClear).map(run => [run.text, run.breakClear])).toEqual(Array(position === 'both' ? 2 : 1).fill(['\v', clear]));
  }
  const original = unzipSync(bytes);
  expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(original);
});

it.each(['before', 'after', 'both'])('keeps clear=none editable with exact serialization: %s', async position => {
  const pkg = await DocxPackage.open(source(`${position}-none`));
  expect(pkg.readOnly).not.toBe(true);
  const saved = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(pkg.parts)) expect(Buffer.from(saved[part]).equals(Buffer.from(pkg.parts[part])), part).toBe(true);
});

it('does not treat malformed clearing values as supported ordinary breaks', async () => {
  const parts = unzipSync(source('before-left'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll('w:clear="left"', 'w:clear="invalid"'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('text-clearing breaks');
});
