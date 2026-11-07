// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { pictureGeometry, pictureRect, readPictureRect, drawPicture } from '../src/core/picture-geometry.js';
import { pictureNode } from '../src/ui/picture.js';

it('maps a cropped source onto an inset/outset destination independently of size', () => {
  const obj = { srcRect: { l: .25, r: .25, t: -.5 }, fillRect: { l: .1, r: -.1, b: .25 } };
  expect(pictureGeometry(obj)).toEqual({ source: { x: .25, y: -.5, w: .5, h: 1.5 }, fill: { x: .1, y: 0, w: 1, h: .75 }, x: -.4, y: .25, w: 2, h: .5 });
  for (const [w, h] of [[120, 80], [900, 130]]) {
    const ctx = Object.fromEntries(['save', 'beginPath', 'rect', 'clip', 'drawImage', 'restore'].map(k => [k, vi.fn()]));
    drawPicture(ctx, 'bitmap', obj, w, h);
    expect(ctx.rect).toHaveBeenCalledWith(.1 * w, 0, w, .75 * h);
    expect(ctx.drawImage).toHaveBeenCalledWith('bitmap', -.4 * w, .25 * h, 2 * w, .5 * h);
    expect(ctx.restore).toHaveBeenCalledOnce();
  }
});

it('normalizes absent, malformed and percentage rectangles without NaN geometry', () => {
  expect(readPictureRect({ l: '12.5%', b: '-7500', r: 'bad', t: '0' })).toEqual({ l: .125, b: -.075 });
  expect(pictureRect({ l: NaN, r: Infinity, t: 30000, b: 0 })).toBeNull();
  expect(pictureGeometry({})).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  for (const obj of [{ srcRect: { l: 1 } }, { srcRect: { t: 2 } }, { fillRect: { l: .6, r: .5 } }]) {
    expect(pictureGeometry(obj)).toBeNull();
    const ctx = { save: vi.fn() };
    drawPicture(ctx, {}, obj, 100, 100);
    expect(ctx.save).not.toHaveBeenCalled();
  }
});

it('uses nested viewports for source crops, fill clipping, transforms, and accessible labels', () => {
  const src = 'data:image/png;base64,AA==';
  const node = pictureNode({ src, title: 'Preview <safe>', srcRect: { l: .25, t: -.5, r: .25 }, fillRect: { l: .1, r: -.1, b: .25 }, flipH: true, rotation: 30 });
  expect(node.getAttribute('aria-label')).toBe('Preview <safe>');
  expect(node.style.transform).toBe('rotate(30deg) scale(-1, 1)');
  expect(node.getAttribute('viewBox')).toBe('0 0 1 1');
  const crop = node.querySelector('svg');
  expect(crop.getAttribute('viewBox')).toBe('0.25 -0.5 0.5 1.5');
  expect(crop.style.width).toBe('100%');
  expect(crop.style.height).toBe('75%');
  expect(crop.getAttribute('x')).toBe('0.1');
  expect(crop.querySelector('image').getAttribute('href')).toBe(src);
  expect(pictureNode({ src }).tagName).toBe('IMG');
});
