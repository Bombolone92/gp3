import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('service worker activation', () => {
  it('removes obsolete Shifts caches while preserving other apps on the origin', async () => {
    const handlers = new Map();
    const keys = new Set(['shifts-shell-v0', 'shifts-shell-v1', 'other-app-v1']);
    let claimed = false;
    runInNewContext(source, {
      self: {
        addEventListener: (type, handler) => handlers.set(type, handler),
        clients: { claim: async () => { claimed = true; } },
      },
      caches: {
        keys: async () => [...keys],
        delete: async (key) => keys.delete(key),
      },
    });
    let activated;
    handlers.get('activate')({ waitUntil: (promise) => { activated = promise; } });
    await activated;
    expect([...keys]).toEqual(['shifts-shell-v1', 'other-app-v1']);
    expect(claimed).toBe(true);
  });
});
