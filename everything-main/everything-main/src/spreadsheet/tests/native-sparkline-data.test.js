import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { nativeSparklineData, nativeSparklineAt } from '../src/core/native-sparkline-data.js';
import { renderNativeSparklineSvg, nativeSparklineLabel } from '../src/ui/native-sparkline.js';
const make = (settings = {}, values = [2, 4, -1]) => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Source', sparklineGroups: [{ ...settings, sparklines: [{ ref: 'D1', formula: 'A1:A3' }, { ref: 'D2', formula: 'B1:B3' }] }] }] });
  for (let i = 0; i < values.length; i++) if (values[i] != null) wb.setInput('s', i, 0, String(values[i]));
  [10, 20, 30].forEach((v, i) => wb.setInput('s', i, 1, String(v)));
  return wb;
};
const data = (wb, r = 0) => nativeSparklineData(wb, 's', r, 3);
it('reads live numeric data independently of destination values and reuses calculations', () => {
  const wb = make(), spy = vi.spyOn(wb, 'getValue');
  const first = data(wb); expect(first.points.map(p => p.value)).toEqual([2, 4, -1]);
  expect(first).toMatchObject({ min: -1, max: 4, minAxis: -1, maxAxis: 4, count: 3 });
  expect(data(wb)).toBe(first); expect(spy).toHaveBeenCalledTimes(3); // Individual axes read only the visible member.
  expect(wb.getValue('s', 0, 3)).toBeNull();
  wb.setInput('s', 1, 0, '7'); expect(data(wb).max).toBe(7);
  wb.undo(); expect(data(wb).max).toBe(4);
  wb.setInput('s', 0, 3, 'Text'); expect(wb.getValue('s', 0, 3)).toBe('Text'); expect(data(wb).count).toBe(3);
});
it.each(['gap', 'span', 'zero'])('distinguishes blanks, errors, text and hidden values for %s mode', mode => {
  const wb = make({ displayEmptyCellsAs: mode }, [1, null, 3]);
  expect(data(wb).points.map(p => p.value)).toEqual([1, mode === 'zero' ? 0 : null, 3]);
  wb.setInput('s', 1, 0, 'text'); expect(data(wb).points[1].value).toBeNull();
  wb.setInput('s', 1, 0, '=1/0'); expect(data(wb).points[1].value).toBeNull();
  wb.setHidden('s', 'row', [0], true);
  expect(data(wb).points.map(p => p.index)).toEqual([1, 2]);
  expect(data(wb).points.map(p => p.x)).toEqual([0, 1]);
});
it('uses group/custom axis bounds and updates all members when one source changes', () => {
  const wb = make({ minAxisType: 'custom', manualMin: -10, maxAxisType: 'group' });
  expect(data(wb)).toMatchObject({ minAxis: -10, maxAxis: 30 });
  expect(data(wb, 1)).toMatchObject({ minAxis: -10, maxAxis: 30 });
  wb.setInput('s', 2, 1, '90'); expect(data(wb).maxAxis).toBe(90);
  wb.undo(); expect(data(wb).maxAxis).toBe(30);
});
it('resolves local and qualified names in the owner scope, not the active sheet', () => {
  const wb = make(); wb.defineName('Series', 'Source!A1:A3', 'Source');
  const other = wb.addSheet('Other'); wb.defineName('Series', 'Other!A1:A3', 'Other');
  wb.setInput(other.id, 0, 0, '999'); wb.setActiveSheet(other.id);
  wb.sheet('s').sparklineGroups[0].sparklines[0].formula = 'Series';
  expect(data(wb).points.map(p => p.value)).toEqual([2, 4, -1]);
  wb.sheet('s').sparklineGroups[0].sparklines[0].formula = 'Other!Series'; wb.setInput('s', 8, 0, '1');
  expect(data(wb).points[0].value).toBe(999);
});
it('aligns dates with source positions after filtering hidden cells and rejects unavailable bindings', () => {
  const wb = make({ dateAxis: true, dateFormula: 'B1:B3' });
  expect(data(wb).points.map(p => p.x)).toEqual([10, 20, 30]);
  wb.setHidden('s', 'row', [1], true); expect(data(wb).points.map(p => p.x)).toEqual([10, 30]);
  wb.sheet('s').sparklineGroups[0].dateFormula = 'Missing!A1:A3'; wb.setInput('s', 8, 0, '1');
  expect(data(wb).unavailable).toBe(true); expect(nativeSparklineLabel(data(wb))).toContain('source unavailable');
});
it('resolves native theme tints and shows hidden values when requested', () => {
  const wb = make({ displayHidden: true, colorSeries: { theme: 5, tint: 0.5 } });
  wb.setHidden('s', 'row', [0], true); expect(data(wb).points).toHaveLength(3);
  expect(data(wb).colors.series).toMatch(/^#[a-f\d]{6}$/);
  expect(nativeSparklineAt(wb, 's', 0, 0)).toBeNull();
});
it('draws native line weights, gaps, marker flags and right-to-left direction', () => {
  const wb = make({ lineWeight: 3, high: true, low: true, rightToLeft: true, colorHigh: { rgb: 'FF123456' }, colorLow: { rgb: 'FFABCDEF' } });
  const svg = renderNativeSparklineSvg(data(wb), 120, 30);
  expect(svg).toContain('stroke-width="4"'); expect(svg).toContain('fill="#123456"'); expect(svg).toContain('fill="#abcdef"');
  expect(svg).toContain('data-point="1"'); expect(svg).toContain('data-point="2"'); expect(svg).not.toContain('data-point="0"');
  const gap = make({ displayEmptyCellsAs: 'gap' }, [1, null, 3]);
  expect(renderNativeSparklineSvg(data(gap), 100, 20)).toMatch(/d="M[^"]*M/);
  const span = make({ displayEmptyCellsAs: 'span' }, [1, null, 3]);
  expect(renderNativeSparklineSvg(data(span), 100, 20)).toMatch(/d="M[^"]*L/);
});
it.each(['column', 'stacked'])('renders %s zero values without fake bars, preserving sign colors and axis', type => {
  const wb = make({ type, negative: true, displayXAxis: true, colorNegative: { rgb: 'FF990000' } }, [-5, 0, 10]);
  const svg = renderNativeSparklineSvg(data(wb), 120, 30);
  expect(svg.match(/<rect/g)).toHaveLength(2); expect(svg).toContain('fill="#990000"'); expect(svg).not.toContain('data-point="1"');
  expect(svg).toContain('<path'); expect(svg).not.toMatch(/NaN|Infinity/);
});
it('does not truncate a valid vector to the formula-sparkline limit', () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'S', sparklineGroups: [{ sparklines: [{ ref: 'D1', formula: 'A1:A1200' }] }] }] });
  wb.setInput('s', 1199, 0, '100');
  expect(data(wb).points).toHaveLength(1200); expect(data(wb).points.at(-1).value).toBe(100);
});
it('renders constant and extreme finite line values without invalid coordinates', () => {
  for (const values of [[3, 3, 3], [-1e308, 0, 1e308]]) {
    const svg = renderNativeSparklineSvg(data(make({}, values)), 120, 30);
    expect(svg).not.toMatch(/NaN|Infinity/); expect(svg).toContain('<path');
  }
});

