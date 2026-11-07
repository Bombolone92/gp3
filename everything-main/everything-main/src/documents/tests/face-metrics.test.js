import {it, expect} from 'vitest';
import {measuredFaceMetrics} from '../src/engine/face-metrics.js';

it('retains native metrics for other families and substituted Gothic faces', () => {
  const sameBox = {ascent: 220/256, descent: 36/256};
  for (const family of [undefined, 'Calibri', 'Unreviewed Font'])
    expect(measuredFaceMetrics(family, sameBox)).toBe(sameBox);
  for (const metrics of [{ascent:1,descent:.2}, {ascent:220/256,descent:.2}, {ascent:1,descent:36/256}])
    expect(measuredFaceMetrics('MS Gothic', metrics)).toBe(metrics);
});

it('does not mutate the underlying font measurements', () => {
  const native = Object.freeze({ascent:220/256,descent:36/256});
  const result = measuredFaceMetrics(' ms gothic ', native);
  expect(result).not.toBe(native);
  expect(measuredFaceMetrics('Calibri', native)).toBe(native);
});

it('limits the YaHei native leading to its verified family and face geometry', () => {
  const native = Object.freeze({ascent:2167/2048,descent:536/2048});
  expect(measuredFaceMetrics(' Microsoft YaHei ', native)).toEqual({ascent:2572/2048,descent:941/2048});
  for (const family of [undefined, 'Arial', 'Microsoft YaHei UI', 'Unreviewed Font'])
    expect(measuredFaceMetrics(family, native)).toBe(native);
  for (const metrics of [{ascent:1,descent:536/2048}, {ascent:2167/2048,descent:.2}])
    expect(measuredFaceMetrics('Microsoft YaHei', metrics)).toBe(metrics);
  expect(native).toEqual({ascent:2167/2048,descent:536/2048});
});
