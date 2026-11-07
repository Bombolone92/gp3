import { describe, expect, it } from 'vitest';
import { cropDocument, layer, mapDocumentGeometry, newDocument, resizeDocument } from '../src/model/document';
import { newPixelLayer, setLivePixels } from '../src/model/pixel-layer';
import { emptyGrid } from '../src/model/tiles';
import { newLayerComp, remapCompPositions } from '../src/model/layer-comps';
import { setDocumentResolution } from '../src/model/text-layer';
import { defaultCharStyle, defaultParagraphStyle, fromPlainText } from '../src/imaging/text/model';

// 90° clockwise on a 300 × 200 canvas.
const turn = (x: number, y: number): [number, number] => [200 - y, x];

describe('document geometry through canvas edits', () => {
  it('turns guides with the canvas and drops those that no longer run along an axis', () => {
    const doc = newDocument(300, 200);
    doc.guides = [{ orientation: 'vertical', position: 50 }, { orientation: 'horizontal', position: 20 }];
    mapDocumentGeometry(doc, turn);
    expect(doc.guides).toEqual([{ orientation: 'horizontal', position: 50 }, { orientation: 'vertical', position: 180 }]);
    const a = Math.PI / 6;
    mapDocumentGeometry(doc, (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    expect(doc.guides).toEqual([]);
  });

  it('turns frame offsets and pixel variable bounds, and moves paths', () => {
    const doc = newDocument(300, 200);
    const l = layer('solid', 'A', 10, 10);
    doc.layers = [l];
    doc.animation = { frames: [{ id: 'f', delay: 100, layers: { [l.id]: { visible: true, dx: 5, dy: 0, opacity: 1, blend: 'normal' } } }], current: 0, loop: 0 };
    doc.variables = { layers: { [l.id]: { pixel: { name: 'img', method: 'fit', alignX: 0, alignY: 0, clip: false, bounds: { x: 20, y: 30, width: 40, height: 20 } } } }, sets: [] };
    doc.workPath = { paths: [{ open: true, knots: [{ linked: false, points: [1, 2, 3, 4, 5, 6] }] }] } as unknown as NonNullable<typeof doc.workPath>;
    mapDocumentGeometry(doc, turn);
    const s = doc.animation.frames[0].layers[l.id];
    expect([s.dx, s.dy].map((v) => Math.round(v))).toEqual([0, 5]);
    expect(doc.variables.layers[l.id].pixel!.bounds).toEqual({ x: 150, y: 20, width: 20, height: 40 });
    expect(doc.workPath!.paths[0].knots[0].points).toEqual([198, 1, 196, 3, 194, 5]);
  });

  it('crops, resizes and keeps layer vector masks with their layers', () => {
    const doc = newDocument(300, 200);
    const l = layer('solid', 'A', 10, 10);
    l.vectorMask = { mask: { paths: [{ open: true, knots: [{ linked: false, points: [10, 20, 10, 20, 10, 20] }] }] } as never };
    doc.layers = [l];
    doc.guides = [{ orientation: 'vertical', position: 50 }, { orientation: 'horizontal', position: 5 }];
    cropDocument(doc, { x: 10, y: 10, width: 100, height: 100 });
    expect(doc.guides).toEqual([{ orientation: 'vertical', position: 40 }]);
    expect(l.vectorMask.mask.paths[0].knots[0].points).toEqual([0, 10, 0, 10, 0, 10]);
    resizeDocument(doc, 200, 50);
    expect(doc.guides).toEqual([{ orientation: 'vertical', position: 80 }]);
    expect(l.vectorMask.mask.paths[0].knots[0].points).toEqual([0, 5, 0, 5, 0, 5]);
  });

  it('keeps effect sizes in pixels when Scale Styles is off', () => {
    const doc = newDocument(100, 100);
    const l = layer('solid', 'A', 10, 10);
    l.style = { dropShadow: [{ distance: 5 }] };
    doc.layers = [l];
    resizeDocument(doc, 200, 200, false);
    expect(l.style.scale).toBeUndefined();
    expect(doc.width).toBe(200);
  });
  it('scales layer effects with the image, in frames and comps too', () => {
    const doc = newDocument(100, 100);
    const l = layer('solid', 'A', 10, 10);
    l.style = { dropShadow: [{ distance: 5 }] };
    doc.layers = [l];
    doc.animation = { frames: [{ id: 'f', delay: 100, layers: { [l.id]: { visible: true, dx: 0, dy: 0, opacity: 1, blend: 'normal', style: { scale: 0.5 } } } }], current: 0, loop: 0 };
    doc.layerComps = [newLayerComp(doc, 'C', { visibility: false, position: false, appearance: true })];
    resizeDocument(doc, 200, 200);
    expect(l.style.scale).toBe(2);
    expect(doc.animation.frames[0].layers[l.id].style).toEqual({ scale: 1 });
    expect(doc.layerComps[0].layers[l.id].style).toMatchObject({ scale: 2 });
    resizeDocument(doc, 200, 200);
    expect(l.style.scale).toBe(2);
  });

  it('keeps comp positions relative to layers whose content was rebuilt', () => {
    const before = newDocument(300, 200);
    // A pixel layer whose tile origin moved to (30, 0) since the comp.
    const p = newPixelLayer('P', before, { ...emptyGrid(4), x: 30, y: 0 });
    const comp = newLayerComp({ layers: [{ ...p, pixels: { ...p.pixels!, x: 20 } }] }, 'C', { visibility: false, position: true, appearance: false });
    before.layers = [p];
    before.layerComps = [comp];
    // After a 2× resize the rebuilt grid has its origin at 0.
    const after = structuredClone(before);
    after.layers[0].pixels = { ...emptyGrid(4), x: 0, y: 0 };
    remapCompPositions(before, after, (x, y) => [x * 2, y * 2]);
    expect(after.layerComps![0].layers[p.id]).toMatchObject({ x: -20, y: 0 });
    expect(before.layerComps[0].layers[p.id]).toMatchObject({ x: 20, y: 0 });
  });

  it('keeps the filter list when a canvas edit replaces Live Filter pixels', () => {
    const doc = newDocument(100, 100);
    const l = newPixelLayer('L', doc);
    l.liveSource = emptyGrid(4);
    l.liveFilters = [{ id: 'gaussian-blur', params: {}, enabled: true, opacity: 1, blend: 'normal', seed: 1 }];
    l.liveMask = emptyGrid(1);
    l.liveMaskDisabled = true;
    const source = { ...emptyGrid(4), x: 5 },
      mask = { ...emptyGrid(1), x: 5 };
    setLivePixels(l, emptyGrid(4), doc, source, mask);
    expect(l).toMatchObject({ liveSource: source, liveMask: mask, liveMaskDisabled: true });
    expect(l.liveFilters).toHaveLength(1);
  });

  it('keeps type the same size in pixels when the resolution changes', () => {
    const doc = newDocument(100, 100);
    const t = layer('text', 'T', 10, 10);
    t.textData = { content: fromPlainText('Hi', { ...defaultCharStyle(), size: 24, leading: 30 }), mode: 'point', origin: { x: 5, y: 20 }, orientation: 'horizontal', antiAlias: 'smooth' };
    t.textData.content.paragraphs[0].style = { ...defaultParagraphStyle(), indentLeft: 6 };
    doc.layers = [t];
    doc.textStyles = { character: [{ id: 'c', name: 'Big', style: { size: 48 } }], paragraph: [] };
    setDocumentResolution(doc, { horizontalResolution: 144, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 144, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' });
    const style = t.textData.content.paragraphs[0].runs[0].style;
    expect([style.size, style.leading]).toEqual([12, 15]);
    expect(t.textData.content.paragraphs[0].style.indentLeft).toBe(3);
    expect(t.textData.origin).toEqual({ x: 5, y: 20 });
    expect(doc.textStyles.character[0].style).toEqual({ size: 24 });
    expect(doc.resolution?.horizontalResolution).toBe(144);
  });
});
