import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calc } from './helpers/calc.js';
import { prepareSeries, fitEts, forecastAt, confidenceAt, detectSeasonality, statWindow } from '../src/core/forecast-ets.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/reference-forecast-ets.json', import.meta.url), 'utf8'));
const cellsOf = (x, y) => {
  const cells = {};
  x.forEach((v, i) => { cells[`A${i + 1}`] = v; if (y[i] != null) cells[`B${i + 1}`] = y[i]; });
  return cells;
};
const value = (v) => (v && typeof v === 'object' ? v.error : v);
const series = (y, x = y.map((_, i) => i + 1)) => prepareSeries(x.map((v, i) => [v, y[i]]));

describe('FORECAST.ETS family against Excel', () => {
  for (const set of fixture.edge) {
    const exact = set.checks.filter((c) => c[2]);
    if (!exact.length) continue;
    it(`matches Excel exactly: ${set.name}`, () => {
      const cells = cellsOf(set.x, set.y);
      for (const [formula, expected] of exact) {
        const got = value(calc(formula, cells));
        if (typeof expected === 'number') expect(got, formula).toBeCloseTo(expected, 8);
        else expect(got, formula).toBe(expected);
      }
    });
  }

  it('matches Excel’s double exponential smoothing when given its α and β', () => {
    for (const set of fixture.holt) {
      const { excel } = set;
      const model = fitEts(series(set.y, set.x), 0, { alpha: excel.alpha, beta: excel.beta, gamma: 0 });
      const n = set.y.length;
      [1, 2, 3, 6].forEach((h, i) => {
        expect(forecastAt(model, n + h)).toBeCloseTo(excel.forecast[i], 8);
        expect(confidenceAt(model, n + h) / excel.confint[i]).toBeCloseTo(1, 6);
      });
      expect(model.mae).toBeCloseTo(excel.mae, 9);
      expect(model.rmse).toBeCloseTo(excel.rmse, 9);
      expect(model.smape).toBeCloseTo(excel.smape, 9);
      expect(model.mase).toBeCloseTo(excel.mase, 9);
    }
  });

  it('stays close to Excel with its own parameter search (documented tolerance)', () => {
    // Excel's optimiser is undocumented; across these 48 series (with and without seasons) the
    // median forecast is within 0.2% of Excel's and nine in ten within 5%.
    const errors = [];
    for (const set of fixture.auto) {
      const n = set.y.length;
      const model = fitEts(series(set.y), 1);
      [1, 2, 5, 13].forEach((h, i) => errors.push(Math.abs(forecastAt(model, n + h) - set.forecast[i]) / Math.abs(set.forecast[i])));
    }
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.002);
    expect(errors[Math.floor(errors.length * 0.9)]).toBeLessThan(0.05);
  });

  it('detects the season length Excel detects for clearly seasonal data', () => {
    let agree = 0;
    for (const set of fixture.auto) if (detectSeasonality(series(set.y).y) === set.seasonality) agree++;
    expect(agree / fixture.auto.length).toBeGreaterThan(0.8);
    const wave = Array.from({ length: 36 }, (_, i) => 50 + 10 * Math.sin((2 * Math.PI * i) / 6) + i * 0.5);
    expect(detectSeasonality(wave)).toBe(6);
  });

  it('covers the last points in its accuracy statistics', () => {
    expect([8, 10, 11, 15, 24, 25, 30, 50, 54, 70].map(statWindow)).toEqual([8, 10, 4, 6, 9, 10, 10, 10, 11, 14]);
  });

  it('answers for each target of an array and checks its arguments', () => {
    const cells = cellsOf([1, 2, 3, 4, 5, 6, 7, 8], [5, 7, 9, 11, 13, 15, 17, 19]);
    expect(calc('SUM(FORECAST.ETS({9,10},B1:B8,A1:A8))', cells)).toBeCloseTo(44, 9);
    expect(value(calc('FORECAST.ETS(9,B1:B8,A1:A7)', cells))).toBe('#N/A');
    expect(value(calc('FORECAST.ETS(9,B1:B8,A1:A8,-1)', cells))).toBe('#NUM!');
    expect(value(calc('FORECAST.ETS.STAT(B1:B8,A1:A8,9)', cells))).toBe('#NUM!');
    expect(value(calc('FORECAST.ETS.CONFINT(9,B1:B8,A1:A8,1)', cells))).toBe('#NUM!');
    expect(calc('FORECAST.ETS.STAT(B1:B8,A1:A8,1)', cells)).toBe(0.9);
    expect(calc('FORECAST.ETS.SEASONALITY(B1:B8,A1:A8)', cells)).toBe(0);
  });
});
