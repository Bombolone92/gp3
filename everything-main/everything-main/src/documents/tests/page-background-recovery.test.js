import { it, expect, vi } from 'vitest';
import { paintPagePictureBackground } from '../src/engine/canvas-page-background.js';

it('retains the solid page color for an unavailable read-only background while keeping strict painting guarded', () => {
  const page = { backgroundPicture: { assetId: 'bad.png', width: 8, height: 8 } };
  const ctx = { createPattern: vi.fn(), fillRect: vi.fn() };
  expect(() => paintPagePictureBackground(ctx, page, new Map())).toThrow('background image could not be decoded');
  paintPagePictureBackground(ctx, page, new Map(), { bestEffort: true });
  expect(ctx.createPattern).not.toHaveBeenCalled(); expect(ctx.fillRect).not.toHaveBeenCalled();
});
