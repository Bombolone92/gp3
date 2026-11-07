import { describe, it, expect } from 'vitest';
import { layer, newDocument, cropDocument, resizeDocument } from '../src/model/document';
import { validateDocument } from '../src/model/serialization';
import { uniforms } from '../src/renderer/renderer';

describe('editable masks', () => {
  it('validates persisted stroke geometry and optional mask state', () => {
    const doc = newDocument(100, 100),
      l = layer('solid', 'Photo', 100, 100);
    doc.layers.push(l);
    expect(validateDocument(doc)).toBe(doc);
    l.maskStrokes = [{ points: [[20, 20]], size: 10, opacity: 0.5, softness: 0.5, restore: false }];
    l.maskDisabled = true;
    l.maskInverted = true;
    expect(validateDocument(doc)).toBe(doc);
    for (const invalid of [NaN, -1, 2]) {
      const copy = structuredClone(doc);
      copy.layers[0].maskStrokes![0].opacity = invalid;
      expect(() => validateDocument(copy)).toThrow('Invalid mask stroke');
    }
    const copy = structuredClone(doc);
    copy.layers[0].maskStrokes![0].clip = [[0, 0]];
    expect(() => validateDocument(copy)).toThrow('Invalid mask stroke');
  });
  it('uses a single combined texture for painted masks and bypasses disabled masks', () => {
    const l = layer('solid', 'Photo', 100, 100);
    l.mask = { x: 0, y: 0, width: 50, height: 100 };
    l.maskStrokes = [{ points: [[75, 50]], size: 20, opacity: 1, softness: 0, restore: true }];
    let u = uniforms(l, 100, 100, 100, 100);
    expect(u[20]).toBe(0);
    expect(u[21]).toBe(1);
    l.maskDisabled = true;
    u = uniforms(l, 100, 100, 100, 100);
    expect(u[20]).toBe(0);
    expect(u[21]).toBe(0);
  });
  it('moves group mask strokes with document crop and scales their brush shape on resize', () => {
    const doc = newDocument(100, 100),
      l = layer('group', 'Group', 100, 100);
    l.maskStrokes = [{ points: [[50, 50]], size: 20, opacity: 1, softness: 0, restore: false }];
    doc.layers = [l];
    resizeDocument(doc, 200, 100);
    expect(l.maskStrokes[0].points).toEqual([[100, 50]]);
    expect(l.maskStrokes[0].size).toBe(40);
    expect(l.maskStrokes[0].aspect).toBe(0.5);
    cropDocument(doc, { x: 20, y: 10, width: 100, height: 80 });
    expect(l.maskStrokes[0].points).toEqual([[80, 40]]);
  });
});