it('invalidates live data on explicit recalculation without a saved-version change', () => {
  const wb = make(); wb.setInput('s', 0, 0, '=RAND()');
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  try {
    const version = wb.version;
    expect(data(wb).points[0].value).toBe(0.25);
    spy.mockReturnValue(0.75); wb.recalculate();
    expect(wb.version).toBe(version); expect(data(wb).points[0].value).toBe(0.75);
  } finally { spy.mockRestore(); }
});

it('spans empty cells but never joins across error values', () => {
  const wb = make({ displayEmptyCellsAs: 'span' }, [1, null, 3]);
  expect(renderNativeSparklineSvg(data(wb), 100, 20)).toMatch(/d="M[^"]*L/);
  wb.setInput('s', 1, 0, '=NA()');
  expect(renderNativeSparklineSvg(data(wb), 100, 20)).toMatch(/d="M[^"]*M/);
});
it('uses the full win/loss height when all nonzero points have the same sign', () => {
  for (const values of [[2, 4, 8], [-2, -4, -8]]) {
    const svg = renderNativeSparklineSvg(data(make({ type: 'stacked' }, values)), 90, 30);
    expect(svg.match(/height="30" fill=/g)).toHaveLength(3);
  }
});

it('does not revisit cached independent axes while rendering additional group members', () => {
  const count = 200;
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Source',
    cells: { '0,0': { v: 2 }, '1,0': { v: 8 } },
    sparklineGroups: [{ sparklines: Array.from({ length: count }, (_, i) => ({ ref: `D${i + 1}`, formula: 'A1:A2' })) }],
  }] });
  let repeatedReads = 0;
  const results = [];
  for (let r = 0; r < count; r++) {
    const result = data(wb, r), min = result.min;
    expect(result).toMatchObject({ minAxis: 2, maxAxis: 8 });
    Object.defineProperty(result, 'min', { get() { repeatedReads++; return min; }, configurable: true });
    results.push(result);
  }
  // Count operations instead of timing: resolving N independent charts must
  // not scan the previously resolved 1 + 2 + ... + (N - 1) results.
  expect(repeatedReads).toBe(0);
  for (let r = 0; r < count; r++) expect(data(wb, r)).toBe(results[r]);
  wb.setInput('s', 0, 0, '-3');
  expect(data(wb)).toMatchObject({ min: -3, minAxis: -3, maxAxis: 8 });
});
