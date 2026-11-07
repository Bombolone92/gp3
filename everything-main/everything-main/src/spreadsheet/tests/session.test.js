// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let session;
let writes;
beforeEach(async () => {
  vi.resetModules();
  writes = [];
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'demo' }) },
    kv: {
      get: async () => null,
      set: vi.fn((key, value) => new Promise((resolve) => writes.push({ value, resolve }))),
    },
  });
  ({ session } = await import('../src/lib/session.js'));
  await session.init();
});
afterEach(() => vi.unstubAllGlobals());

describe('session settings', () => {
  it('preserves every preference when updates overlap', async () => {
    const theme = session.setTheme('dark');
    const locale = session.setLocale('de-DE');
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(writes[0].value.theme).toBe('dark');
    writes[0].resolve();
    await theme;
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve();
    await locale;
    expect(session.settings).toMatchObject({ theme: 'dark', locale: 'de-DE' });
    expect(writes[1].value).toMatchObject({ theme: 'dark', locale: 'de-DE' });
  });

  it('saves rapid theme changes in order and keeps the latest choice visible', async () => {
    const dark = session.setTheme('dark');
    const light = session.setTheme('light');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(session.settings.theme).toBe('light');
    writes[0].resolve();
    await dark;
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(session.settings.theme).toBe('light');
    writes[1].resolve();
    await light;
    expect(writes.map(({ value }) => value.theme)).toEqual(['dark', 'light']);
    expect(session.settings.theme).toBe('light');
  });
});
