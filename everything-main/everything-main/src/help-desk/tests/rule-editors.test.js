/** Rule editors (views, macros) keep saved values that no longer exist. */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { renderSection } from '../src/views/admin-rules.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function replica() {
  const listeners = new Set();
  return {
    cfg: {
      macros: [{ id: 'm1234567', title: 'Assign to Bob', active: true, actions: [{ field: 'assignee', value: 'bob' }, { field: 'group', value: 'gone-group' }], comment: null }],
      views: [{ id: 'v1234567', title: 'Bob and Acme', active: true, conditions: { all: [{ field: 'assignee', op: 'is', value: 'bob' }, { field: 'organization', op: 'is', value: 99 }, { field: 'group', op: 'is', value: 'gone-group' }, { field: 'requester', op: 'is', value: 555 }], any: [] }, columns: ['subject'], sort: { field: 'updatedAt', dir: 'desc' }, groupBy: null }],
      triggers: [], fields: [], groups: [{ id: 'support', name: 'Support' }], sla: null,
    },
    members: { u1: { uuid: 'u1', name: 'Olivia', role: 'owner', active: true }, bob: { uuid: 'bob', name: 'Bob', role: 'agent', active: false } },
    me: { uuid: 'u1', name: 'Olivia', role: 'owner' },
    meta: { name: 'Acme' },
    tickets: new Map(),
    users: new Map([[7, { id: 7, name: 'Aaron Aardvark' }]]),
    orgs: new Map([[1, { id: 1, name: 'Zeta Corp' }]]),
    agents({ includeInactive = false } = {}) { return Object.values(this.members).filter((m) => includeInactive || m.active); },
    isAdmin() { return true; },
    setConfig(kind, value) { this.cfg = { ...this.cfg, [kind]: value }; },
    addEventListener: (t, fn) => listeners.add(fn),
    removeEventListener: (t, fn) => listeners.delete(fn),
  };
}

afterEach(() => { document.body.textContent = ''; });

async function openEditor(section, id) {
  app.replica = replica();
  const saved = [];
  app.api = { put: async (path, body) => { saved.push(body.value); return { value: body.value }; }, desk: 'd' };
  const el = document.createElement('div');
  document.body.append(el);
  renderSection(el, { section, route: { path: ['admin', section, id], query: {} } });
  await tick(50);
  return { el, saved };
}

describe('rule editors', () => {
  it('keep a view\'s references to agents, groups and customers that are gone', async () => {
    const { el, saved } = await openEditor('views', 'v1234567');
    expect(el.querySelector('.ar-dirty').textContent).toBe('');
    expect(el.textContent).toContain('Former agent');
    expect(el.textContent).toContain('Deleted organization');
    const title = el.querySelector('.ar-editor-body input');
    title.value = 'Bob and Acme (renamed)';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form.ar-editor').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(50);
    expect(saved[0][0].conditions.all.map((c) => c.value)).toEqual(['bob', 99, 'gone-group', 555]);
  });

  it('keep "Organization is none" as it is', async () => {
    app.replica = replica();
    const r = app.replica;
    r.cfg.views = [{ ...r.cfg.views[0], conditions: { all: [{ field: 'organization', op: 'is', value: '' }], any: [] } }];
    const saved = [];
    app.api = { put: async (path, body) => { saved.push(body.value); return { value: body.value }; }, desk: 'd' };
    const el = document.createElement('div');
    document.body.append(el);
    renderSection(el, { section: 'views', route: { path: ['admin', 'views', 'v1234567'], query: {} } });
    await tick(50);
    expect(el.querySelector('.ar-dirty').textContent).toBe('');
    expect(el.querySelector('.rb-row').textContent).toContain('No organization');
    const title = el.querySelector('.ar-editor-body input');
    title.value = 'No company';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form.ar-editor').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(50);
    expect(saved[0][0].conditions.all[0].value).toBe('');
  });

  it('name an inactive custom field and keep its options', async () => {
    app.replica = replica();
    const r = app.replica;
    r.cfg.fields = [{ id: 'plan', title: 'Plan', type: 'dropdown', active: false, options: [{ value: 'pro', label: 'Pro' }, { value: 'free', label: 'Free' }] }];
    r.cfg.views = [{ ...r.cfg.views[0], conditions: { all: [{ field: 'field:plan', op: 'is', value: 'pro' }], any: [] } }];
    app.api = { put: async (path, body) => ({ value: body.value }), desk: 'd' };
    const el = document.createElement('div');
    document.body.append(el);
    renderSection(el, { section: 'views', route: { path: ['admin', 'views', 'v1234567'], query: {} } });
    await tick(50);
    const row = el.querySelector('.rb-row');
    expect(row.textContent).toContain('Plan (inactive)');
    expect(row.textContent).toContain('Pro');
    expect(row.textContent).not.toContain('Deleted field');
    expect(el.querySelector('.ar-dirty').textContent).toBe('');
  });

  it('keep a macro\'s inactive assignee', async () => {
    const { el, saved } = await openEditor('macros', 'm1234567');
    el.querySelector('form.ar-editor').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(50);
    expect(saved[0][0].actions).toEqual([{ field: 'assignee', value: 'bob' }, { field: 'group', value: 'gone-group' }]);
  });
});
