import { describe, it, expect } from 'vitest';
import { layoutContent, mediaSize, MEDIA, MARK_LENGTH } from '../src/features/io/print-layout.js';
import { printJob } from '../src/features/io/print-dialog.js';
import { buildLayoutRoot, layoutPageRules, printView } from '../src/features/io/print.js';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';

const A = { x: 0, y: 0, w: 400, h: 300 };

describe('print layout', () => {
  it('prints at the artboard size by default', () => {
    const [p] = layoutContent(A, {});
    expect(p.w).toBe(400);
    expect(p.h).toBe(300);
    expect(p.tiles[0]).toMatchObject({ x: 0, y: 0, s: 1 });
  });

  it('adds room for marks and bleed around the trim', () => {
    const [p] = layoutContent(A, { bleed: { top: 9, right: 9, bottom: 9, left: 9 }, marks: { trim: true } });
    expect(p.w).toBeGreaterThan(400 + 18 + 2 * MARK_LENGTH);
    expect(p.marks.filter((m) => m.kind === 'line')).toHaveLength(8);
    // Trim marks start outside the bleed.
    const t = p.tiles[0];
    const trimLeft = t.x + 9;
    for (const m of p.marks.filter((q) => q.kind === 'line' && q.y1 === q.y2)) expect(Math.min(m.x1, m.x2) >= trimLeft + 400 || Math.max(m.x1, m.x2) <= trimLeft - 9).toBe(true);
  });

  it('fits, orients and places artwork on media', () => {
    expect(mediaSize({ media: 'letter', orientation: 'auto' }, 800, 300)).toEqual({ w: 792, h: 612 });
    const [p] = layoutContent({ x: 0, y: 0, w: 1600, h: 1200 }, { media: 'letter', scaling: 'fit' });
    expect(p.w).toBe(792);
    expect(p.tiles[0].s).toBeCloseTo(Math.min((792 - 36) / 1600, (612 - 36) / 1200), 5);
    const [q] = layoutContent(A, { media: 'a4', orientation: 'portrait', anchor: 'tl', offsetX: 10, offsetY: 20 });
    expect(q.w).toBeCloseTo(MEDIA.a4.w);
    expect(q.tiles[0]).toMatchObject({ x: 10, y: 20 });
  });

  it('tiles large artwork over full pages with overlap', () => {
    const pages = layoutContent({ x: 0, y: 0, w: 1500, h: 1000 }, { media: 'letter', orientation: 'landscape', scaling: 'tile', scale: 100, overlap: 18 });
    expect(pages.length).toBe(Math.ceil((1500 - 18) / (792 - 18)) * Math.ceil((1000 - 18) / (612 - 18)));
    expect(pages[1].tiles[0].x).toBeCloseTo(-(792 - 18));
  });
});

describe('print job', () => {
  it('skips blank and non-printing layers, builds sized pages', () => {
    const doc = VDocument.create({ width: 200, height: 100, artboards: 2 });
    const layer = doc.layers()[0].id;
    const r = createPath(rectangle(10, 10, 20, 20), true);
    doc.transact('add', () => doc.insert(r, layer));
    expect(printJob(doc, { which: 'all', skipBlank: true, layers: 'printable' })).toHaveLength(1);
    doc.transact('np', () => doc.update(layer, { print: false }));
    expect(printView(doc, 'printable').get(layer).hidden).toBe(true);
    expect(printJob(doc, { which: 'all', skipBlank: true, layers: 'printable' })).toHaveLength(0);
    expect(printJob(doc, { which: 'all', skipBlank: true, layers: 'visible' })).toHaveLength(1);
    const pages = printJob(doc, { which: 'all', layers: 'visible', marks: { trim: true } });
    const root = buildLayoutRoot(doc, pages, { layers: 'visible' });
    expect(root.children).toHaveLength(2);
    expect(root.innerHTML).toContain('<line');
    expect(layoutPageRules(pages)).toContain('@page vs-page-1');
  });
});
