import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
import { saveFile, fileUrl } from '../src/files.js';

describe('viewing attachments', () => {
  it('keeps a bounded number of viewed files in memory', async () => {
    app.demo = true;
    const revoked = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u) => (revoked.push(u), revoke(u));
    try {
      const atts = [];
      for (let i = 0; i < 45; i++) atts.push(await saveFile(new File([`file ${i}`], `f${i}.txt`, { type: 'text/plain' })));
      const urls = [];
      for (const a of atts) urls.push(await fileUrl(a));
      expect(revoked).toEqual(urls.slice(0, 5));
      // The most recent one is still served from the cache.
      expect(await fileUrl(atts[44])).toBe(urls[44]);
    } finally {
      URL.revokeObjectURL = revoke;
    }
  });
});
