import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg, standaloneSvg, chartCornerRadius } from '../src/ui/chartsvg.js';

const xml = text => new (new JSDOM('').window.DOMParser)().parseFromString(text, 'application/xml');
const chart = (type, roundedCorners) => ({ type, title: 'Corners', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
  sourceRefs: [{ name: 'Totals', literal: { categories: ['North', 'South'], values: [3, 7], x: [1, 2], sizes: [2, 4] } }],
  appearance: { roundedCorners, background: '#f5d5bb', ...(['pie', 'donut'].includes(type) ? { pie: {} } : {}) } });
const nativeBytes = zip => {
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
};

it.each(['column', 'line', 'bar', 'scatter', 'pie', 'donut'])('imports native boolean corner settings for %s and round trips them after duplication', async type => {
  for (const [element, expected] of [['', undefined], ['<c:roundedCorners/>', true], ...['0', 'false', '1', 'true', ' false ', 'bogus'].map(v => [`<c:roundedCorners val="${v}"/>`, ['0', 'false', ' false '].includes(v) ? false : v === 'bogus' ? undefined : true])]) {
    const wb = new Workbook({ sheets: [{ name: 'Data', charts: [chart(type)] }] });
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/charts/chart1_1.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/(<c:chartSpace\b[^>]*>)/, `$1${element}`)); part.size = part.content.length;
    const back = await workbookFromFile(nativeBytes(zip), 'external.xlsx'), sheet = back.activeSheet;
    expect(sheet.charts[0].appearance.roundedCorners).toBe(expected);
    const copy = back.chartById(sheet.id, back.duplicateChart(sheet.id, sheet.charts[0].id));
    expect(copy.appearance.roundedCorners).toBe(expected);
    copy.sourceRefs[0].literal.values[0] = 11;
    const exported = X.CFB.read(new Uint8Array(await (await workbookToXlsx(back)).arrayBuffer()), { type: 'array' });
    const saved = xml(new TextDecoder().decode(X.CFB.find(exported, '/xl/charts/chart1_2.xml').content));
    const node = saved.getElementsByTagNameNS('*', 'roundedCorners')[0];
    if (expected == null) expect(node).toBeUndefined();
    else expect(node.getAttribute('val')).toBe(expected ? '1' : '0');
    const reopened = await workbookFromFile(nativeBytes(exported), 'native.xlsx');
    expect(reopened.activeSheet.charts[1].appearance.roundedCorners).toBe(expected);
    expect(reopened.activeSheet.charts[1].sourceRefs[0].literal.values[0]).toBe(11);
  }
});

it('retains only actual booleans in normalized appearance', () => {
  for (const value of [null, undefined, 'false', 0, {}, []]) expect(normalizeChart(chart('column', value)).appearance).not.toHaveProperty('roundedCorners');
  for (const value of [true, false]) expect(normalizeChart(chart('column', value)).appearance.roundedCorners).toBe(value);
});

it.each(['column', 'line', 'bar', 'scatter', 'pie', 'donut', 'area'])('clips rounded %s areas in standalone SVG pictures and keeps square areas square', type => {
  for (const rounded of [true, false, undefined]) {
    const wb = new Workbook({ sheets: [{ name: 'Data', charts: [chart(type, rounded)] }] }), s = wb.activeSheet, ch = s.charts[0];
    for (const [w, h] of [[320, 180], [750, 410], [120, 24]]) {
      const doc = xml(standaloneSvg(renderChartSvg(chartData(wb, s.id, ch), ch, w, h), () => ''));
      const root = doc.documentElement, clip = root.getAttribute('clip-path');
      if (rounded !== false) {
        expect(clip).toMatch(/^url\(#chart-area-/);
        const rect = [...doc.querySelectorAll('clipPath')].find(n => `url(#${n.id})` === clip).firstElementChild;
        expect(rect.getAttribute('width')).toBe('100%');
        expect(+rect.getAttribute('rx')).toBe(chartCornerRadius(ch));
      } else expect(clip).toBeNull();
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(root.textContent).toContain('Corners');
    }
  }
});
