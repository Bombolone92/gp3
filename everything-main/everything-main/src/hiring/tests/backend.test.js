import { describe, it, expect, vi } from 'vitest';
import { createPuterBackend } from '../src/core/backend.js';

describe('createPuterBackend save', () => {
  const fakePuter = () => ({ kv: { set: vi.fn(async () => true) } });

  it('writes values under the KV limit', async () => {
    const puter = fakePuter();
    const backend = createPuterBackend(puter);
    await backend.save('candidates', [{ id: 'c1', name: 'Ada' }]);
    expect(puter.kv.set).toHaveBeenCalledWith('hiring.v1:candidates', JSON.stringify([{ id: 'c1', name: 'Ada' }]));
  });

  it('refuses an over-limit value with an actionable message instead of an opaque backend error', async () => {
    const puter = fakePuter();
    const backend = createPuterBackend(puter);
    const oversized = [{ id: 'c1', notes: 'x'.repeat(400 * 1024) }];
    await expect(backend.save('candidates', oversized)).rejects.toThrow(/candidates data is too large .* backup/i);
    expect(puter.kv.set).not.toHaveBeenCalled();
  });
});

describe('createPuterBackend load', () => {
  const withValue = (value) => ({ kv: { get: vi.fn(async () => value) } });

  it('parses stored JSON and passes through absent values', async () => {
    expect(await createPuterBackend(withValue('[{"id":"c1"}]')).load('candidates')).toEqual([{ id: 'c1' }]);
    expect(await createPuterBackend(withValue(null)).load('candidates')).toBeNull();
  });

  it('refuses a corrupted value instead of booting empty over it', async () => {
    const backend = createPuterBackend(withValue('[{"id":"c1"'));
    // Null here would read as "never written": the app would look brand
    // new and the first save would overwrite the recoverable remains.
    await expect(backend.load('candidates')).rejects.toThrow(/candidates could not be read/i);
  });
});
