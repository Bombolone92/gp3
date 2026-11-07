/**
 * Attachments: downscaling, size limits, and names the team server accepts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { saveFile, isImage, shrinkImage } from '../src/files.js';

function fakeImageApis({ outBytes = 200_000 } = {}) {
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 6000, height: 4000, close() {} }));
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

describe('attachments', () => {
  beforeEach(() => {
    app.demo = true;
    app.team = null;
  });
  afterEach(() => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
    app.demo = false;
    app.team = null;
  });

  it('accepts a large phone photo that shrinks below the limit', async () => {
    fakeImageApis();
    const big = new File([new Uint8Array(30 * 1024 * 1024)], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const att = await saveFile(big, 'files/vehicles');
    expect(att.size).toBe(200_000);
    expect(att.type).toBe('image/jpeg');
  });

  it('converts HEIC photos to JPEG where the browser can decode them', async () => {
    fakeImageApis({ outBytes: 300_000 });
    const heic = new File([new Uint8Array(400_000)], 'IMG_0002.HEIC', { type: 'image/heic' });
    const out = await shrinkImage(heic);
    expect(out.type).toBe('image/jpeg');
  });

  it('keeps HEIC as a plain file where the browser cannot show it', async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('The source image could not be decoded.');
    });
    const heic = new File([new Uint8Array(1000)], 'IMG_0003.heic', { type: 'image/heic' });
    const att = await saveFile(heic, 'files/issues');
    expect(att.type).toBe('image/heic');
    // Chrome and Firefox draw HEIC as a broken image, so it is not a thumbnail.
    expect(isImage(att.type)).toBe(false);
    expect(isImage('image/jpeg')).toBe(true);
  });

  it('still refuses a file that stays over the limit', async () => {
    const big = new File([new Uint8Array(26 * 1024 * 1024)], 'scan.pdf', { type: 'application/pdf' });
    await expect(saveFile(big)).rejects.toThrow(/25 MB/);
  });
});
