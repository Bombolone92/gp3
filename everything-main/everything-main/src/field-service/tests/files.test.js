import { describe, it, expect } from 'vitest';
import { fileUrl } from '../src/files.js';

describe('attachments', () => {
  it('downloads a file once when it is asked for again while still downloading', async () => {
    let reads = 0;
    globalThis.puter = {
      fs: {
        read: async () => {
          reads++;
          await new Promise((r) => setTimeout(r, 10));
          return new Blob(['photo'], { type: 'image/jpeg' });
        },
      },
    };
    try {
      const att = { path: 'files/jobs/abc-photo.jpg', type: 'image/jpeg' };
      const [a, b] = await Promise.all([fileUrl(att), fileUrl(att)]);
      expect(a).toBe(b);
      expect(await fileUrl(att)).toBe(a);
      expect(reads).toBe(1);
    } finally {
      delete globalThis.puter;
    }
  });
});
