import { describe, it, expect, beforeEach, vi } from 'vitest';
import axe from 'axe-core';
import { app } from '../src/app.js';

function fakeReplica({ role = 'owner' } = {}) {
  const r = new EventTarget();
  Object.assign(r, {
    meta: { name: 'Acme Support', timezone: 'UTC', autoCloseDays: 4, csat: { enabled: true }, portal: { enabled: true, title: 'Acme Help', intro: '', color: null }, email: { enabled: true, replyTo: null } },
    members: {
      u1: { uuid: 'u1', username: 'olivia', name: 'Olivia Owner', role: 'owner', groups: ['support'], active: true, joinedAt: Date.now() },
      u2: { uuid: 'u2', username: 'aaron', name: 'Aaron Agent', role: 'agent', groups: [], active: true, joinedAt: Date.now() },
    },
    cfg: { groups: [{ id: 'support', name: 'Support', desc: 'Everyone' }], triggers: [{ id: 't1', title: 'Email the requester', active: true, actions: [{ field: 'notify_requester' }] }] },
    tickets: new Map([[1, { id: 1, subject: 'Hi', status: 'open', group: 'support', requester: 1, tags: [], createdAt: 0, updatedAt: 0, via: 'web' }]]),
    users: new Map([[1, { id: 1, name: 'Carla' }]]),
    orgs: new Map(),
    articles: new Map(),
    me: null,
    isAdmin() { return this.me.role !== 'agent'; },
    agents() { return Object.values(this.members).filter((m) => m.active); },
    ticketsFor(fn) { return [...this.tickets.values()].filter(fn); },
    setMeta(m) { this.meta = m; this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['d']) } })); },
    setConfig(k, v) { this.cfg = { ...this.cfg, [k]: v }; this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['c']) } })); },
    setMembers(m) { this.members = m; this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['m']) } })); },
  });
  r.me = role === 'owner' ? r.members.u1 : r.members.u2;
  return r;
}

async function noAxeViolations(el) {
  const res = await axe.run(el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

beforeEach(() => {
  document.body.innerHTML = '';
  app.replica = fakeReplica();
  app.api = { server: 'local', desk: 'desk1', isLocal: true, get: vi.fn(async () => ({ invites: [] })), post: vi.fn(), put: vi.fn(), del: vi.fn() };
  app.doc = { desks: {}, server: null };
});

describe('admin shell', () => {
  it('tells agents that only administrators can change settings', async () => {
    app.replica = fakeReplica({ role: 'agent' });
    const { mount } = await import('../src/views/admin.js');
    const main = document.createElement('main');
    document.body.append(main);
    mount(main, { sub: 'general', route: { path: ['admin', 'general'] } });
    expect(main.textContent).toContain('Only administrators can change settings');
  });

  it('lists every section, grouped', async () => {
    const { mount } = await import('../src/views/admin.js');
    const main = document.createElement('main');
    document.body.append(main);
    mount(main, { sub: 'groups', route: { path: ['admin', 'groups'] } });
    const links = [...main.querySelectorAll('.admin-nav .side-link')].map((a) => a.textContent);
    expect(links).toEqual(['General', 'Team', 'Groups', 'Help center', 'Email', 'Macros', 'Views', 'Triggers', 'Ticket fields', 'Service levels', 'Data']);
    expect(main.querySelector('[aria-current="page"]').textContent).toBe('Groups');
  });
});

describe('admin sections', () => {
  it('General shows the desk settings and only offers saving after a change', async () => {
    const { renderGeneral } = await import('../src/views/admin-settings.js');
    const el = document.createElement('div');
    document.body.append(el);
    renderGeneral(el);
    const name = el.querySelector('input.input');
    expect(name.value).toBe('Acme Support');
    const bar = el.querySelector('.save-bar');
    expect(bar.classList.contains('dirty')).toBe(false);
    name.value = 'Acme Care';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bar.classList.contains('dirty')).toBe(true);
    await noAxeViolations(el);
  });

  it('saves only what was edited here over another administrator\'s changes', async () => {
    const { renderHelpCenter, renderGeneral } = await import('../src/views/admin-settings.js');
    const saved = [];
    app.saveMeta = async (patch) => { saved.push(patch); return app.replica.meta; };
    try {
      const el = document.createElement('div');
      document.body.append(el);
      renderHelpCenter(el);
      const intro = el.querySelector('textarea');
      intro.value = 'Welcome!';
      intro.dispatchEvent(new Event('input', { bubbles: true }));
      // Meanwhile another administrator turns the help center off and on sign-in.
      app.replica.setMeta({ ...app.replica.meta, portal: { ...app.replica.meta.portal, enabled: false, signInRequired: true } });
      el.querySelector('form').requestSubmit();
      await new Promise((r) => setTimeout(r, 0));
      expect(saved[0].portal).toMatchObject({ enabled: false, signInRequired: true, intro: 'Welcome!' });

      el.remove();
      const gen = document.createElement('div');
      document.body.append(gen);
      renderGeneral(gen);
      const days = gen.querySelector('input[type="number"]');
      days.value = '7';
      days.dispatchEvent(new Event('input', { bubbles: true }));
      app.replica.setMeta({ ...app.replica.meta, name: 'Acme Care' });
      gen.querySelector('form').requestSubmit();
      await new Promise((r) => setTimeout(r, 0));
      expect(saved[1]).toEqual({ autoCloseDays: 7 });
    } finally {
      delete app.saveMeta;
    }
  });

  it('Team explains team access while the desk runs locally', async () => {
    const { renderTeam } = await import('../src/views/admin-team.js');
    const el = document.createElement('div');
    document.body.append(el);
    renderTeam(el);
    expect(el.textContent).toContain('This help desk runs only in your account');
    expect(el.querySelector('.admin-head-actions .btn-primary').disabled).toBe(true);
    const rows = el.querySelectorAll('.members-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Owner');
    await noAxeViolations(el);
  });

  it('Groups shows member and ticket counts', async () => {
    const { renderGroups } = await import('../src/views/admin-team.js');
    const el = document.createElement('div');
    document.body.append(el);
    renderGroups(el);
    const card = el.querySelector('.group-card');
    expect(card.textContent).toContain('Support');
    expect(card.textContent).toContain('1 agent');
    expect(card.textContent).toContain('1 open ticket');
    await noAxeViolations(el);
  });

  it('Help center points local desks to Team', async () => {
    const { renderHelpCenter } = await import('../src/views/admin-settings.js');
    const el = document.createElement('div');
    document.body.append(el);
    renderHelpCenter(el);
    expect(el.textContent).toContain('Turn on team access to publish your help center');
    await noAxeViolations(el);
  });

  it('Email lists the triggers that send mail', async () => {
    const { renderEmail } = await import('../src/views/admin-settings.js');
    const el = document.createElement('div');
    document.body.append(el);
    renderEmail(el);
    expect(el.querySelector('.trigger-list').textContent).toContain('Email the requester');
    expect(el.textContent).toContain('Receive requests by email');
    await noAxeViolations(el);
  });

  it('Data offers exports to everyone and deletion only to the owner', async () => {
    const { renderData } = await import('../src/views/admin-data.js');
    let el = document.createElement('div');
    document.body.append(el);
    renderData(el);
    expect(el.textContent).toContain('Export everything');
    expect(el.textContent).toContain('Delete help desk');
    await noAxeViolations(el);
    app.replica = fakeReplica({ role: 'agent' });
    app.replica.me = { ...app.replica.members.u2, role: 'admin' };
    el = document.createElement('div');
    renderData(el);
    expect(el.textContent).not.toContain('Delete help desk');
  });
});
