/**
 * Second review: object URLs for photos (files.js) must not pile up.
 */
import { describe, it, expect, vi } from 'vitest';

describe('photo object URLs', () => {
  it('keeps a bounded number alive over a long session', async () => {
    const { app } = await import('../src/app.js');
    const files = await import('../src/files.js');
    app.demo = true;
    const live = new Set();
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:test/${Math.random()}`;
      live.add(u);
      return u;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => live.delete(u));
    try {
      // A tablet scrolling a week of feeds: a thousand different photos.
      for (let i = 0; i < 1000; i++) {
        const path = `media/2026-10/p${i}-t.jpg`;
        files.putDemoFile(path, new Blob(['x'], { type: 'image/jpeg' }));
        await files.fileUrl({ path, type: 'image/jpeg' });
      }
      expect(live.size).toBeLessThanOrEqual(400);
      // The most recent ones are still served from memory.
      const again = await files.fileUrl({ path: 'media/2026-10/p999-t.jpg', type: 'image/jpeg' });
      expect(live.has(again)).toBe(true);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });
});
