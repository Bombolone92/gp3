// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { imageToPng } from '../src/ui/picture-raster.js';

let ctx, canvas, image;
beforeEach(() => {
  ctx = Object.fromEntries(['translate', 'rotate', 'scale', 'save', 'restore', 'beginPath', 'rect', 'clip', 'drawImage'].map(k => [k, vi.fn()]));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { canvas = this; return ctx; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['pixels'], { type: 'image/png' })));
  vi.stubGlobal('Image', class { naturalWidth = 400; naturalHeight = 300; set src(v) { image = this; this.onload(); } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([90, 180, 270, -37, 23.4])('includes the entire picture at %s degrees and applies flips before rotation', async rotation => {
  const w = 113.25, h = 48.75;
  const blob = await imageToPng('data:image/png;base64,AA==', { w, h, rotation, flipH: true, flipV: true });
  expect(blob.type).toBe('image/png');
  const a = rotation * Math.PI / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  expect(canvas.width + 1e-10).toBeGreaterThanOrEqual((w * cos + h * sin) * 2);
  expect(canvas.height + 1e-10).toBeGreaterThanOrEqual((w * sin + h * cos) * 2);
  expect(ctx.translate.mock.calls).toEqual([[canvas.width / 2, canvas.height / 2], [-w, -h]]);
  expect(ctx.rotate).toHaveBeenCalledWith(a);
  expect(ctx.scale).toHaveBeenCalledWith(-1, -1);
  expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, w * 2, h * 2);
  expect(ctx.translate.mock.invocationCallOrder[0]).toBeLessThan(ctx.rotate.mock.invocationCallOrder[0]);
  expect(ctx.rotate.mock.invocationCallOrder[0]).toBeLessThan(ctx.scale.mock.invocationCallOrder[0]);
  expect(ctx.scale.mock.invocationCallOrder[0]).toBeLessThan(ctx.translate.mock.invocationCallOrder[1]);
});

it('combines rotation with source cropping and destination clipping in picture coordinates', async () => {
  await imageToPng('data:image/svg+xml;base64,AA==', { w: 200, h: 60, rotation: 90, srcRect: { l: .25, r: .25 }, fillRect: { l: .1, b: .5 } });
  expect(ctx.rect).toHaveBeenCalledWith(40, 0, 360, 60);
  expect(ctx.drawImage).toHaveBeenCalledWith(image, -140, 0, 720, 60);
  expect(ctx.rotate.mock.invocationCallOrder[0]).toBeLessThan(ctx.clip.mock.invocationCallOrder[0]);
});

it('bounds the rotated bitmap budget and retains intrinsic sizing for an ordinary unrotated image', async () => {
  await imageToPng('data:image/png;base64,AA==', { w: 9000, h: 14000, rotation: 45 });
  expect(canvas.width).toBeLessThanOrEqual(4096);
  expect(canvas.height).toBeLessThanOrEqual(4096);
  ctx.drawImage.mockClear();
  await imageToPng('data:image/png;base64,AA==', { w: 20, h: 30 });
  expect([canvas.width, canvas.height]).toEqual([400, 300]);
  expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 400, 300);
});
