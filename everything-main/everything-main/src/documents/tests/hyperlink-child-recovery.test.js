import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/hyperlink-child-recovery/${name}.docx`);

it.each(['leading', 'trailing', 'multiple'])('isolates unsupported hyperlink children in body, cell and page stories: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow(name === 'deleted' ? 'del' : 'permStart');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.previewIssues.some(message => message.includes(name === 'deleted' ? 'del' : 'permStart'))).toBe(true);
  const original = unzipSync(bytes);
  expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(pkg.tables).toHaveLength(1);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const all = [...doc.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(story => story.paragraphs)];
  for (const number of [10, 20, 30, 40]) {
    const p = all.find(p => paragraphText(p).includes(`Linked ${number}`));
    expect(p.format.indentLeft).toBe(360);
    expect(p.runs.filter(run => run.image)).toHaveLength(1);
    expect(p.runs.filter(run => !run.image).map(run => run.text).join('')).toBe(`Before Linked ${number}After picture End`);
    const linked = p.runs.filter(run => run.link);
    expect(linked).toHaveLength(3);
    expect(linked.every(run => run.link.target === 'https://example.com/retained')).toBe(true);
    expect(p.runs.find(run => run.text === `Linked ${number}`)).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
  }
  expect(() => pkg.export()).toThrow('read-only');
});

it('opens tracked deletions inside hyperlinks as editable revisions with exact no-edit serialization', async () => {
  const bytes = source('deleted'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  const runs = [...pkg.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(story => story.paragraphs)].flatMap(p => p.runs);
  expect(runs.some(run => run.link && run.revision?.type === 'del')).toBe(true);
  const saved = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(pkg.parts)) expect(Buffer.from(saved[part]).equals(Buffer.from(pkg.parts[part])), part).toBe(true);
});

it('leaves the matched supported control editable with exact no-edit serialization', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
  const saved = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(pkg.parts)) expect(Buffer.from(saved[part]).equals(Buffer.from(pkg.parts[part])), part).toBe(true);
});
