import { afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { decodeImages } from '../src/engine/images.js';
const bytes = unzipSync(readFileSync('public/fixtures/inline-images.docx'))['word/media/image1.png'];
afterEach(() => vi.unstubAllGlobals());

it('bounds aggregate decoded image size before allocating any bitmaps', async () => {
  const large = new Uint8Array(bytes), view = new DataView(large.buffer); view.setUint32(16, 4000); view.setUint32(20, 4000);
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  const assets = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), { bytes: large, mime: 'image/png' }]));
  await expect(decodeImages(assets)).rejects.toThrow(/64 megapixels/); expect(decode).not.toHaveBeenCalled();
});

it('releases other decoded bitmaps if one image cannot be decoded', async () => {
  const bitmap = { close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(bitmap).mockRejectedValueOnce(new Error('Bad pixels')));
  await expect(decodeImages({ first: { bytes }, second: { bytes } })).rejects.toThrow(/could not be decoded/);
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('retains healthy bitmaps and reports each failed asset in preview mode', async () => {
  const bitmap = { width: 10, height: 10, close: vi.fn() }, failed = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValueOnce(new Error('Bad pixels')).mockResolvedValueOnce(bitmap).mockRejectedValueOnce(new Error('Bad pixels')));
  const decoded = await decodeImages({ broken: { bytes }, healthy: { bytes }, other: { bytes } }, undefined, undefined, failed);
  expect([...decoded.keys()]).toEqual(['healthy', 'broken', 'other']);
  expect(decoded.get('broken').previewPlaceholder).toBe(true);
  expect(decoded.get('other').previewPlaceholder).toBe(true);
  expect(decoded.get('healthy')).toBe(bitmap); expect(bitmap.close).not.toHaveBeenCalled();
  expect(failed.mock.calls.map(([id]) => id)).toEqual(['broken', 'other']);
  expect(failed.mock.calls.every(([, error]) => /could not be decoded/.test(error.message))).toBe(true);
});

it('keeps the aggregate allocation limit in preview mode', async () => {
  const large = new Uint8Array(bytes), view = new DataView(large.buffer); view.setUint32(16, 4000); view.setUint32(20, 4000);
  const decode = vi.fn(), failed = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  const assets = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), { bytes: large, mime: 'image/png' }]));
  await expect(decodeImages(assets, undefined, undefined, failed)).rejects.toThrow(/64 megapixels/);
  expect(decode).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});

it('cleans up healthy assets if the recovery callback itself fails', async () => {
  const bitmap = { width: 8, height: 8, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(bitmap).mockRejectedValueOnce(new Error('Bad pixels')));
  await expect(decodeImages({ healthy: { bytes }, broken: { bytes } }, undefined, undefined, () => {
    throw new Error('Cannot recover');
  })).rejects.toThrow('Cannot recover');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
