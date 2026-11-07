import { describe, it, expect } from 'vitest';
import { SvgBatch } from '../src/render/svg-batch.js';
import { sheetToSvg } from '../src/io/sch-svg.js';
import { boardToSvgView } from '../src/io/board-svg.js';
import { createExampleProject } from '../src/app/demo.js';
import { pack } from '../src/render/color.js';
import { mm } from '../src/core/units.js';

describe('SvgBatch', () => {
  it('flips y and converts nanometres to millimetres', () => {
    const b = new SvgBatch({ height: mm(100) });
    b.line(mm(10), mm(10), mm(20), mm(10), mm(0.5), pack('#ff0000'));
    b._flush();
    expect(b.out[0]).toContain('d="M10 90L20 90"');
    expect(b.out[0]).toContain('stroke="rgb(255,0,0)"');
    expect(b.out[0]).toContain('stroke-width="0.5"');
  });

  it('keeps hairlines visible and writes translucent colors', () => {
    const b = new SvgBatch({ height: mm(10) });
    b.circle(0, 0, mm(1), pack('#00ff00', 0.5));
    b.line(0, 0, mm(1), 0, 0, pack('#000000'));
    b._flush();
    expect(b.out[0]).toMatch(/fill-opacity="0\.50\d*"/); // alpha is stored as 8 bits
    expect(b.out[1]).toContain('stroke-width="0.12"');
  });

  it('merges a run of same-style lines into one path, keeping order around fills', () => {
    const b = new SvgBatch({ height: mm(10) });
    b.text('R1', 0, 0, mm(2), pack('#000000'));
    b.rect(0, 0, mm(1), mm(1), 0, 0, pack('#ff0000'));
    b.line(0, 0, mm(1), 0, 0, pack('#000000'));
    b._flush();
    expect(b.out.length).toBe(3);
    expect(b.out[0].match(/M/g).length).toBeGreaterThan(3);
    expect(b.out[1]).toMatch(/^<rect/);
  });
});

describe('boardToSvgView', () => {
  it('renders the example board with copper, silkscreen and holes', () => {
    const p = createExampleProject();
    const svg = boardToSvgView(p.boards[0], p.library, {});
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelectorAll('rect').length).toBeGreaterThan(10); // pads
    expect(svg).toContain('rgb(255,42,42)'); // top copper
    expect(parsed.querySelectorAll('circle').length).toBeGreaterThan(1); // header holes
  });
});

describe('sheetToSvg', () => {
  it('renders the example sheet as well-formed SVG of the sheet size', () => {
    const p = createExampleProject();
    const doc = p.sheets[0];
    const svg = sheetToSvg(doc, p.library, { junctions: p.netlist().sheets.get(doc.id).junctions });
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    const root = parsed.documentElement;
    expect(root.getAttribute('width')).toMatch(/^29[67]/); // A4 landscape, on the 100 mil grid
    expect(root.querySelectorAll('path').length).toBeGreaterThan(20);
    expect(svg.length).toBeLessThan(400_000);
  });
});
