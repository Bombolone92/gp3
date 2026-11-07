import { expect, it } from 'vitest';
import presets from '../src/vendor/drawingml-presets.js';
import { drawingGeometry, drawingArc, ellipsePoint } from '../src/core/drawingml-geometry.js';

const node = (name, attrs = {}, children = []) => ({ name, attrs, children });
const preset = (name, adjustments = []) => node('prstGeom', { prst: name }, [node('avLst', {}, adjustments.map(([name, fmla]) => node('gd', { name, fmla })))]);

it('resolves every preset at square, portrait, landscape and extreme aspect ratios', () => {
  expect(Object.keys(presets)).toHaveLength(187);
  for (const [w, h] of [[21600, 21600], [952500, 1562100], [1562100, 952500], [100, 1], [1, 100]]) {
    for (const name of Object.keys(presets)) {
      const result = drawingGeometry(preset(name), w, h, presets);
      expect(result, `${name} at ${w}×${h}`).not.toBeNull();
      expect(result.rect.every(Number.isFinite)).toBe(true);
      expect(result.paths.length).toBeGreaterThan(0);
      expect(result.connections).toHaveLength(presets[name].connections.length);
      for (const site of result.connections) expect(site?.every(Number.isFinite), `${name} connection site`).toBe(true);
      for (const path of result.paths) expect(path.commands.every(c => c.slice(1).every(Number.isFinite))).toBe(true);
    }
  }
});

it('resolves connection-site order and approach angles independently of fixed path coordinates', () => {
  expect(drawingGeometry(preset('rect'), 300, 80, presets).connections).toEqual([
    [150, 0, 16200000], [0, 40, 10800000], [150, 80, 5400000], [300, 40, 0],
  ]);
  const custom = node('custGeom', {}, [
    node('gdLst', {}, [node('gd', { name: 'siteX', fmla: '*/ w 3 4' }), node('gd', { name: 'angle', fmla: 'val cd4' })]),
    node('cxnLst', {}, [node('cxn', { ang: 'angle' }, [node('pos', { x: 'siteX', y: 'h' })])]),
    node('pathLst', {}, [node('path', { w: '100', h: '100' }, [node('moveTo', {}, [node('pt', { x: '0', y: '0' })]), node('lnTo', {}, [node('pt', { x: '100', y: '100' })])])]),
  ]);
  const result = drawingGeometry(custom, 300, 80);
  expect(result.paths[0].commands).toEqual([['M', 0, 0], ['L', 300, 80]]);
  expect(result.connections).toEqual([[225, 80, 5400000]]);
});

it('uses adjusted guides for sites and retains sites on zero-axis geometry', () => {
  const normal = drawingGeometry(preset('chevron'), 300, 80, presets);
  const adjusted = drawingGeometry(preset('chevron', [['adj', 'val 25000']]), 300, 80, presets);
  expect(adjusted.connections[1]).toEqual([20, 40, 10800000]);
  expect(adjusted.connections[1]).not.toEqual(normal.connections[1]);
  for (const [w, h] of [[0, 80], [130, 0], [0, 0]]) {
    expect(drawingGeometry(preset('rect'), w, h, presets).connections).toEqual([
      [w / 2, 0, 16200000], [0, h / 2, 10800000], [w / 2, h, 5400000], [w, h / 2, 0],
    ]);
  }
});

it('bounds malformed sites without dropping valid paths or shifting later site indices', () => {
  const site = (x = 'w', y = 'vc', ang = '0') => node('cxn', { ang }, [node('pos', { x, y })]);
  const custom = sites => node('custGeom', {}, [node('cxnLst', {}, sites),
    node('pathLst', {}, [node('path', {}, [node('moveTo', {}, [node('pt', { x: '0', y: '0' })]), node('lnTo', {}, [node('pt', { x: 'w', y: 'h' })])])]),
  ]);
  const result = drawingGeometry(custom([node('cxn'), site('missing'), site('1e1000'), site('w', 'vc', 'badAngle'), site()]), 30, 20);
  expect(result.connections).toEqual([null, null, null, null, [30, 10, 0]]);
  expect(result.paths[0].commands).toEqual([['M', 0, 0], ['L', 30, 20]]);
  expect(drawingGeometry(custom(Array.from({ length: 1100 }, () => site())), 30, 20).connections).toHaveLength(1024);
});

