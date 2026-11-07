// @vitest-environment jsdom
/**
 * Opening the app without a connection, signed in, after using it before.
 */
import { describe, it, expect } from 'vitest';
import { fakePuter, boot, settle } from './review-sync-boot-helpers.js';
import { createIdbCache } from '../src/core/cache.js';

describe('offline start', () => {
  it('opens the fleet kept on this device when Puter cannot be reached', async () => {
    // An earlier online visit.
    const online = fakePuter();
    online.kv.data.set('fl1:r:vehicles:v1', { id: 'v1', name: 'Van 7' });
    online.kv.data.set('fl1:meta', { vehicles: 1 });
    let app = await boot(online);
    expect(app.store.get('vehicles', 'v1')?.name).toBe('Van 7');
    await app.store.persistCache();

    // Now without a connection: every Puter call fails.
    const offline = fakePuter({
      kvGet: async () => {
        throw new Error('Failed to fetch');
      },
    });
    offline.auth.getUser = async () => {
      throw new TypeError('Failed to fetch');
    };
    app = await boot(offline);
    expect(app.user?.uuid).toBe('u-1');
    expect(app.store?.get('vehicles', 'v1')?.name).toBe('Van 7');
    await createIdbCache('user:u-1').clear();
  });

  it('still asks to sign in again when the account itself is refused', async () => {
    const puter = fakePuter();
    puter.auth.getUser = async () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    };
    const app = await boot(puter);
    expect(app.store).toBe(null);
    expect(document.querySelector('.welcome [role="alert"]')).not.toBe(null);
  });
});
