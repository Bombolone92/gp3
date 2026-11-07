import { describe, expect, it } from 'vitest';
import { layer, newDocument } from '../src/model/document';
import {
  applyAffine, bakeTextScale, documentPpi, fitTextFrame, invertAffine, legacyTextData, placeTextRect, scaleTextData, syncLegacyFields,
  textLayerName, textMatrix, validateTextData,
} from '../src/model/text-layer';
import { validateDocument } from '../src/model/serialization';
import { applyCharStyle, defaultCharStyle, fromPlainText, textLayer, type TextLayerData } from '../src/imaging/text/model';
import { layoutText, type Measure } from '../src/imaging/text/layout';
import { contoursToVectorMask } from '../src/features/type/shape';
import { convertParagraphMode } from '../src/features/type/convert';
import { validateVectorMask, vectorComponents } from '../src/model/vector';

const mono: Measure = (text, font) => {
  const s = Number(/([\d.]+)px/.exec(font)![1]);
  return { width: [...text].length * s * 0.5, ascent: s * 0.8, descent: s * 0.2 };
};

function textLayerWith(data: TextLayerData, frame = { x: 10, y: 20, width: 100, height: 40 }, transform = { ...frame, rotation: 0 }) {
  const l = layer('text', 'Text', 1, 1);
  l.textData = data;
  l.textFrame = frame;
  l.transform = transform;
  return l;
}
const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe('text layer placement', () => {
  it('is the identity when the transform equals the frame', () => {
    const l = textLayerWith(textLayer('Hi'));
    close(textMatrix(l), [1, 0, 0, 1, 0, 0]);
  });
  it('maps frame corners onto the rotated, scaled transform rectangle', () => {
    const l = textLayerWith(textLayer('Hi'), { x: 0, y: 0, width: 100, height: 50 }, { x: 200, y: 100, width: 200, height: 50, rotation: 90 });
    const m = textMatrix(l);
    // Frame center -> transform center.
    close(applyAffine(m, 50, 25), [300, 125]);
    // +x in local space runs down the page after a 90 degree turn, scaled by 2.
    close(applyAffine(m, 100, 25), [300, 225]);
    close(applyAffine(invertAffine(m), ...applyAffine(m, 13, -7)), [13, -7]);
  });
  it('refits the frame to new bounds without moving the text', () => {
    const l = textLayerWith(textLayer('Hi'), { x: 0, y: 0, width: 100, height: 50 }, { x: 40, y: 30, width: 150, height: 75, rotation: 30 });
    const before = textMatrix(l);
    fitTextFrame(l, { x: -20, y: 5, width: 260, height: 33 });
    close(textMatrix(l), before);
    expect(l.textFrame).toEqual({ x: -20, y: 5, width: 260, height: 33 });
    expect(l.sourceWidth).toBe(260);
    // A transform rectangle placed for the new frame encloses it at the same scale.
    expect(l.transform.width).toBeCloseTo(390);
    expect(l.transform.rotation).toBe(30);
  });
  it('places arbitrary local rectangles with the layer rotation', () => {
    const l = textLayerWith(textLayer('Hi'), { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 20, height: 20, rotation: 45 });
    const t = placeTextRect(l, { x: 5, y: 5, width: 2, height: 4 });
    expect(t.width).toBeCloseTo(4);
    expect(t.height).toBeCloseTo(8);
    expect(t.rotation).toBe(45);
  });
  it('bakes uniform scaling into type sizes and keeps non-uniform scaling', () => {
    const data = textLayer('Hello', { size: 20, leading: 30, baselineShift: 2 }, { origin: { x: 50, y: 40 } });
    data.content.paragraphs[0].style.indentLeft = 4;
    const l = textLayerWith(data, { x: 50, y: 20, width: 100, height: 40 }, { x: 0, y: 0, width: 200, height: 80, rotation: 10 });
    const before = applyAffine(textMatrix(l), data.origin.x, data.origin.y);
    expect(bakeTextScale(l)).toBe(true);
    const st = l.textData!.content.paragraphs[0].runs[0].style;
    expect(st.size).toBe(40);
    expect(st.leading).toBe(60);
    expect(st.baselineShift).toBe(4);
    expect(l.textData!.content.paragraphs[0].style.indentLeft).toBe(8);
    // Unit scale afterwards and the baseline origin stays where it was drawn.
    expect(l.textFrame!.width).toBe(200);
    close(applyAffine(textMatrix(l), l.textData!.origin.x, l.textData!.origin.y), before, 1e-6);
    expect(bakeTextScale(l)).toBe(false);
    const squashed = textLayerWith(textLayer('Hi'), { x: 0, y: 0, width: 100, height: 40 }, { x: 0, y: 0, width: 200, height: 40, rotation: 0 });
    expect(bakeTextScale(squashed)).toBe(false);
  });
  it('scales paragraph frames with the text', () => {
    const d = scaleTextData(textLayer('a', {}, { mode: 'paragraph', box: { width: 100, height: 50 }, origin: { x: 10, y: 10 } }), 2, 0, 0);
    expect(d.box).toEqual({ width: 200, height: 100 });
    expect(d.origin).toEqual({ x: 20, y: 20 });
  });
  it('reads document resolution in pixels per inch', () => {
    const doc = newDocument(10, 10);
    expect(documentPpi(doc)).toBe(72);
    doc.resolution = { horizontalResolution: 118.11, horizontalResolutionUnit: 'PPCM', widthUnit: 'Centimeters', verticalResolution: 118.11, verticalResolutionUnit: 'PPCM', heightUnit: 'Centimeters' };
    expect(documentPpi(doc)).toBeCloseTo(300, 0);
  });
});

