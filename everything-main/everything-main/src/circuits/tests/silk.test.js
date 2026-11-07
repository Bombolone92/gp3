import { describe, it, expect } from 'vitest';
import { silkChecks } from '../src/kernel/silk.js';
import { createExampleProject } from '../src/app/demo.js';
import { placeFootprint } from '../src/model/place.js';
import { mm } from '../src/core/units.js';

describe('silkscreen over pads', () => {
  it('finds no overlaps on library footprints placed apart', () => {
    const p = createExampleProject();
    const doc = p.boards[0].snapshot();
    const own = silkChecks(doc, p.library).filter((v) => v.message.includes('outline'));
    expect(own).toEqual([]);
  });

  it('reports a silkscreen line crossing a pad, once per pad', () => {
    const p = createExampleProject();
    const doc = p.boards[0].snapshot();
    const r1 = doc.objects.find((o) => o.t === 'comp' && o.designator === 'R1');
    const pad = placeFootprint(p.library[r1.comp], r1).pads[0];
    doc.objects.push({ id: 'silk1', t: 'track', layer: 'topOverlay', x1: pad.x - mm(2), y1: pad.y, x2: pad.x + mm(2), y2: pad.y, w: mm(0.15) });
    doc.objects.push({ id: 'silk2', t: 'track', layer: 'bottomOverlay', x1: pad.x - mm(2), y1: pad.y, x2: pad.x + mm(2), y2: pad.y, w: mm(0.15) });
    const found = silkChecks(doc, p.library).filter((v) => v.ids.includes('silk1') || v.ids.includes('silk2'));
    expect(found.length).toBe(1); // the bottom line does not touch a top-side pad
    expect(found[0]).toMatchObject({ rule: 'silk', severity: 'warning', ids: ['silk1', r1.id] });
    expect(found[0].message).toContain(`R1-${pad.num}`);
  });
});
