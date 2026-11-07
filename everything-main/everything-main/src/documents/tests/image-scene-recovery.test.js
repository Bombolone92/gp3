import { it, expect, vi } from 'vitest';
const fake = vi.hoisted(() => ({ shape: vi.fn() }));
vi.mock('../src/engine/canvas-shapes.js', () => ({ decodeShape: fake.shape }));
import { decodeImages } from '../src/engine/images.js';

it('keeps independent scenes after a scene fails and retains strict cleanup', async () => {
  const good = { bitmap: { width: 10, height: 10 }, close: vi.fn() };
  const assets = { first: { scene: {}, width: 10, height: 10 }, bad: { scene: {}, width: 10, height: 10 }, last: { scene: {}, width: 10, height: 10 } };
  fake.shape.mockImplementation(async asset => { if (asset === assets.bad) throw new Error('Unavailable child picture'); return good; });
  const failed = vi.fn();
  const map = await decodeImages(assets, undefined, undefined, failed);
  expect([...map.keys()]).toEqual(['first', 'bad', 'last']); expect(failed).toHaveBeenCalledWith('bad', expect.any(Error));
  expect(map.get('bad').previewPlaceholder).toBe(true);
  expect(good.close).not.toHaveBeenCalled();
  await expect(decodeImages(assets)).rejects.toThrow('Unavailable child picture'); expect(good.close).toHaveBeenCalledOnce();
});
