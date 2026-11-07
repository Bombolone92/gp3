import { describe, expect, it } from 'vitest';
import { readPsd } from 'ag-psd';
import { exportPsdText, importPsdText, parsePostScriptName, postScriptName } from '../src/model/psd-text';
import { savePsd } from '../src/model/psd';
import { layer, newDocument } from '../src/model/document';
import { applyCharStyle, applyParagraphStyle, defaultCharStyle, fromPlainText, type TextLayerData } from '../src/imaging/text/model';

describe('PostScript font names', () => {
  it('map to families, weights and italics', () => {
    expect(parsePostScriptName('Inter-BoldItalic')).toEqual({ family: 'Inter', weight: 700, italic: true });
    expect(parsePostScriptName('CrimsonPro-Regular')).toEqual({ family: 'Crimson Pro', weight: 400, italic: false });
    expect(parsePostScriptName('JetBrainsMono-Light')).toEqual({ family: 'JetBrains Mono', weight: 300, italic: false });
    expect(parsePostScriptName('ArialMT')).toEqual({ family: 'Arial', weight: 400, italic: false });
    expect(parsePostScriptName('TimesNewRomanPS-BoldMT')).toMatchObject({ family: 'Times New Roman', weight: 700 });
    expect(parsePostScriptName('SomeFoundrySans-SemiboldIt')).toEqual({ family: 'Some Foundry Sans', weight: 600, italic: true });
  });
  it('are generated from styles', () => {
    expect(postScriptName({ family: 'Inter', weight: 700, italic: false })).toBe('Inter-Bold');
    expect(postScriptName({ family: 'Crimson Pro', weight: 400, italic: true })).toBe('CrimsonPro-Italic');
    expect(postScriptName({ family: 'Arial', weight: 700, italic: true })).toBe('Arial-BoldItalicMT');
    expect(parsePostScriptName(postScriptName({ family: 'JetBrains Mono', weight: 600, italic: true }))).toEqual({ family: 'JetBrains Mono', weight: 600, italic: true });
  });
});

describe('PSD text import', () => {
  it('converts styles, runs, paragraphs and resolution', () => {
    const t = importPsdText(
      {
        text: 'Hello world\rSecond',
        transform: [2, 0, 0, 2, 100, 50],
        antiAlias: 'crisp',
        style: { font: { name: 'Inter-Regular' }, fontSize: 50, fillColor: { r: 10, g: 20, b: 30 } },
        styleRuns: [
          { length: 6, style: {} },
          { length: 6, style: { font: { name: 'Inter-Bold' }, underline: true, fontCaps: 2 } },
          { length: 6, style: { fontBaseline: 1, tracking: 50, autoLeading: false, leading: 100 } },
        ],
        paragraphStyleRuns: [{ length: 12, style: { justification: 'center' } }, { length: 6, style: { justification: 'right', startIndent: 25 } }],
      },
      150,
    )!;
    expect(t).toBeDefined();
    const [p0, p1] = t.data.content.paragraphs;
    expect(p0.runs.map((r) => r.text)).toEqual(['Hello ', 'world']);
    expect(p0.runs[0].style.size).toBe(24); // 50 px at 150 ppi
    expect(p0.runs[0].style.color).toEqual([10, 20, 30]);
    expect(p0.runs[1].style).toMatchObject({ weight: 700, underline: true, allCaps: true });
    expect(p1.runs[0].style).toMatchObject({ superscript: true, tracking: 50, leading: 48 });
    expect(p0.style.align).toBe('center');
    expect(p1.style).toMatchObject({ align: 'right', indentLeft: 12 });
    expect(t.data.antiAlias).toBe('crisp');
    expect(t.scale).toEqual([2, 2]);
    expect(t.rotation).toBeCloseTo(0);
  });
  it('reads paragraph frames, warps and rotations', () => {
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const t = importPsdText({ text: 'x', transform: [c, s, -s, c, 5, 6], shapeType: 'box', boxBounds: [0, 0, 300, 120], warp: { style: 'arcLower', value: 40, perspective: -10, perspectiveOther: 5, rotate: 'vertical' } }, 72)!;
    expect(t.data.mode).toBe('paragraph');
    expect(t.data.box).toEqual({ width: 300, height: 120 });
    expect(t.data.warp).toEqual({ style: 'arc-lower', bend: 40, horizontal: -10, vertical: 5, axis: 'vertical' });
    expect(t.rotation).toBeCloseTo(30);
  });
  it('declines skewed, mirrored and custom-warped text', () => {
    expect(importPsdText({ text: 'x', transform: [1, 0, 0.5, 1, 0, 0] }, 72)).toBeUndefined();
    expect(importPsdText({ text: 'x', transform: [-1, 0, 0, 1, 0, 0] }, 72)).toBeUndefined();
    expect(importPsdText({ text: 'x', warp: { style: 'custom' } }, 72)).toBeUndefined();
  });
});

