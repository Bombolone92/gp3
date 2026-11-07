import { describe, it, expect } from 'vitest';
import '../../src/nodes/common';
import '../../src/nodes/shader/defs';
import { layoutNode, layoutTree, linkCurve, curveCrossesPolyline, distToCurve, sockKey, HEADER, ROW, PANEL_ROW, nodeWidth } from '../../src/nodes/editor/layout';
import { addNode, connect, ctxOf, joinInFrame } from '../../src/nodes/tree';
import { emptyDocument } from '../../src/data/defaults';
import type { NodeTreeData } from '../../src/data/types';

const tree = (): NodeTreeData => ({ type: 'SHADER', nodes: [], links: [] });

describe('node layout', () => {
  it('places outputs on the right, inputs on the left, panels collapsed', () => {
    const d = emptyDocument();
    const t = tree();
    const n = addNode(t, 'ShaderNodeBsdfPrincipled', [10, 300]);
    const l = layoutNode(d, t, n);
    expect(l.x).toBe(10);
    expect(l.y).toBe(-300);
    expect(l.w).toBe(240);
    const out = l.sockets.get(sockKey(true, 'BSDF'))!;
    expect(out.x).toBe(250);
    expect(out.y).toBeGreaterThan(-300 + HEADER);
    const base = l.sockets.get(sockKey(false, 'Base Color'))!;
    expect(base.x).toBe(10);
    expect(base.y).toBeGreaterThan(out.y);
    // sockets inside closed panels sit on the panel header
    const coat = l.sockets.get(sockKey(false, 'Coat Weight'))!;
    expect(coat.collapsed).toBe(true);
    expect(l.rows.filter((r) => r.kind === 'panel')).toHaveLength(8);
    n.open_panels = ['Coat'];
    const l2 = layoutNode(d, t, n);
    expect(l2.sockets.get(sockKey(false, 'Coat Weight'))!.collapsed).toBeFalsy();
    expect(l2.h).toBeGreaterThan(l.h + 4 * ROW);
  });
  it('collapses hidden nodes to the header and expands unlinked vectors', () => {
    const d = emptyDocument();
    const t = tree();
    const m = addNode(t, 'ShaderNodeMapping', [0, 0]);
    const l = layoutNode(d, t, m);
    const loc = l.rows.find((r) => r.socket?.identifier === 'Location')!;
    expect(loc.vector).toBe(true);
    expect(loc.h).toBe(ROW * 4);
    const tc = addNode(t, 'ShaderNodeTexCoord', [-300, 0]);
    connect(ctxOf(d, t), tc.id, 'UV', m.id, 'Vector');
    m.hide = true;
    const h = layoutNode(d, t, m);
    expect(h.h).toBe(HEADER);
    expect(h.sockets.get(sockKey(false, 'Vector'))!.y).toBeCloseTo(h.y + HEADER / 2);
    expect(PANEL_ROW).toBeLessThan(ROW);
  });
  it('lays out reroutes, frames and widths', () => {
    const d = emptyDocument();
    const t = tree();
    const a = addNode(t, 'ShaderNodeValue', [0, 0]);
    const b = addNode(t, 'ShaderNodeMath', [300, -100]);
    const r = addNode(t, 'NodeReroute', [200, -50]);
    const f = joinInFrame(t, [a.id, b.id])!;
    const all = layoutTree(d, t);
    const fl = all.get(f.id)!;
    const al = all.get(a.id)!,
      bl = all.get(b.id)!;
    expect(fl.x).toBeLessThan(al.x);
    expect(fl.x + fl.w).toBeGreaterThan(bl.x + bl.w);
    expect(fl.y + fl.h).toBeGreaterThan(bl.y + bl.h);
    expect(all.get(r.id)!.kind).toBe('REROUTE');
    b.width = 10;
    expect(nodeWidth(b)).toBe(80);
  });
  it('hit-tests link curves', () => {
    const c = linkCurve(0, 0, 200, 100);
    expect(c[2]).toBeGreaterThan(0);
    expect(
      curveCrossesPolyline(c, [
        [100, -50],
        [100, 150],
      ]),
    ).toBe(true);
    expect(
      curveCrossesPolyline(c, [
        [300, -50],
        [300, 150],
      ]),
    ).toBe(false);
    expect(distToCurve(c, 0, 0)).toBeCloseTo(0);
    expect(distToCurve(c, 100, 500)).toBeGreaterThan(1000);
  });
});
