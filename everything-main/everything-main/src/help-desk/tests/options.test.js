import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
import { myGroup } from '../src/views/options.js';

describe('assigning to yourself', () => {
  it('uses your first group that still exists', () => {
    app.replica = { cfg: { groups: [{ id: 'billing', name: 'Billing' }] }, me: { uuid: 'me', groups: ['support', 'billing'] } };
    expect(myGroup()).toBe('billing');
    app.replica = { cfg: { groups: [] }, me: { uuid: 'me', groups: ['support'] } };
    expect(myGroup()).toBeNull();
  });
});
