// @vitest-environment jsdom
/**
 * Someone removed from a shared fleet opens it (a file of its own, so no
 * earlier boot's listeners are listening).
 */
import { describe, it, expect } from 'vitest';
import { fakePuter, teamExec, boot, settle } from './review-sync-boot-helpers.js';

describe('removed from a fleet', () => {
  it('says so once and switches back once', async () => {
    const url = 'https://fleet-abc.puter.work';
    const server = { role: 'member', calls: [], removed: true };
    const puter = fakePuter({ exec: teamExec(server) });
    puter.kv.data.set('fl1:workspaces', { current: url, own: {}, joined: [{ url, business: 'Acme', role: 'member' }] });
    await boot(puter);
    await settle(2300); // past the first retry
    const toasts = [...document.querySelectorAll('.toast')].filter((t) => /no longer have access/.test(t.textContent));
    expect(toasts).toHaveLength(1);
    // Let the switch back finish before the test environment is torn down.
    for (let i = 0; i < 100 && puter.kv.data.get('fl1:workspaces').joined.length; i++) await settle(10);
    expect(puter.kv.data.get('fl1:workspaces').joined).toEqual([]);
    await settle(50);
  }, 10000);
});
