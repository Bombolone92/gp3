import { describe, expect, it } from 'vitest';
import { layer, newDocument } from '../src/model/document';
import { applyLayerComp, compMatches, newLayerComp, recaptureAspects } from '../src/model/layer-comps';

function fixture() {
  const doc = newDocument(100, 100);
  const a = layer('solid', 'A', 10, 10);
  a.transform = { x: 1, y: 2, width: 10, height: 10, rotation: 0 };
  doc.layers = [a];
  return { doc, a };
}

describe('layer comp matching and options', () => {
  it('tells whether the document shows a comp, counting captured aspects only', () => {
    const { doc, a } = fixture();
    const comp = newLayerComp(doc, 'C', { visibility: true, position: false, appearance: false });
    expect(compMatches(doc, comp)).toBe(true);
    a.transform.x = 50;
    a.opacity = 0.5;
    expect(compMatches(doc, comp)).toBe(true);
    a.visible = false;
    expect(compMatches(doc, comp)).toBe(false);
    applyLayerComp(doc, comp);
    expect(compMatches(doc, comp)).toBe(true);
    // New layers are not part of the comp and do not change the answer.
    doc.layers.push(layer('solid', 'B', 1, 1));
    expect(compMatches(doc, comp)).toBe(true);
  });
  it('captures newly enabled aspects and drops disabled ones', () => {
    const { doc, a } = fixture();
    const comp = newLayerComp(doc, 'C', { visibility: true, position: true, appearance: false });
    a.transform.x = 40;
    a.visible = false;
    a.opacity = 0.25;
    const next = recaptureAspects(doc, comp, { visibility: true, position: false, appearance: true });
    // Visibility keeps its saved value; position is gone; appearance is new.
    expect(next.layers[a.id]).toEqual({ visible: true, opacity: 0.25, fillOpacity: 1, blend: 'normal', style: null });
    expect(next.capture).toEqual({ visibility: true, position: false, appearance: true });
    expect(comp.layers[a.id].x).toBe(1);
  });
});
