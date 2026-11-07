// @vitest-environment jsdom
/**
 * Regression tests from the second adversarial review of Settings > Staff and
 * family access (src/views/access.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let failSetRole = false;
vi.mock('../src/team.js', () => ({
  call: async (url, op, payload) => {
    calls.push([op, payload]);
    if (op === 'members') return { owner: { uuid: 'o', username: 'director' }, members: [{ uuid: 'u2', username: 'tess', role: 'staff', staffId: 't1', joinedAt: Date.parse('2026-10-01') }] };
    if (op === 'invites') return { invites: [{ id: 'a'.repeat(64), role: 'parent', label: 'Mia Chen', expiresAt: Date.parse('2026-10-20') }, { id: 'b'.repeat(64), role: 'staff', label: 'Ola Berg', expiresAt: Date.parse('2026-10-21') }] };
    if (op === 'setRole' && failSetRole) throw Object.assign(new Error('Only the director can change admins.'), { status: 403 });
    return {};
  },
  leaveWorkspace: () => {},
  enableTeam: async () => ({}),
  saveWorkspaces: async () => {},
}));

const { app } = await import('../src/app.js');
const { accessCard } = await import('../src/views/access.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  failSetRole = false;
  document.body.innerHTML = '';
  app.demo = false;
  app.team = { url: 'https://childcare-abc.puter.work', role: 'owner', school: 'Acorn' };
  const staff = { t1: { id: 't1', firstName: 'Tess', lastName: 'Ng' } };
  app.store = { get: (c, id) => (c === 'staff' ? staff[id] : null) || null, all: () => [], sync: () => {}, state: { settings: { school: {} } } };
});

describe('access: people list', () => {
  it('puts the role picker back when changing a role fails', async () => {
    const card = accessCard();
    document.body.append(card);
    await flush();
    const sel = card.querySelector('select[aria-label^="Role for"]');
    expect(sel.value).toBe('staff');
    failSetRole = true;
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    await flush();
    expect(sel.value).toBe('staff');
  });

  it('names the invitation each Revoke button cancels', async () => {
    const card = accessCard();
    document.body.append(card);
    await flush();
    const labels = [...card.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Revoke').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Revoke the invitation for Mia Chen', 'Revoke the invitation for Ola Berg']);
  });
});
