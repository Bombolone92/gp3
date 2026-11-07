import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
const source = readFileSync('public/fixtures/small-line-spacing.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
it('retains all twelve table cells and their positive/zero point line settings', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  expect(p.tables).toHaveLength(1); expect(p.tables[0].rows).toHaveLength(6);
  const probes = p.paragraphs.filter(p => p.runs.map(r => r.text).join('') === 'Ag\vBg');
  expect(probes).toHaveLength(12);
  const l = layoutDocument(d.paragraphs, (text, style) => ({ width: text.length * style.fontSize / 2, ascent: 12, descent: 4 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
  for (const p of probes) {
    const lines = l.lines.filter(line => line.paragraphId === p.id);
    const exact = p.format.lineRule === 'exact' && p.format.lineSpacing > 0;
    const height = exact ? p.format.lineSpacing * 4 / 3 : Math.max(16, p.format.lineSpacing * 4 / 3);
    expect(lines).toHaveLength(2); expect(lines[1].baseline - lines[0].baseline).toBeCloseTo(height);
    expect(lines[0].clip).toBe(exact);
  }
  expect(unzipSync(await save(p, d))).toEqual(unzipSync(source));
});
it.each(['exact', 'atLeast'])('edits small %s values, reopens and undoes without losing table structure', async lineRule => {
  const p = await DocxPackage.open(source), d = model(p);
  d.select(d.text.indexOf('Ag'));
  for (const lineSpacing of [0, .05, 1, 5.95]) {
    d.setParagraphLineSpacing({ lineRule, lineSpacing });
    const reopened = await DocxPackage.open(await save(p, d));
    expect(reopened.tables).toHaveLength(1);
    expect(reopened.paragraphs.find(p => p.runs.map(r => r.text).join('') === 'Ag\vBg').format).toMatchObject({ lineRule, lineSpacing });
  }
  while (d.history.length) d.undo(); expect(unzipSync(await save(p, d))).toEqual(unzipSync(source));
});
it('accepts small inherited style spacing and preserves style changes across export', async () => {
  const p = await DocxPackage.open(readFileSync('public/fixtures/style-line-spacing.docx')), d = model(p);
  for (const lineRule of ['atLeast', 'exact']) for (const lineSpacing of [0, 1]) {
    d.editParagraphStyle('SharedBase', { paragraph: { lineRule, lineSpacing } });
    const reopened = await DocxPackage.open(await save(p, d));
    expect(reopened.styles.definitions.SharedBase.properties.spacing).toMatchObject({ lineRule, line: String(lineSpacing * 20) });
  }
  while (d.history.length) d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
}, 30000);
