// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { signOut } from '../src/platform.js';

afterEach(() => {
  delete globalThis.puter;
  localStorage.clear();
});

describe('signing out', () => {
  it('leaves no account or firm details behind on the device', () => {
    globalThis.puter = { auth: { signOut() {} } };
    localStorage.setItem('legal.user', JSON.stringify({ uuid: 'u-1', username: 'eleanor' }));
    localStorage.setItem('legal.workspaces.u-1', JSON.stringify({ current: 'https://legalfirm-abc.puter.work', joined: [{ business: 'Rivera Law' }] }));
    localStorage.setItem('legal.theme', 'dark');
    signOut();
    expect(localStorage.getItem('legal.user')).toBeNull();
    expect(localStorage.getItem('legal.workspaces.u-1')).toBeNull();
    // Device preferences are not account data.
    expect(localStorage.getItem('legal.theme')).toBe('dark');
  });
});
