import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { deflate } from 'pako';
import { cropDocument, layer, newDocument } from '../src/model/document';
import { newPixelLayer } from '../src/model/pixel-layer';
import { emptyGrid } from '../src/model/tiles';
import { applyLayerComp, missingLayers, newLayerComp, updateLayerComp } from '../src/model/layer-comps';
import { partitionSlices, pieceNames, sliceAt, sliceRect, sliceTableHtml, type Slice } from '../src/model/slices';
import { validateDocument } from '../src/model/serialization';
import { createArtboard } from '../src/model/artboard';
import { buildPdf, pdfString, splitRgba } from '../src/imaging/codecs/pdf';

const all = { visibility: true, position: true, appearance: true };

describe('layer comps', () => {
  function fixture() {
    const doc = newDocument(300, 200);
    const a = layer('solid', 'A', 10, 10);
    a.transform = { x: 5, y: 6, width: 10, height: 10, rotation: 0 };
    const p = newPixelLayer('P', doc, { ...emptyGrid(4), x: 40, y: 50 });
    const ab = createArtboard(doc, { x: 0, y: 0, width: 100, height: 100 });
    doc.layers = [a, p, ab];
    return { doc, a, p, ab };
  }
  it('captures and restores visibility, position and appearance', () => {
    const { doc, a, p, ab } = fixture();
    const comp = newLayerComp(doc, 'Layout 1', all);
    a.visible = false;
    a.opacity = 0.5;
    a.blend = 'multiply';
    a.style = { dropShadow: { enabled: true } };
    a.transform.x = 50;
    p.transform.x += 7;
    p.pixels = { ...p.pixels!, x: 47 };
    ab.artboard.rect.x = 30;
    const r = applyLayerComp(doc, comp);
    expect(a).toMatchObject({ visible: true, opacity: 1, blend: 'normal' });
    expect(a.style).toBeUndefined();
    expect(a.transform.x).toBe(5);
    // Pixel layers move by their tile origin; the transform carries the shift.
    expect(p.transform.x).toBe(0);
    expect(ab.artboard.rect.x).toBe(0);
    expect(r).toMatchObject({ missing: 0, added: 0 });
    expect(r.moved.sort()).toEqual([a.id, p.id, ab.id].sort());
    doc.layerComps = [comp];
    doc.lastComp = comp.id;
    expect(validateDocument(doc)).toBe(doc);
  });
  it('restores only the captured aspects and reports missing layers', () => {
    const { doc, a } = fixture();
    const comp = newLayerComp(doc, 'Visibility', { visibility: true, position: false, appearance: false });
    expect(Object.values(comp.layers)[0]).toEqual({ visible: true });
    a.visible = false;
    a.opacity = 0.3;
    doc.layers = doc.layers.filter((l) => l.id !== a.id);
    const extra = layer('solid', 'New', 1, 1);
    doc.layers.push(extra);
    expect(missingLayers(doc, comp)).toEqual([a.id]);
    const r = applyLayerComp(doc, comp);
    expect(r).toMatchObject({ missing: 1, added: 1 });
    const updated = updateLayerComp(doc, comp);
    expect(missingLayers(doc, updated)).toEqual([]);
    expect(updated.name).toBe('Visibility');
  });
  it('rejects malformed comps and follows crops', () => {
    const { doc, a } = fixture();
    const comp = newLayerComp(doc, 'C', all);
    doc.layerComps = [comp];
    cropDocument(doc, { x: 5, y: 0, width: 100, height: 100 });
    expect(comp.layers[a.id].x).toBe(0);
    expect(() => validateDocument({ ...doc, layerComps: [{ ...comp, capture: {} }] })).toThrow(/comps/);
    expect(() => validateDocument({ ...doc, lastComp: 'nope' })).toThrow(/comps/);
  });
});

