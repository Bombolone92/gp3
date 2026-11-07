import { describe, expect, it } from 'vitest';
import { applyImage, blendCodes, calculate, channelBlends, channelPlane } from '../src/imaging/channels/apply';
import { rgba8 } from '../src/imaging/types';

const px = (img: { data: Uint8ClampedArray }, i = 0) => Array.from(img.data.slice(i * 4, i * 4 + 4));

describe('channel arithmetic', () => {
  it('computes blend modes, add and subtract with scale and offset', () => {
    expect(blendCodes('multiply', 200, 100)).toBeCloseTo((200 * 100) / 255, 6);
    expect(blendCodes('screen', 255, 0)).toBe(255);
    expect(blendCodes('add', 100, 100, 2, 10)).toBe(110);
    expect(blendCodes('subtract', 50, 100, 1, 128)).toBe(78);
    expect(blendCodes('subtract', 50, 100)).toBe(0);
    expect(blendCodes('add', 200, 200)).toBe(255);
    expect(channelBlends.map((b) => b.id)).toContain('add');
    expect(channelBlends.map((b) => b.id)).not.toContain('hue');
  });

  it('applies an image with opacity, invert and a target channel', () => {
    const t = rgba8(2, 1, [200, 100, 50, 255]);
    const s = rgba8(2, 1, [100, 100, 100, 255]);
    const m = applyImage(t, s, 'rgb', { blend: 'multiply', opacity: 1 });
    expect(px(m)).toEqual([78, 39, 20, 255]);
    const half = applyImage(t, s, 'rgb', { blend: 'normal', opacity: 0.5 });
    expect(px(half)).toEqual([150, 100, 75, 255]);
    const inv = applyImage(t, s, 'r', { blend: 'normal', opacity: 1, invert: true });
    expect(px(inv)).toEqual([155, 100, 50, 255]);
  });

  it('applies a single channel through a mask and keeps transparency when asked', () => {
    const t = rgba8(2, 1, [10, 20, 30, 255]);
    t.data[7] = 0; // second pixel transparent
    const plane = new Uint8Array([255, 255]);
    const mask = new Uint8Array([0, 255]);
    const kept = applyImage(t, plane, 'rgb', { blend: 'normal', opacity: 1, mask, preserveTransparency: true });
    expect(px(kept, 0)).toEqual([10, 20, 30, 255]);
    expect(px(kept, 1)[3]).toBe(0);
    const filled = applyImage(t, plane, 'rgb', { blend: 'normal', opacity: 1, mask });
    expect(px(filled, 1)).toEqual([255, 255, 255, 255]);
  });

  it('calculates a new channel from two planes', () => {
    const img = rgba8(1, 1, [255, 128, 0, 200]);
    expect(Array.from(channelPlane(img, 'g'))).toEqual([128]);
    expect(Array.from(channelPlane(img, 'alpha'))).toEqual([200]);
    expect(Array.from(channelPlane(img, 'gray'))).toEqual([Math.round(0.299 * 255 + 0.587 * 128)]);
    const a = new Uint8Array([200, 0]),
      b = new Uint8Array([100, 50]);
    expect(Array.from(calculate(a, b, { blend: 'lighten', opacity: 1 }))).toEqual([200, 50]);
    expect(Array.from(calculate(a, b, { blend: 'subtract', opacity: 1, offset: 100 }))).toEqual([0, 150]);
    expect(Array.from(calculate(a, b, { blend: 'difference', opacity: 0.5 }))).toEqual([100, 50]);
  });
});
