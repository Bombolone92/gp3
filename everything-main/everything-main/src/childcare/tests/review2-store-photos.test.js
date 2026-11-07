/**
 * Second review: photo preparation before upload (files.js).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { preparePhoto, isImage } from '../src/files.js';

function fakeCanvas(outBytes) {
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 1200, height: 900, close() {} }));
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return { drawImage() {} };
    }
    async convertToBlob({ type }) {
      return new Blob([new Uint8Array(outBytes)], { type });
    }
  };
}

afterEach(() => {
  delete globalThis.createImageBitmap;
  delete globalThis.OffscreenCanvas;
});

describe('preparePhoto', () => {
  it('always converts an iPhone HEIC photo to a format every browser shows', async () => {
    // HEIC compresses well: the JPEG made from it can be the larger file.
    fakeCanvas(300_000);
    const heic = new File([new Uint8Array(200_000)], 'IMG_0001.HEIC', { type: 'image/heic' });
    const out = await preparePhoto(heic);
    expect(out.blob.type).toBe('image/jpeg');
    expect(isImage(out.blob.type)).toBe(true);
  });

  it('keeps a small JPEG as it is', async () => {
    fakeCanvas(300_000);
    const jpg = new File([new Uint8Array(200_000)], 'park.jpg', { type: 'image/jpeg' });
    const out = await preparePhoto(jpg);
    expect(out.blob).toBe(jpg);
  });
});

describe('saveFile', () => {
  it('names a converted HEIC photo .jpg', async () => {
    fakeCanvas(300_000);
    const { saveFile } = await import('../src/files.js');
    const att = await saveFile(new File([new Uint8Array(200_000)], 'IMG_0001.HEIC', { type: 'image/heic' }), { area: 'media', owner: '2026-10' });
    expect(att.name).toBe('IMG_0001.jpg');
    expect(att.path).toMatch(/-IMG_0001\.jpg$/);
    expect(att.type).toBe('image/jpeg');
  });
});

describe('a failed upload', () => {
  it('does not leave the photo behind in storage when its thumbnail cannot be written', async () => {
    fakeCanvas(300_000);
    const { fakeFS } = await import('./helpers.js');
    const fs = fakeFS();
    const write = fs.write;
    fs.write = async (path, blob) => {
      if (path.endsWith('-t.jpg')) throw new Error('Network error');
      return write(path, blob);
    };
    globalThis.puter = { fs };
    try {
      const { saveFile } = await import('../src/files.js');
      const photo = new File([new Uint8Array(3_000_000)], 'park.jpg', { type: 'image/jpeg' });
      await expect(saveFile(photo, { area: 'media', owner: '2026-10' })).rejects.toThrow('Network error');
      expect([...fs.files.keys()]).toEqual([]);
    } finally {
      delete globalThis.puter;
    }
  });
});
