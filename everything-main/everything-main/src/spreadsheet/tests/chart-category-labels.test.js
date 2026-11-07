import { describe, it, expect } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const categoryLabels = (svg) => [...svg.matchAll(/<text x="[^"]+" y="[^"]+" text-anchor="(?:middle|end)" font-size="11" fill="var\(--ink-2\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const chart = (categories, extra = {}) => renderChartSvg({ categories, series: [{ name: 'v', values: categories.map((_, i) => i + 1) }] }, { type: 'column', legend: false, ...extra }, 640, 300);

describe('long category labels', () => {
  it('keeps labels that share a long prefix apart by showing their tails', () => {
    const labels = categoryLabels(chart(['Department of Finance', 'Department of Health', 'Department of Labour']));
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toMatch(/^…/);
    expect(labels[0]).toMatch(/Finance$/);
    expect(labels[1]).toMatch(/Health$/);
    expect(labels[2]).toMatch(/Labour$/);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(14);
  });

  it('shortens labels from the end when their starts already tell them apart', () => {
    expect(categoryLabels(chart(['Alpha long category name', 'Beta', 'Gamma long category name']))).toEqual(['Alpha long ca…', 'Beta', 'Gamma long ca…']);
    expect(categoryLabels(chart(['Jan', 'Feb', 'Mar']))).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('applies the same to bar and radar charts', () => {
    // Bar labels get 18 characters: these two still differ when cut at the end, so they are.
    const bar = renderChartSvg({ categories: ['Department of Finance and Trade', 'Department of Health and Care'], series: [{ name: 'v', values: [1, 2] }] }, { type: 'bar', legend: false }, 640, 300);
    expect(categoryLabels(bar)).toEqual(['Department of Fin…', 'Department of Hea…']);
    // These would not, so their shared start goes instead.
    const tails = renderChartSvg({ categories: ['Department of Finance and Trade', 'Department of Finance and Care'], series: [{ name: 'v', values: [1, 2] }] }, { type: 'bar', legend: false }, 640, 300);
    expect(categoryLabels(tails)).toEqual(['…Trade', '…Care']);
    const radar = renderChartSvg({ categories: ['Department of Finance', 'Department of Health', 'Department of Labour'], series: [{ name: 'v', values: [1, 2, 3] }] }, { type: 'radar', legend: false }, 480, 300);
    const radarLabels = [...radar.matchAll(/text-anchor="(?:middle|start|end)" font-size="11" fill="var\(--ink-2\)">([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(new Set(radarLabels).size).toBe(3);
  });

  it('measures CJK and emoji labels at their real width, thinning them where Latin labels of the same length still fit', () => {
    const labelsOf = (categories) => categoryLabels(renderChartSvg({ categories, series: [{ name: 'v', values: categories.map((_, i) => i + 1) }] }, { type: 'column', legend: false }, 480, 300));
    // Eight slots of about 52px: six Latin characters (about 37px) fit, six CJK characters (about 66px) do not.
    expect(labelsOf(Array.from({ length: 8 }, (_, i) => `Dept ${i}`))).toHaveLength(8);
    const cjk = labelsOf(Array.from({ length: 8 }, (_, i) => `部門名称第${i}`));
    expect(cjk.length).toBeLessThan(8);
    expect(cjk.length).toBeGreaterThanOrEqual(4);
    const emoji = labelsOf(Array.from({ length: 8 }, (_, i) => `🏥🏥🏥🏥${i}`));
    expect(emoji.length).toBeLessThan(8);
  });

  it('cuts titles and labels between characters, never through an emoji', () => {
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const title = renderChartSvg({ categories: ['a'], series: [{ name: 's', values: [1] }] }, { type: 'column', title: '😀'.repeat(40) }, 170, 120);
    expect(title).not.toMatch(loneSurrogate);
    expect(title).toContain(`${'😀'.repeat(17)}…`); // 18 code points fit: 17 kept and the ellipsis
    const ends = categoryLabels(chart(['😀'.repeat(20), 'Beta']));
    expect(ends).toEqual([`${'😀'.repeat(13)}…`, 'Beta']);
    const tails = categoryLabels(chart(['Department 🏥🏥🏥🏥 of Finance', 'Department 🏥🏥🏥🏥 of Health']));
    expect(tails).toEqual(['…Finance', '…Health']);
    for (const label of [...ends, ...tails]) expect(label).not.toMatch(loneSurrogate);
  });
});