it('uses the standard document curve and text rectangle without treating Bezier controls as bounds', () => {
  const result = drawingGeometry(preset('flowChartDocument'), 21600, 21600, presets);
  expect(result.rect).toEqual([0, 0, 21600, 17322]);
  expect(result.paths[0].commands).toEqual([
    ['M', 0, 0], ['L', 21600, 0], ['L', 21600, 17322], ['C', 10800, 17322, 10800, 23922, 0, 20172], ['Z'],
  ]);
});

it('honors adjustment guides, including their preset limits', () => {
  const normal = drawingGeometry(preset('roundRect'), 200, 100, presets);
  const square = drawingGeometry(preset('roundRect', [['adj', 'val 0']]), 200, 100, presets);
  const rounded = drawingGeometry(preset('roundRect', [['adj', 'val 50000']]), 200, 100, presets);
  const clipped = drawingGeometry(preset('roundRect', [['adj', 'val 999999']]), 200, 100, presets);
  expect(square.paths[0].commands).not.toEqual(normal.paths[0].commands);
  expect(rounded).toEqual(clipped);
});

it('converts polar ellipse angles and complete clockwise and counterclockwise arcs', () => {
  const [x, y] = ellipsePoint(100, 50, 45 * 60000);
  expect(x).toBeCloseTo(y);
  expect(x * x / 10000 + y * y / 2500).toBeCloseTo(1);
  for (const direction of [1, -1]) {
    const result = drawingArc(200, 50, 100, 50, 0, direction * 21600000);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0][5]).toBe(direction > 0 ? 1 : 0);
    expect(result.commands.at(-1).at(-2)).toBeCloseTo(200);
    expect(result.commands.at(-1).at(-1)).toBeCloseTo(50);
  }
});

it('scales fixed-coordinate arcs as a whole, including their polar angles', () => {
  const square = drawingGeometry(preset('cloud'), 43200, 43200, presets);
  const wide = drawingGeometry(preset('cloud'), 86400, 43200, presets);
  let a = [0, 0], b = [0, 0];
  for (let i = 0; i < square.paths[0].commands.length; i++) {
    const cmd = square.paths[0].commands[i], other = wide.paths[0].commands[i];
    if (cmd[0] === 'M') { a = cmd.slice(1); b = other.slice(1); }
    if (cmd[0] === 'A') {
      a = drawingArc(...a, ...cmd.slice(1)).commands.at(-1).slice(-2);
      b = drawingArc(...b, ...other.slice(1)).commands.at(-1).slice(-2);
      expect(b[0]).toBeCloseTo(a[0] * 2, 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  }
});

it('includes the extrema of an arc in a rotated group', () => {
  const project = (x, y) => [(x - y) / Math.SQRT2, (x + y) / Math.SQRT2];
  const arc = drawingArc(100, 0, 100, 50, 0, 10800000, project);
  const points = arc.points.map(p => project(...p));
  const maxY = Math.max(...points.map(p => p[1]));
  expect(maxY).toBeCloseTo(Math.hypot(100, 50) / Math.SQRT2);
});

it('bounds work and rejects unrecognized guide operations and malformed paths', () => {
  expect(drawingGeometry(preset('__proto__'), 100, 100, presets)).toBeNull();
  expect(drawingGeometry(preset('rect', [['adj', 'constructor 1']]), 100, 100, presets)).toBeNull();
  const overBudget = node('custGeom', {}, [node('pathLst', {}, [node('path', {}, Array.from({ length: 10001 }, () => node('close')))])]);
  expect(drawingGeometry(overBudget, 100, 100)).toBeNull();
  const invalidArc = node('custGeom', {}, [node('pathLst', {}, [node('path', {}, [node('arcTo', { wR: '10', hR: '10' })])])]);
  expect(drawingGeometry(invalidArc, 100, 100)).toBeNull();
});
