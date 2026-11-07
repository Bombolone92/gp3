import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { chartScale, paintChart } from '../src/engine/canvas-charts.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/column-chart-legends';
const chartOf = p => Object.values(p.assets).find(a => a.chart).chart;
it('retains bottom legend position, text and series order', async () => {
  const chart = chartOf(await DocxPackage.open(readFileSync(`${folder}/bottom-9.docx`)));
  expect(chart.legend).toBe(true); expect(chart.legendPosition).toBe('b');
  expect(chart.legendText).toMatchObject({ fontAscii: 'Arial', fontSize: 9, bold: false, color: '000000' });
  expect(chart.series.map(s => s.name)).toEqual(['Class 1', 'Class 2', 'Class 3']);
});
it('leaves headroom when a positive clustered value reaches an automatic tick', async () => {
  const chart = chartOf(await DocxPackage.open(readFileSync(`${folder}/bottom-clustered.docx`)));
  expect(chartScale(chart.series, chart.grouping)).toEqual({ min: 0, max: 12, step: 2 });
});
it.each([
  ['unimplemented left placement', x => x.replace('legendPos val="b"', 'legendPos val="l"')],
  ['overlaid legend', x => x.replace(/(<c:legend>[\s\S]*?<c:overlay )val="0"/, '$1val="1"')],
  ['manual legend layout', x => x.replace('<c:legend>', '<c:legend><c:layout><c:manualLayout/></c:layout>')],
  ['unresolved legend font', x => x.replace(/(<c:legend>[\s\S]*?)<a:latin typeface="Arial"\/>/, '$1<a:latin typeface="+mn-ea"/>')],
])('guards %s', async (_, mutate) => {
  const parts = unzipSync(readFileSync(`${folder}/bottom-9.docx`)), path = 'word/charts/chart1.xml';
  const original = strFromU8(parts[path]), changed = mutate(original); expect(changed).not.toBe(original);
  parts[path] = strToU8(changed); await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it('keeps the existing all-zero axis fallback outside positive-range density', async () => {
  const chart = chartOf(await DocxPackage.open(readFileSync(`${folder}/bottom-clustered.docx`)));
  for (const series of chart.series) series.values.fill(0);
  const labels = [];
  const ctx = { fontKerning: 'none', save(){}, restore(){}, scale(){}, measureText: t => ({width: t.length * 6}), fillRect(){}, strokeRect(){}, fillText(t){labels.push(t);}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){} };
  paintChart(ctx, chart, 576, 384);
  expect(labels.filter(t => /^\d+%$/.test(t))).toEqual(['0%', '20%']);
});
