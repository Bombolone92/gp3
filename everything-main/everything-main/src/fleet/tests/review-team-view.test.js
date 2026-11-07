// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadWorker, person, OWNER } from './review-team-helpers.js';
import { app } from '../src/app.js';

const URL_ = 'https://fleet-abc.puter.work';
const SAM = person('user-2', 'sam');
const ALEX = person('user-3', 'alex');
const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(fn) {
  for (let i = 0; i < 200 && !fn(); i++) await tick();
  return fn();
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

let w;
let teamAccessCard;
beforeEach(async () => {
  ({ teamAccessCard } = await import('../src/views/team-access.js'));
  w = loadWorker();
  document.body.innerHTML = '';
});
afterEach(() => {
  delete globalThis.puter;
  app.team = null;
  app.user = null;
  app.workspaces = null;
});

async function join(role, user) {
  const inv = (await w.api(OWNER, { op: 'invite', role })).body;
  return (await w.api(user, { op: 'join', token: inv.token })).body;
}

function render(as, user, role, exec = w.exec(user)) {
  globalThis.puter = { workers: { exec } };
  app.user = as;
  app.team = { url: URL_, role, business: 'Acme' };
  app.workspaces = { current: role === 'owner' ? 'own' : URL_, own: role === 'owner' ? { url: URL_ } : {}, joined: role === 'owner' ? [] : [{ url: URL_, business: 'Acme', role }] };
  const card = teamAccessCard();
  document.body.append(card);
  return card;
}

const openDialogs = () => [...document.querySelectorAll('dialog[open]')];
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('team access card', () => {
  it('puts the role back when changing it fails', async () => {
    await join('driver', SAM);
    const real = w.exec(OWNER);
    const card = render({ uuid: 'owner-1', username: 'olivia' }, OWNER, 'owner', async (url, init) => {
      if (JSON.parse(init.body).op === 'setRole') return new Response(JSON.stringify({ ok: false, error: 'server_error', message: 'Down' }), { status: 500 });
      return real(url, init);
    });
    const sel = await until(() => card.querySelector('select[aria-label="Role for sam"]'));
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    await tick();
    await tick();
    expect(sel.value).toBe('driver');
  });

  it('asks before revoking an invitation', async () => {
    await w.api(OWNER, { op: 'invite', role: 'member', label: 'Jordan' });
    const card = render({ uuid: 'owner-1', username: 'olivia' }, OWNER, 'owner');
    const revoke = await until(() => button(card, 'Revoke'));
    revoke.click();
    await tick();
    const dlg = openDialogs().at(-1);
    expect(dlg?.textContent).toMatch(/Revoke/);
    button(dlg, 'Cancel').click();
    await tick();
    await tick();
    expect((await w.api(OWNER, { op: 'invites' })).body.invites).toHaveLength(1);
    button(card, 'Revoke').click();
    await tick();
    button(openDialogs().at(-1), 'Revoke').click();
    expect(await until(() => !button(card, 'Revoke'))).toBe(true);
    expect((await w.api(OWNER, { op: 'invites' })).body.invites).toHaveLength(0);
  });

  it('lets an admin leave the fleet', async () => {
    await join('admin', SAM);
    const card = render({ uuid: 'user-2', username: 'sam' }, SAM, 'admin');
    expect(button(card, 'Leave this fleet')).toBeTruthy();
  });

  it('does not offer an admin controls that lock themselves out', async () => {
    await join('admin', SAM);
    await join('member', ALEX);
    const card = render({ uuid: 'user-2', username: 'sam' }, SAM, 'admin');
    await until(() => card.querySelector('select[aria-label="Role for alex"]'));
    expect(card.querySelector('select[aria-label="Role for sam"]')).toBeNull();
    expect(card.querySelector('button[aria-label="Remove sam"]')).toBeNull();
    expect(card.querySelector('button[aria-label="Remove alex"]')).toBeTruthy();
  });

  it('shows the local day someone joined', async () => {
    await join('member', SAM);
    const late = new Date(2026, 9, 12, 23, 30).getTime();
    w.kv.data.set('flt:m:user-2', { ...w.kv.data.get('flt:m:user-2'), joinedAt: late });
    const card = render({ uuid: 'owner-1', username: 'olivia' }, OWNER, 'owner');
    await until(() => /Joined/.test(card.textContent));
    expect(card.textContent).toMatch(/Joined Oct 12, 2026/);
  });
});

describe('leaving from the team card', () => {
  it('says so and lets you try again when leaving fails', async () => {
    await join('member', SAM);
    const card = render({ uuid: 'user-2', username: 'sam' }, SAM, 'member');
    globalThis.puter.kv = { get: async () => null, set: async () => Promise.reject(new Error('Puter is not responding')) };
    const btn = button(card, 'Leave this fleet');
    btn.click();
    await tick();
    button(openDialogs().at(-1), 'Leave').click();
    expect(await until(() => /not responding/.test(document.body.textContent))).toBe(true);
    expect(btn.disabled).toBe(false);
  });
});

describe('team list errors', () => {
  it('offers to try again when the team cannot be loaded', async () => {
    let down = true;
    const real = w.exec(OWNER);
    const card = render({ uuid: 'owner-1', username: 'olivia' }, OWNER, 'owner', async (url, init) => {
      if (down) throw new Error('offline');
      return real(url, init);
    });
    const retry = await until(() => button(card, 'Try again'));
    expect(retry).toBeTruthy();
    expect(retry.closest('[role="alert"]')).toBeTruthy();
    down = false;
    retry.click();
    expect(await until(() => /Nobody has joined yet/.test(card.textContent))).toBe(true);
  });
});

describe('invite dialog', () => {
  it('does not claim the label is private to the person creating it', async () => {
    const card = render({ uuid: 'owner-1', username: 'olivia' }, OWNER, 'owner');
    button(card, 'Invite someone').click();
    await tick();
    const dlg = openDialogs().at(-1);
    expect(dlg.textContent).not.toMatch(/Only you see this/);
    expect(dlg.textContent).toMatch(/Only the owner and admins see this/);
    // Admins see each other's labels in the list of open invitations.
    await w.api(OWNER, { op: 'invite', role: 'driver', label: 'Jordan' });
    await join('admin', SAM);
    expect((await w.api(SAM, { op: 'invites' })).body.invites.map((i) => i.label)).toContain('Jordan');
  });
});
