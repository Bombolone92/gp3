import { describe, expect, it } from 'vitest';
import { layer, newDocument } from '../src/model/document';
import { Assets } from '../src/model/assets';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import { gridFromImage } from '../src/model/tiles';
import { documentTileIds } from '../src/model/pixel-layer';
import { renderLayerFill, resolvePattern, stylePatternIds, validLayerFill, type LayerFill } from '../src/model/fill-layer';
import { activeLayerStyle, sanitizeStyle } from '../src/model/layer-style';
import { renderLayerStyle } from '../src/imaging/effects/render';
import { findPatternPreset } from '../src/imaging/pattern/presets';
import type { LayerStyle } from '../src/imaging/effects/types';
import type { RGBA8 } from '../src/imaging/types';

const blackWhite = { kind: 'solid' as const, colorStops: [{ location: 0, color: [0, 0, 0] as [number, number, number] }, { location: 1, color: [255, 255, 255] as [number, number, number] }], opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }] };
const px = (img: RGBA8, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('fill layers', () => {
  it('renders a linear gradient across the layer frame along its angle', () => {
    const frame = { x: 0, y: 0, width: 100, height: 50 };
    const fill: LayerFill = { type: 'gradient', gradient: blackWhite, style: 'linear', angle: 0, scale: 1, method: 'classic' };
    const img = renderLayerFill(fill, frame, frame, frame, () => undefined);
    expect(px(img, 0, 25)[0]).toBeLessThan(5);
    expect(px(img, 99, 25)[0]).toBeGreaterThan(250);
    // Middle column is mid-gray in classic interpolation.
    expect(Math.abs(px(img, 50, 10)[0] - 128)).toBeLessThan(4);
    // Angle 90 runs from the bottom (first stop) to the top.
    const up = renderLayerFill({ ...fill, angle: 90 }, frame, frame, frame, () => undefined);
    expect(px(up, 50, 49)[0]).toBeLessThan(8);
    expect(px(up, 50, 0)[0]).toBeGreaterThan(247);
  });
  it('renders a sub-rectangle identically to the matching part of the full frame', () => {
    const frame = { x: 0, y: 0, width: 64, height: 64 };
    const fill: LayerFill = { type: 'gradient', gradient: blackWhite, style: 'radial', angle: 30, scale: 0.8 };
    const full = renderLayerFill(fill, frame, frame, frame, () => undefined);
    const part = renderLayerFill(fill, { x: 10, y: 20, width: 8, height: 8 }, frame, frame, () => undefined);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(px(part, x, y)).toEqual(px(full, 10 + x, 20 + y));
  });
  it('tiles patterns from the document origin with scale and offset', () => {
    const p = findPatternPreset('checker')!;
    const frame = { x: 0, y: 0, width: 64, height: 64 };
    const img = renderLayerFill({ type: 'pattern', patternId: 'checker', scale: 1 }, frame, frame, frame, findPatternPreset);
    expect(px(img, 3, 3)).toEqual(px(p.tile, 3, 3));
    expect(px(img, 35, 3)).toEqual(px(p.tile, 3, 3));
    const shifted = renderLayerFill({ type: 'pattern', patternId: 'checker', scale: 1, offset: { x: 16, y: 0 } }, frame, frame, frame, findPatternPreset);
    expect(px(shifted, 19, 3)).toEqual(px(p.tile, 3, 3));
    // A missing pattern renders transparent rather than failing.
    const none = renderLayerFill({ type: 'pattern', patternId: 'nope', scale: 1 }, frame, frame, frame, () => undefined);
    expect(none.data.every((v) => v === 0)).toBe(true);
  });
  it('validates fill descriptions', () => {
    expect(validLayerFill({ type: 'gradient', gradient: blackWhite, style: 'linear', angle: 0, scale: 1 })).toBe(true);
    expect(validLayerFill({ type: 'gradient', gradient: blackWhite, style: 'spiral', angle: 0, scale: 1 })).toBe(false);
    expect(validLayerFill({ type: 'pattern', patternId: 'checker', scale: 0 })).toBe(false);
    expect(validLayerFill({ type: 'pattern', patternId: 'checker', scale: 2 })).toBe(true);
    expect(validLayerFill(null)).toBe(false);
  });
});

describe('document patterns', () => {
  const tile = (): RGBA8 => {
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let i = 0; i < 6; i++) data.set([i * 40, 255 - i * 40, 7, i === 0 ? 0 : 255], i * 4);
    return { width: 3, height: 2, data };
  };
  it('resolves presets first, then document patterns, keeping transparent edges', () => {
    const assets = new Assets();
    const grid = gridFromImage(assets.tiles, tile());
    const doc = { patterns: [{ id: 'user-a', name: 'A', width: 3, height: 2, grid }] };
    expect(resolvePattern(doc, assets.tiles, 'checker')?.name).toBe('Checker');
    const p = resolvePattern(doc, assets.tiles, 'user-a')!;
    expect(p.tile.width).toBe(3);
    expect(p.tile.height).toBe(2);
    expect(Array.from(p.tile.data)).toEqual(Array.from(tile().data));
    expect(resolvePattern(doc, assets.tiles, 'missing')).toBeUndefined();
  });
  it('keeps pattern tiles alive and survives a project round trip with fills and styles', async () => {
    const assets = new Assets();
    const doc = newDocument(40, 30);
    const grid = gridFromImage(assets.tiles, tile());
    doc.patterns = [{ id: 'user-a', name: 'A', width: 3, height: 2, grid }];
    expect([...documentTileIds(doc)]).toEqual(expect.arrayContaining(Object.values(grid.tiles)));
    const fill = layer('solid', 'Pattern Fill', 40, 30);
    fill.fill = { type: 'pattern', patternId: 'user-a', scale: 2, angle: 15 };
    fill.style = { enabled: true, stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 3, position: 'outside', fill: { type: 'color', color: [1, 2, 3] } }] };
    doc.layers.push(fill);
    const restored = await deserialize(await serialize(doc, assets));
    const l = restored.document.layers[0];
    expect(l.fill).toEqual(fill.fill);
    expect(l.style).toEqual(fill.style);
    const p = resolvePattern(restored.document, restored.assets.tiles, 'user-a')!;
    expect(Array.from(p.tile.data)).toEqual(Array.from(tile().data));
  });
  it('rejects fills on non-fill layers and malformed patterns', () => {
    const doc = newDocument(10, 10);
    const l = layer('text', 'T', 10, 10);
    l.fill = { type: 'pattern', patternId: 'checker', scale: 1 };
    doc.layers.push(l);
    expect(() => validateDocument(structuredClone(doc))).toThrow('Invalid layer options');
    const d2 = newDocument(10, 10);
    (d2 as unknown as { patterns: unknown }).patterns = [{ id: 'x', name: 'x', width: 0, height: 2, grid: {} }];
    expect(() => validateDocument(d2)).toThrow('Invalid document patterns');
  });
});

