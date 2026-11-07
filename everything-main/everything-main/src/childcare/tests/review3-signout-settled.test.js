import { describe, it, expect, vi } from 'vitest';

// Signing out must wait for the offline copy to be deleted even when
// clearing the file cache fails first (IndexedDB blocked by another tab).
let snapshotsCleared = false;
vi.mock('../src/core/cache.js', async (orig) => ({
  ...(await orig()),
  clearSnapshots: () => new Promise((r) => setTimeout(() => ((snapshotsCleared = true), r()), 50)),
}));
vi.mock('../src/files.js', () => ({ clearFileCache: () => Promise.reject(new Error('blocked')) }));

describe('sign out', () => {
  it('waits for the snapshots to be deleted when the file cache fails', async () => {
    globalThis.localStorage = { removeItem() {}, getItem: () => null, setItem() {} };
    globalThis.location = { reload: vi.fn() };
    globalThis.puter = { auth: { signOut: vi.fn() } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const platform = await import('../src/platform.js');
    await platform.signOut('u1');
    expect(snapshotsCleared).toBe(true);
    warn.mockRestore();
  });
});