describe('slices', () => {
  const doc = (slices: Slice[]) => ({ ...newDocument(300, 200), slices });
  it('fills the canvas with automatic slices around a user slice', () => {
    const d = doc([{ id: 's', rect: { x: 100, y: 50, width: 100, height: 100 } }]);
    const pieces = partitionSlices(d);
    expect(pieces.map((p) => [p.kind, p.rect])).toEqual([
      ['auto', { x: 0, y: 0, width: 300, height: 50 }],
      ['auto', { x: 0, y: 50, width: 100, height: 100 }],
      ['user', { x: 100, y: 50, width: 100, height: 100 }],
      ['auto', { x: 200, y: 50, width: 100, height: 100 }],
      ['auto', { x: 0, y: 150, width: 300, height: 50 }],
    ]);
    expect(pieces.map((p) => p.number)).toEqual([1, 2, 3, 4, 5]);
    const area = pieces.reduce((s, p) => s + p.rect.width * p.rect.height, 0);
    expect(area).toBe(300 * 200);
    expect(partitionSlices(doc([]))).toHaveLength(1);
  });
  it('stacks overlapping slices, clips to the canvas and names pieces', () => {
    const lower: Slice = { id: 'a', name: 'hero', rect: { x: -20, y: 0, width: 120, height: 100 } };
    const upper: Slice = { id: 'b', rect: { x: 50, y: 50, width: 100, height: 100 } };
    const d = doc([lower, upper]);
    const pieces = partitionSlices(d);
    const area = pieces.reduce((s, p) => s + p.rect.width * p.rect.height, 0);
    expect(area).toBe(300 * 200);
    // No two pieces overlap.
    for (const p of pieces)
      for (const q of pieces)
        if (p !== q)
          expect(p.rect.x < q.rect.x + q.rect.width && q.rect.x < p.rect.x + p.rect.width && p.rect.y < q.rect.y + q.rect.height && q.rect.y < p.rect.y + p.rect.height).toBe(false);
    expect(pieces.filter((p) => p.slice === upper)).toHaveLength(1);
    expect(pieces.filter((p) => p.slice === lower).length).toBe(2);
    const names = pieceNames(pieces, 'page');
    expect(names.filter((n) => n.startsWith('hero_'))).toEqual(['hero_01', 'hero_02']);
    expect(names.filter((n) => n.startsWith('page_'))).toHaveLength(pieces.length - 2);
    expect(sliceAt(d, 60, 60)).toBe(upper);
    expect(sliceAt(d, 10, 10)).toBe(lower);
    expect(sliceRect(d, lower)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
  it('follows the bounds of a layer-based slice', () => {
    const d = doc([]);
    const l = layer('solid', 'L', 10, 10);
    l.transform = { x: 10.2, y: 20, width: 30.5, height: 40, rotation: 0 };
    d.layers = [l];
    const s: Slice = { id: 'l', layerId: l.id, rect: { x: 0, y: 0, width: 0, height: 0 } };
    expect(sliceRect(d, s)).toEqual({ x: 10, y: 20, width: 31, height: 40 });
    d.slices = [s];
    expect(partitionSlices(d).find((p) => p.kind === 'layer')!.rect).toEqual({ x: 10, y: 20, width: 31, height: 40 });
    expect(validateDocument(d)).toBe(d);
    expect(() => validateDocument({ ...d, slices: [{ ...s, format: 'bmp' }] })).toThrow(/slices/);
  });
  it('writes an HTML table with spans along the cut lines', () => {
    const pieces = partitionSlices(doc([{ id: 's', rect: { x: 100, y: 50, width: 100, height: 100 } }]));
    const html = sliceTableHtml(pieces, pieces.map((_, i) => `images/p${i}.png`), 'Page <1>', 300, 200);
    expect(html).toContain('<td colspan="3"><img src="images/p0.png" width="300" height="50"');
    expect(html).toContain('<title>Page &lt;1&gt;</title>');
    expect(html.match(/<img /g)).toHaveLength(5);
  });
});

describe('PDF writer', () => {
  const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
  it('writes pages with a valid cross-reference table', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
    const split = splitRgba(rgba, 2, 1);
    expect([...split.alpha!]).toEqual([255, 128]);
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = buildPdf(
      [
        { width: 144, height: 72, image: { width: 2, height: 1, ...split } },
        { width: 100.5, height: 50, image: { width: 4, height: 2, jpeg } },
      ],
      { title: 'Café', deflate: (d) => deflate(d), date: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
    );
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s).toContain('/MediaBox [0 0 144 72]');
    expect(s).toContain('/MediaBox [0 0 100.5 50]');
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/SMask');
    expect(s).toContain('/CreationDate (D:20260102030405Z)');
    expect(s).toContain(`/Title ${pdfString('Café')}`);
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const entries = s.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(s.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    // The RGB stream inflates back to the source pixels.
    const at = s.indexOf('/ColorSpace /DeviceRGB /Filter /FlateDecode');
    const len = Number(/\/Length (\d+)/.exec(s.slice(at))![1]);
    const start = s.indexOf('stream\n', at) + 7;
    expect([...inflateSync(pdf.subarray(start, start + len))]).toEqual([255, 0, 0, 0, 255, 0]);
    const jat = s.indexOf('/DCTDecode');
    const jstart = s.indexOf('stream\n', jat) + 7;
    expect([...pdf.subarray(jstart, jstart + jpeg.length)]).toEqual([...jpeg]);
  });
  it('escapes literal strings and rejects empty documents', () => {
    expect(pdfString('a(b)\\')).toBe('(a\\(b\\)\\\\)');
    expect(pdfString('é')).toBe('<FEFF00E9>');
    expect(() => buildPdf([], { deflate: (d) => d })).toThrow();
  });
});
