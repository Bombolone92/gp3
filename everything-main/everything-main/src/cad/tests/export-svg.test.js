import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { RecordingSink } from '../src/core/display.js';
import { exportSvg } from '../src/io/export/svg.js';

const black = { rgb: [255, 255, 255], aci7: true, lw: 25, pattern: [], id: 1, alpha: 1 };
const red = { rgb: [255, 0, 0], aci7: false, lw: 50, pattern: [], id: 2, alpha: 1 };
const dashed = { rgb: [0, 0, 255], aci7: false, lw: 25, pattern: [12, -6], id: 3, alpha: 1 };
const dotted = { rgb: [0, 128, 0], aci7: false, lw: 25, pattern: [0, -3], id: 4, alpha: 1 };
const hatch = { rgb: [0, 255, 255], aci7: false, lw: 25, pattern: [], id: 5, alpha: 0.5 };

function sample() {
  const s = new RecordingSink();
  s.line([0, 0, 100, 0], false, black);
  s.line([0, 10, 100, 10, 100, 20], false, black);
  s.line([0, 30, 100, 30], false, red);
  s.line([0, 40, 100, 40], false, dashed);
  s.line([0, 50, 100, 50], false, dotted);
  s.fill(
    [
      [0, 60, 50, 60, 50, 90, 0, 90],
      [10, 70, 20, 70, 20, 80, 10, 80],
    ],
    hatch,
  );
  return s.items;
}

function parse(svg) {
  const doc = new new JSDOM('').window.DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}

describe('exportSvg', () => {
  it('writes a page-sized SVG in millimetres', () => {
    const svg = exportSvg(sample(), { paper: 'A3', orientation: 'landscape' });
    expect(svg.startsWith('<?xml')).toBe(true);
    const doc = parse(svg);
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('420mm');
    expect(root.getAttribute('height')).toBe('297mm');
    expect(root.getAttribute('viewBox')).toBe('0 0 420 297');
    expect(doc.getElementsByTagName('clipPath').length).toBe(1);
  });

  it('groups consecutive items with the same style into one path', () => {
    const doc = parse(exportSvg(sample(), { paper: 'A4', orientation: 'landscape' }));
    const strokes = [...doc.getElementsByTagName('path')].filter((p) => p.getAttribute('stroke'));
    expect(strokes.length).toBe(4);
    const first = strokes[0].getAttribute('d');
    expect(first.match(/M/g).length).toBe(2);
    expect(strokes[0].getAttribute('stroke')).toBe('#000000');
    expect(strokes[1].getAttribute('stroke')).toBe('#ff0000');
    expect(strokes[1].getAttribute('stroke-width')).toBe('0.5');
  });

  it('writes dash arrays, round-capped dots and even-odd fills', () => {
    const doc = parse(exportSvg(sample(), { paper: 'A4', orientation: 'landscape', lineCap: 'butt', scale: { paper: 1, drawing: 1 } }));
    const paths = [...doc.getElementsByTagName('path')];
    const dash = paths.find((p) => p.getAttribute('stroke') === '#0000ff');
    expect(dash.getAttribute('stroke-dasharray')).toBe('12 6');
    const dot = paths.find((p) => p.getAttribute('stroke') === '#008000');
    expect(dot.getAttribute('stroke-dasharray')).toBe('0 3');
    expect(dot.getAttribute('stroke-linecap')).toBe('round');
    const g = [...doc.getElementsByTagName('g')].find((e) => e.getAttribute('fill-rule'));
    expect(g.getAttribute('fill-rule')).toBe('evenodd');
    expect(g.getAttribute('fill-opacity')).toBe('0.5');
    const d = g.getElementsByTagName('path')[0].getAttribute('d');
    expect(d.match(/M/g).length).toBe(2);
    expect(d.match(/z/g).length).toBe(2);
  });

  it('prints everything black in monochrome', () => {
    const svg = exportSvg(sample(), { paper: 'A4', monochrome: true });
    const colors = new Set(svg.match(/#[0-9a-f]{6}/g));
    expect([...colors]).toEqual(['#000000']);
  });

  it('draws a background and uniform widths with lineweights off', () => {
    const svg = exportSvg(sample(), { paper: 'A4', background: '#ffffff', lineweights: false });
    expect(svg).toContain('fill="#ffffff"');
    const widths = new Set(svg.match(/stroke-width="[^"]+"/g));
    expect([...widths]).toEqual(['stroke-width="0.1"']);
  });

  it('writes a drawing-units SVG covering the bounds with a margin', () => {
    const svg = exportSvg(sample(), { margin: 0.1 });
    const root = parse(svg).documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 120 110');
    expect(root.getAttribute('width')).toBe('1000');
    // Lower-left of the bounds (0, 0) sits at (10, 100) with y flipped.
    expect(svg).toContain('M10 100l100 0');
    expect(svg).not.toContain('vector-effect');
    const nss = exportSvg(sample(), { nonScalingStroke: true });
    expect(nss).toContain('vector-effect="non-scaling-stroke"');
  });
});