describe('layer style helpers', () => {
  const shadow = { enabled: true, blendMode: 'multiply' as const, opacity: 0.5, color: [0, 0, 0] as [number, number, number], angle: 90, useGlobalLight: false, distance: 4, spread: 0, size: 4 };
  it('treats disabled styles and styles without enabled effects as inactive', () => {
    const l = layer('pixel', 'P', 10, 10);
    expect(activeLayerStyle(l)).toBeUndefined();
    l.style = { enabled: true, globalAngle: 120 };
    expect(activeLayerStyle(l)).toBeUndefined();
    l.style = { enabled: true, dropShadow: [{ ...shadow, enabled: false }] };
    expect(activeLayerStyle(l)).toBeUndefined();
    l.style = { enabled: false, dropShadow: [shadow] };
    expect(activeLayerStyle(l)).toBeUndefined();
    l.style = { enabled: true, dropShadow: [shadow] };
    expect(activeLayerStyle(l)).toBe(l.style);
  });
  it('clamps hostile sizes without touching the original', () => {
    const style: LayerStyle = { enabled: true, scale: 1e9, dropShadow: [{ ...shadow, size: 1e9, distance: -5, opacity: 7 }], bevel: { enabled: true, style: 'emboss', technique: 'smooth', depth: 1e6, direction: 'up', size: 1e6, soften: 1e6, angle: 0, altitude: 30, useGlobalLight: false, highlightMode: 'screen', highlightColor: [255, 255, 255], highlightOpacity: 2, shadowMode: 'multiply', shadowColor: [0, 0, 0], shadowOpacity: -1 } };
    const s = sanitizeStyle(style);
    expect(s.scale).toBe(10);
    expect(s.dropShadow![0]).toMatchObject({ size: 250, distance: 0, opacity: 1 });
    expect(s.bevel).toMatchObject({ depth: 10, size: 250, soften: 250, highlightOpacity: 1, shadowOpacity: 0 });
    expect(style.dropShadow![0].size).toBe(1e9);
  });
  it('lists every pattern a style uses', () => {
    const ids = stylePatternIds({
      enabled: true,
      patternOverlay: { enabled: true, blendMode: 'normal', opacity: 1, patternId: 'a', scale: 1 },
      stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 2, position: 'outside', fill: { type: 'pattern', patternId: 'b', scale: 1 } }],
    });
    expect(ids.sort()).toEqual(['a', 'b']);
  });
  it('renders a cropped buffer exactly like the full document, including document-anchored overlays', () => {
    const W = 80, H = 60;
    const full: RGBA8 = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 25; y < 45; y++) for (let x = 30; x < 55; x++) full.data.set([200, 40, 40, 255], (y * W + x) * 4);
    const style: LayerStyle = {
      enabled: true,
      dropShadow: [shadow],
      patternOverlay: { enabled: true, blendMode: 'normal', opacity: 0.7, patternId: 'checker', scale: 1 },
      gradientOverlay: [{ enabled: true, blendMode: 'multiply', opacity: 1, style: 'linear', angle: 0, scale: 1, alignWithLayer: false, gradient: blackWhite }],
    };
    const ref = renderLayerStyle(full, style, { fillOpacity: 1, patterns: findPatternPreset });
    const ox = 17, oy = 11, cw = 52, ch = 48;
    const crop: RGBA8 = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
    for (let y = 0; y < ch; y++) crop.data.set(full.data.subarray(((oy + y) * W + ox) * 4, ((oy + y) * W + ox + cw) * 4), y * cw * 4);
    const out = renderLayerStyle(crop, style, { fillOpacity: 1, patterns: findPatternPreset, origin: { x: ox, y: oy }, documentSize: { width: W, height: H } });
    expect(out.bounds.x + ox).toBe(ref.bounds.x);
    expect(out.bounds.y + oy).toBe(ref.bounds.y);
    expect(out.bounds.width).toBe(ref.bounds.width);
    expect(Array.from(out.layer.data)).toEqual(Array.from(ref.layer.data));
    expect(Array.from(out.below!.data)).toEqual(Array.from(ref.below!.data));
  });
});

describe('transformed pattern fills', () => {
  it('match the reference pattern sampler', async () => {
    const { renderPattern } = await import('../src/imaging/pattern/pattern');
    const { transformedPattern } = await import('../src/model/fill-layer');
    const p = findPatternPreset('bricks')!;
    const rect = { x: 5, y: -7, width: 40, height: 30 };
    const ref = renderPattern(rect.width, rect.height, p, { scale: 1.7, angle: 23, offset: { x: 3.5, y: -2 } }, { x: rect.x, y: rect.y });
    const out = transformedPattern({ width: rect.width, height: rect.height, data: new Uint8ClampedArray(rect.width * rect.height * 4) }, p, 1.7, 23, { x: 3.5, y: -2 }, rect);
    let max = 0;
    for (let i = 0; i < ref.data.length; i++) max = Math.max(max, Math.abs(ref.data[i] - out.data[i]));
    expect(max).toBeLessThanOrEqual(1);
  });
});