describe('legacy text layers', () => {
  it('convert to engine data in their own source space', () => {
    const l = layer('text', 'Text', 400, 200);
    l.text = 'Line one\nLine two';
    l.fontSize = 48;
    l.color = '#ff8000';
    const { data, frame } = legacyTextData(l, 144);
    expect(data.content.paragraphs).toHaveLength(2);
    const st = data.content.paragraphs[0].runs[0].style;
    expect(st.size).toBe(24); // 48 px at 144 ppi
    expect(st.color).toEqual([255, 128, 0]);
    expect(frame).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(data.origin.y).toBeGreaterThan(0);
  });
  it('keep plain fields in step with the editable data', () => {
    const l = textLayerWith({ ...textLayer('ab', { color: [1, 2, 3], size: 33 }) });
    syncLegacyFields(l);
    expect(l.text).toBe('ab');
    expect(l.color).toBe('#010203');
    expect(l.fontSize).toBe(33);
    expect(textLayerName(fromPlainText('  many   words\nhere '))).toBe('many words here');
    expect(textLayerName(fromPlainText(''))).toBe('Text');
  });
});

describe('text data validation', () => {
  it('accepts engine data and projects containing it', () => {
    const data = applyCharStyle(fromPlainText('Hi\nthere'), 0, 2, { underline: true, color: [10, 20, 30] });
    const d: TextLayerData = { content: data, mode: 'paragraph', box: { width: 10, height: 20 }, origin: { x: 1, y: 2 }, orientation: 'vertical', antiAlias: 'crisp', warp: { style: 'arc', bend: 50, horizontal: 0, vertical: -10, axis: 'horizontal' } };
    expect(() => validateTextData(d)).not.toThrow();
    const doc = newDocument(20, 20);
    doc.layers.push(textLayerWith(d));
    expect(() => validateDocument(structuredClone(doc))).not.toThrow();
  });
  it('rejects malformed data', () => {
    const good = textLayer('x');
    const bad = (mut: (d: TextLayerData) => void) => {
      const d = structuredClone(good);
      mut(d);
      return () => validateTextData(d);
    };
    expect(bad((d) => (d.mode = 'curved' as never))).toThrow();
    expect(bad((d) => (d.content.paragraphs = []))).toThrow();
    expect(bad((d) => (d.content.paragraphs[0].runs[0].text = 'a\nb'))).toThrow();
    expect(bad((d) => (d.content.paragraphs[0].runs[0].style.size = -1))).toThrow();
    expect(bad((d) => (d.content.paragraphs[0].runs[0].style.color = [0, 0, 300]))).toThrow();
    expect(bad((d) => (d.warp = { style: 'spiral' as never, bend: 0, horizontal: 0, vertical: 0, axis: 'horizontal' }))).toThrow();
    const doc = newDocument(20, 20);
    const l = layer('pixel', 'P', 20, 20);
    l.textData = good;
    doc.layers.push(l);
    expect(() => validateDocument(doc)).toThrow();
  });
});

describe('text to shape', () => {
  it('raises quadratic contours to cubic knots in one nonzero component', () => {
    const mask = contoursToVectorMask([
      [['M', 0, 0], ['L', 10, 0], ['Q', 10, 10, 0, 10], ['Z']],
      [['M', 2, 2], ['L', 4, 2], ['L', 2, 4], ['L', 2, 2], ['Z']],
    ]);
    expect(() => validateVectorMask(mask)).not.toThrow();
    expect(mask.paths).toHaveLength(2);
    expect(vectorComponents(mask)).toHaveLength(1);
    const k = mask.paths[0].knots;
    expect(k).toHaveLength(3);
    // Out control of (10,0) and in control of (0,10) at 2/3 toward (10,10).
    close(k[1].points, [10, 0, 10, 0, 10, 20 / 3]);
    close(k[2].points.slice(0, 4), [20 / 3, 10, 0, 10]);
    // The explicit return to the start is merged into the first knot.
    expect(mask.paths[1].knots).toHaveLength(3);
    expect(mask.paths.every((p) => p.fillRule === 'non-zero' && !p.open)).toBe(true);
  });
});

describe('point and paragraph conversion', () => {
  const style = { ...defaultCharStyle(), size: 20 };
  it('turns soft wraps into paragraph breaks and keeps the first baseline', () => {
    const d: TextLayerData = { content: fromPlainText('aaa bbb ccc', style), mode: 'paragraph', box: { width: 75, height: 500 }, origin: { x: 10, y: 10 }, orientation: 'horizontal', antiAlias: 'smooth' };
    const lay = layoutText(d, { measure: mono });
    expect(lay.lines.length).toBe(2);
    const p = convertParagraphMode(d, lay);
    expect(p.mode).toBe('point');
    expect(p.content.paragraphs.map((x) => x.runs.map((r) => r.text).join(''))).toEqual(['aaa bbb', 'ccc']);
    expect(p.origin.y).toBeCloseTo(lay.lines[0].y);
    expect(p.origin.x).toBe(10);
    const back = convertParagraphMode(p, layoutText(p, { measure: mono }));
    expect(back.mode).toBe('paragraph');
    // The new frame fits the lines without rewrapping them.
    expect(layoutText(back, { measure: mono }).lines.length).toBe(2);
  });
});
