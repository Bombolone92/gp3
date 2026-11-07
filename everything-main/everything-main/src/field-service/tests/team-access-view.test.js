// @vitest-environment jsdom
/** Settings > Team sign-in card against a stubbed team server. */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const calls = [];
let fail = null;
vi.mock('../src/team.js', () => ({
  call: async (url, op, payload) => {
    calls.push([op, payload]);
    if (fail === op) throw new Error('Could not reach the team server. Check your connection.');
    if (op === 'members') return { owner: { username: 'boss' }, members: [{ uuid: 'u1', username: 'jordan', role: 'member', joinedAt: Date.UTC(2026, 9, 1) }] };
    if (op === 'invites') return { invites: [] };
    return { ok: true };
  },
  inviteLink: () => '',
  leaveWorkspace: () => {},
  enableTeam: async () => ({ own: { url: 'https://new.puter.work', name: 'fs-new' }, skipped: [] }),
  saveWorkspaces: async () => {
    throw new Error('KV unavailable');
  },
}));

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('team sign-in card', () => {
  it('puts a role menu back when changing the role fails', async () => {
    const { app } = await import('../src/app.js');
    app.demo = false;
    app.team = { url: 'https://team.example', role: 'owner' };
    const { teamAccessCard } = await import('../src/views/team-access.js');
    const card = teamAccessCard();
    document.body.append(card);
    await settle();
    const sel = card.querySelector('select[aria-label="Role for jordan"]');
    expect(sel.value).toBe('member');

    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    await settle();
    expect(calls.at(-1)).toEqual(['setRole', { uuid: 'u1', role: 'admin' }]);
    expect(sel.value).toBe('admin');

    fail = 'setRole';
    sel.value = 'member';
    sel.dispatchEvent(new Event('change'));
    await settle();
    expect(sel.value).toBe('admin');
  });
});

describe('turning on team sign-in', () => {
  it('removes the new team server when the business list cannot be saved', async () => {
    const { app } = await import('../src/app.js');
    app.demo = false;
    app.team = null;
    app.workspaces = { current: 'own', own: {}, joined: [] };
    app.store = { flush: async () => {} };
    const deleted = [];
    globalThis.puter = { kv: {}, workers: { delete: async (name) => deleted.push(name) } };
    const { teamAccessCard } = await import('../src/views/team-access.js');
    const card = teamAccessCard();
    document.body.append(card);
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Turn on team sign-in')).click();
    await settle();
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Turn on').click();
    await settle(50);
    expect(deleted).toEqual(['fs-new']);
    expect(app.workspaces).toEqual({ current: 'own', own: {}, joined: [] });
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(card.querySelector('button.btn.primary').disabled).toBe(false);
  });
});
