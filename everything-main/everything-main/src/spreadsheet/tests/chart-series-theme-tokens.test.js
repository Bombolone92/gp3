import { describe, expect, it } from 'vitest';
import { renderChartSvg, renderSparklineSvg, standaloneSvg, seriesColor, seriesPaint, SERIES_COLORS } from '../src/ui/chartsvg.js';
import { stylesheet, parseRules, declarations, themeTokens } from './helpers/css.js';

// A chart's axes, gridlines and ink have always been CSS variables, and sparklines draw in --series-1,
// but the series fills were a literal light-theme list: on a dark sheet a chart kept the light palette
// while everything around it turned, and the dark --series-* tokens were never reached.
const data = { categories: ['A', 'B'], series: [{ name: 'S1', values: [3, 5] }, { name: 'S2', values: [2, 4] }] };
const chart = { type: 'column', legend: true };

describe('series colours follow the theme', () => {
  it('paints each series with its token, keeping the light colour as the fallback', () => {
    const svg = renderChartSvg(data, chart, 480, 300);
    expect(svg).toContain('fill="var(--series-1, #337bfc)"');
    expect(svg).toContain('fill="var(--series-2, #eb6834)"');
    // A colour the chart was given itself is used as it stands, and so is one past the tokens.
    expect(seriesPaint({ colors: ['#123456'] }, 0)).toBe('#123456');
    expect(seriesPaint(null, 6)).toBe(SERIES_COLORS[6]);
    // The dialog's colour input needs a real colour, so seriesColor still answers with one.
    expect(seriesColor(null, 0)).toBe('#337bfc');
  });

  it('names tokens the stylesheet defines, and each theme gives them its own colours', () => {
    const light = themeTokens('light');
    const dark = themeTokens('dark');
    for (const [i, name] of ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-7'].entries()) {
      expect(seriesPaint(null, i)).toBe(`var(--${name}, ${SERIES_COLORS[i]})`);
      expect(light[name]).toBe(SERIES_COLORS[i]); // the fallback is what the light theme would give
      expect(dark[name]).toBeTruthy();
      expect(dark[name]).not.toBe(light[name]);
    }
  });

  it('still prints on white paper, whatever the screen theme', () => {
    // tokens.css redefines the whole palette under @media print for both :root and the dark stamp.
    const printed = parseRules(stylesheet('tokens.css'))
      .filter((r) => r.media.some((m) => m.includes('print')) && r.selectors.includes(':root[data-theme="dark"]'));
    expect(printed).toHaveLength(1);
    const decls = declarations(printed[0].body);
    for (const [i, name] of ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-7'].entries()) {
      expect(decls[name]).toBe(SERIES_COLORS[i]);
    }
  });

  it('leaves a chart that goes out as a file with real colours, never a variable', () => {
    const svg = renderChartSvg(data, chart, 480, 300);
    const theme = { '--series-1': '#4a8dff', '--series-2': '#ff7a45', '--surface': '#1b1b19', '--ink': '#f5f4f0', '--ink-2': '#c9c7c0', '--ink-3': '#95938c', '--grid': '#33322e' };
    const out = standaloneSvg(svg, (n) => theme[n] || '');
    expect(out).not.toContain('var(');
    expect(out).toContain('fill="#4a8dff"');
    // A page that answers for nothing gives the series the palette's own colours rather than the grey
    // of last resort that a variable with no fallback comes to.
    const bare = standaloneSvg(svg, () => '');
    const bars = [...bare.matchAll(/<rect [^>]*fill="([^"]*)" rx="1"/g)].map((m) => m[1]);
    expect(new Set(bars)).toEqual(new Set(['#337bfc', '#eb6834']));
  });

  it('keeps its colours in forced-colors mode, as the cell-style swatches do', () => {
    expect(renderChartSvg(data, chart, 480, 300)).toContain('style="forced-color-adjust: none"');
    expect(renderSparklineSvg({ type: 'line', values: [1, 2, 3] }, 40, 16)).toContain('style="forced-color-adjust: none"');
    // The grid already exempts its own meaningful colours the same way.
    expect(declarations(parseRules(stylesheet('grid.css')).find((r) => r.media.some((m) => m.includes('forced-colors'))
      && r.selectors.includes('.cell.cf')).body)['forced-color-adjust']).toBe('none');
  });
});
