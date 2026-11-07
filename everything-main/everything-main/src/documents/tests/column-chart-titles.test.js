import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/column-chart-titles';
const chartOf = p => Object.values(p.assets).find(a => a.chart).chart;
it('inherits paragraph formatting and overrides individual title runs', async () => {
  const chart = chartOf(await DocxPackage.open(readFileSync(`${folder}/mixed.docx`)));
  const runs = chart.title.paragraphs[0].runs;
  expect(runs.map(r => r.text)).toEqual(['Measured ', 'Title']);
  expect(runs[0].style).toMatchObject({ fontAscii: 'Arial', fontSize: 11, bold: false });
  expect(runs[1].style).toMatchObject({ fontAscii: 'Arial', fontSize: 18, bold: true, color: '993366' });
  expect(chart.title.overlay).toBe(false);
});
it('retains all source title text beyond the native display limit', async () => {
  const bytes = readFileSync(`${folder}/wrap-probe-288.docx`), pkg = await DocxPackage.open(bytes);
  expect(chartOf(pkg).title.paragraphs[0].runs[0].text.length).toBe(319);
});
it('reads overlay without deleting the title', async () => {
  expect(chartOf(await DocxPackage.open(readFileSync(`${folder}/overlay.docx`))).title.overlay).toBe(true);
});
it.each([
  ['manual layout', x => x.replace('<c:overlay', '<c:layout><c:manualLayout/></c:layout><c:overlay')],
  ['run decoration', x => x.replace('lang="en-US"', 'lang="en-US" u="sng"')],
  ['unsupported script', x => x.replace('Measured Title', '标题')],
  ['astral symbol', x => x.replace('Measured Title', 'Title 😀')],
  ['line break', x => x.replace('Measured Title', 'Measured&#10;Title')],
  ['duplicate text', x => x.replace('</a:t>', '</a:t><a:t>Duplicate</a:t>')],
])('guards %s without allowing unsafe editing', async (_, mutate) => {
  const parts = unzipSync(readFileSync(`${folder}/regular.docx`)), path = 'word/charts/chart1.xml';
  const xml = strFromU8(parts[path]), changed = mutate(xml); expect(changed).not.toBe(xml);
  parts[path] = strToU8(changed); await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it('uses the schema true default for a present overlay without val', async () => {
  const parts = unzipSync(readFileSync(`${folder}/regular.docx`)), path = 'word/charts/chart1.xml';
  parts[path] = strToU8(strFromU8(parts[path]).replace('<c:overlay val="0"/>', '<c:overlay/>'));
  expect(chartOf(await DocxPackage.open(zipSync(parts))).title.overlay).toBe(true);
});
