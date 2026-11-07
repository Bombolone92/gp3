// Pure helpers behind File menu features: SVG path data, transparent trim,
// File Info cleaning and PSD painted-mask export.
import { describe, expect, it } from 'vitest';
import { knotsToPath } from '../src/features/files/svg-export';
import { trimTransparent } from '../src/features/files/layers-export';
import { cleanInfo } from '../src/features/files/info';
import { savePsd } from '../src/model/psd';
import { newDocument, layer } from '../src/model/document';
import { getLayerMaskImageData, initializeCanvas, readPsd } from 'ag-psd';

// Node has no canvas; ag-psd only needs plain image data buffers here.
initializeCanvas(() => { throw new Error('No canvas in tests.'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData);

describe('knotsToPath', () => {
  it('writes cubic segments from incoming/anchor/outgoing knots and closes paths', () => {
    const k = (x: number, y: number) => ({ points: [x, y, x, y, x, y] });
    expect(knotsToPath([{ open: false, knots: [k(0, 0), k(10, 0), k(10, 10)] }])).toBe('M0 0C0 0 10 0 10 0C10 0 10 10 10 10C10 10 0 0 0 0Z');
    expect(knotsToPath([{ open: true, knots: [k(1.23456, 2), k(3, 4)] }])).toBe('M1.235 2C1.235 2 3 4 3 4');
    expect(knotsToPath([{ open: false, knots: [] }])).toBe('');
  });
});

describe('trimTransparent', () => {
  it('crops to the alpha bounds and returns undefined for empty layers', () => {
    const d = new Uint8ClampedArray(4 * 3 * 4);
    d.set([9, 8, 7, 1], (1 * 4 + 2) * 4);
    d.set([1, 2, 3, 255], (2 * 4 + 1) * 4);
    const t = trimTransparent({ width: 4, height: 3, data: d })!;
    expect([t.width, t.height]).toEqual([2, 2]);
    expect([...t.data]).toEqual([0, 0, 0, 0, 9, 8, 7, 1, 1, 2, 3, 255, 0, 0, 0, 0]);
    expect(trimTransparent({ width: 2, height: 2, data: new Uint8ClampedArray(16) })).toBeUndefined();
    const deep = trimTransparent({ width: 1, height: 1, data: new Uint16Array([1, 2, 3, 4]) })!;
    expect(deep.data).toBeInstanceOf(Uint16Array);
  });
});

describe('cleanInfo', () => {
  it('trims, drops empty fields and returns undefined when nothing is left', () => {
    expect(cleanInfo({ title: '  Sunset ', author: '', copyright: '© Me\u0000' })).toEqual({ title: 'Sunset', copyright: '© Me' });
    expect(cleanInfo({ title: '   ' })).toBeUndefined();
    expect(cleanInfo({ description: 'x'.repeat(5000) })!.description!.length).toBe(4000);
  });
});

describe('PSD export of clipping and painted masks', () => {
  it('writes clipping, blend modes and maskGrid planes (inversion baked in)', async () => {
    const doc = newDocument(4, 2, 'Masks');
    const base = layer('solid', 'Base', 4, 2);
    base.blend = 'multiply';
    const clipped = layer('solid', 'Clipped', 4, 2);
    clipped.clipped = true;
    clipped.blend = 'color dodge';
    clipped.maskGrid = { channels: 1, x: 0, y: 0, tiles: {}, bounds: null, fill: 255 };
    clipped.maskInverted = true;
    doc.layers.push(base, clipped);
    const render = async () => new Uint8Array(4 * 2 * 4).fill(255);
    const plane = { bounds: { x: 1, y: 0, width: 2, height: 2 }, data: new Uint8Array([0, 255, 64, 128]), defaultColor: 255 as const };
    const blob = await savePsd(doc, render, undefined, undefined, (l) => (l.name === 'Clipped' ? plane : undefined));
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { skipCompositeImageData: true, skipThumbnail: true, useRawData: true });
    const [b, c] = psd.children!;
    expect(b.blendMode).toBe('multiply');
    expect(b.clipping).toBeFalsy();
    expect(c.clipping).toBe(true);
    expect(c.blendMode).toBe('color dodge');
    expect(c.mask).toMatchObject({ left: 1, top: 0, right: 3, bottom: 2, defaultColor: 0 });
    const m = c.mask!.imageData ?? getLayerMaskImageData(c)!;
    expect([0, 1, 2, 3].map((i) => m.data[i * 4])).toEqual([255, 0, 191, 127]);
    // Without the callback, masks fall back to the previous behavior (none written).
    const plain = readPsd(new Uint8Array(await (await savePsd(doc, render)).arrayBuffer()), { skipCompositeImageData: true, skipThumbnail: true, useRawData: true });
    expect(plain.children![1].mask).toBeUndefined();
  });
});