describe('PSD text export', () => {
  const sample = (): TextLayerData => {
    let content = fromPlainText('Big title\nSmall print', { ...defaultCharStyle(), size: 36, color: [200, 10, 10] });
    content = applyCharStyle(content, 4, 9, { family: 'Crimson Pro', italic: true, weight: 700, strikethrough: true });
    content = applyCharStyle(content, 10, 21, { size: 12, smallCaps: true, baselineShift: 3, scaleX: 80 });
    content = applyParagraphStyle(content, 10, 21, { align: 'justify-left', spaceBefore: 6, hyphenate: true });
    return { content, mode: 'point', origin: { x: 0, y: 0 }, orientation: 'horizontal', antiAlias: 'strong', warp: { style: 'flag', bend: 25, horizontal: 0, vertical: 0, axis: 'horizontal' } };
  };
  it('round-trips through the importer', () => {
    const data = sample();
    const out = exportPsdText(data, [1, 0, 0, 1, 30, 40], 300);
    expect(out.text).toBe('Big title\nSmall print');
    expect(out.styleRuns!.reduce((n, r) => n + r.length, 0)).toBe(out.text.length);
    expect(out.paragraphStyleRuns!.reduce((n, r) => n + r.length, 0)).toBe(out.text.length);
    const back = importPsdText(out, 300)!;
    const norm = (d: TextLayerData) => JSON.stringify(d.content.paragraphs.map((p) => [p.style, p.runs.map((r) => [r.text, { ...r.style, language: '' }])]));
    expect(norm(back.data)).toBe(norm(data));
    expect(back.data.warp).toEqual(data.warp);
    expect(back.data.antiAlias).toBe('strong');
    expect(back.matrix).toEqual([1, 0, 0, 1, 30, 40]);
  });
  it('folds a point origin into the PSD transform', () => {
    const data = { ...sample(), origin: { x: 10, y: 20 } };
    const out = exportPsdText(data, [2, 0, 0, 2, 1, 1], 72);
    expect(out.transform).toEqual([2, 0, 0, 2, 21, 41]);
    const box = exportPsdText({ ...data, mode: 'paragraph', box: { width: 50, height: 60 } }, [1, 0, 0, 1, 0, 0], 72);
    expect(box.shapeType).toBe('box');
    expect(box.boxBounds).toEqual([10, 20, 60, 80]);
  });
  it('writes editable text into saved PSD files', async () => {
    const doc = newDocument(64, 32);
    const l = layer('text', 'Caption', 1, 1);
    l.textData = sample();
    l.textFrame = { x: 0, y: -30, width: 120, height: 40 };
    l.transform = { x: 4, y: 2, width: 60, height: 20, rotation: 0 };
    doc.layers.push(l);
    const blob = await savePsd(doc, async () => new Uint8Array(64 * 32 * 4));
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
    const t = psd.children![0].text!;
    expect(t.text).toBe('Big title\nSmall print');
    // Half scale from the frame/transform pair: 120 local px -> 60 document px.
    expect(t.transform![0]).toBeCloseTo(0.5);
    const back = importPsdText(t, 72)!;
    expect(back.data.content.paragraphs[1].runs[0].style).toMatchObject({ size: 12, smallCaps: true, baselineShift: 3, scaleX: 80 });
    expect(back.data.content.paragraphs[0].runs[1].style).toMatchObject({ family: 'Crimson Pro', italic: true, weight: 700 });
  });
});
