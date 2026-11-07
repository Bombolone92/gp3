import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Spied on, with its usual behavior, to see what is read out to screen readers.
vi.mock('../src/ui/dom.js', async (original) => {
  const dom = await original();
  return { ...dom, announce: vi.fn(dom.announce) };
});
import {
  conditionFields, opsFor, valueKind, defaultCondition, reconcileCondition, actionFields, defaultAction,
  describeCondition, describeConditions, describeTrigger, validateMacro, validateView, validateTrigger,
  validateField, optionValue, move, duplicateTitle, splitMinutes, joinMinutes, formatMinutes,
} from '../src/views/rules-logic.js';
import { validateConfig } from '../src/server/config.js';
import { matches } from '../src/shared/rules.js';
import { app } from '../src/app.js';

const plan = { id: 'plan', title: 'Plan', type: 'dropdown', options: [{ value: 'pro', label: 'Pro' }, { value: 'free', label: 'Free' }] };

describe('rule building blocks', () => {
  it('offers trigger-only fields and operators to triggers only', () => {
    const view = conditionFields('view').map((f) => f.value);
    const trigger = conditionFields('trigger').map((f) => f.value);
    expect(view).not.toContain('actor');
    expect(view).not.toContain('comment');
    expect(trigger).toContain('actor');
    expect(opsFor('status', 'view')).not.toContain('changed_to');
    expect(opsFor('status', 'trigger')).toContain('changed_to');
    expect(conditionFields('view', [plan]).at(-1)).toMatchObject({ value: 'field:plan', label: 'Plan' });
  });

  it('picks a value control and a valid default for each field', () => {
    expect(valueKind('created', 'less_than')).toBe('hours');
    expect(valueKind('followers', 'includes_me')).toBe('none');
    expect(valueKind('field:plan', 'is', [plan])).toBe('field-option');
    expect(valueKind('field:plan', 'present', [plan])).toBe('none');
    expect(defaultCondition('field:plan', 'view', [plan])).toEqual({ field: 'field:plan', op: 'is', value: 'pro' });
    expect(defaultCondition('assignee')).toEqual({ field: 'assignee', op: 'is', value: 'me' });
  });

  it('resets the value when the field or operator changes its kind', () => {
    const c = reconcileCondition({ field: 'created', op: 'is', value: 'open' }, 'view');
    expect(c.op).toBe('less_than');
    expect(c.value).toBe(24);
    const kept = reconcileCondition({ field: 'status', op: 'is_not', value: 'pending' }, 'view');
    expect(kept.value).toBe('pending');
  });

  it('only lets triggers send email', () => {
    expect(actionFields('macro').map((a) => a.value)).not.toContain('notify_requester');
    expect(actionFields('trigger').map((a) => a.value)).toContain('notify_email');
    expect(defaultAction('notify_requester').body).toContain('{{comment.text}}');
  });

  it('produces conditions the matcher understands', () => {
    const conds = { all: [defaultCondition('status', 'view'), { field: 'tags', op: 'includes', value: 'vip billing' }], any: [] };
    conds.all[0] = { field: 'status', op: 'less_than', value: 'solved' };
    expect(matches(conds, { status: 'open', tags: ['billing'] }, { now: Date.now() })).toBe(true);
    expect(matches(conds, { status: 'solved', tags: ['billing'] }, { now: Date.now() })).toBe(false);
  });

  it('describes rules in plain language', () => {
    const names = { agent: () => 'Ana', group: () => 'Billing' };
    expect(describeCondition({ field: 'status', op: 'is', value: 'pending' })).toBe('Status is Pending');
    expect(describeCondition({ field: 'assignee', op: 'is', value: '' }, names)).toBe('Assignee is no one');
    expect(describeCondition({ field: 'created', op: 'greater_than', value: 48 })).toBe('Created more than 48 hours ago');
    expect(describeConditions({ all: [], any: [] })).toBe('Every ticket');
    const text = describeTrigger({
      event: 'created',
      conditions: { all: [{ field: 'actor', op: 'is', value: 'customer' }], any: [] },
      actions: [{ field: 'group', value: 'billing' }, { field: 'notify_requester', subject: 's', body: 'b' }],
    }, names);
    expect(text).toBe('When a ticket is created, if the change is made by the customer, then move to Billing, email the requester.');
    expect(text).not.toMatch(/\u2014/);
  });
});

describe('client validation', () => {
  it('checks macros, views and triggers before saving', () => {
    expect(validateMacro({ title: '', actions: [] })).toMatch(/title/);
    expect(validateMacro({ title: 'x', actions: [] })).toMatch(/action or a comment/);
    expect(validateMacro({ title: 'x', actions: [], comment: { html: '<p>hi</p>' } })).toBeNull();
    expect(validateView({ title: 'v', conditions: { all: [], any: [] }, columns: ['status'] })).toMatch(/condition/);
    expect(validateView({ title: 'v', conditions: { all: [{ field: 'tags', op: 'includes', value: '' }], any: [] }, columns: ['status'] })).toMatch(/value/);
    expect(validateTrigger({ title: 't', conditions: { all: [{ field: 'actor', op: 'is', value: 'agent' }], any: [] }, actions: [{ field: 'notify_email', to: 'nope', subject: 's', body: 'b' }] })).toMatch(/valid email/);
    expect(validateTrigger({ title: 't', conditions: { all: [{ field: 'actor', op: 'is', value: 'agent' }], any: [] }, actions: [{ field: 'notify_email', to: 'team@example.com', subject: 's', body: 'b' }] })).toBeNull();
  });

  it('asks for a customer in a requester condition', () => {
    const v = (value) => ({ title: 'v', conditions: { all: [{ field: 'requester', op: 'is', value }], any: [] }, columns: ['status'] });
    expect(validateView(v(''))).toMatch(/customer/);
    expect(validateView(v(7))).toBeNull();
  });

  it('refuses an empty number of hours, which would match all tickets or none', () => {
    const hours = (value) => ({ title: 'v', conditions: { all: [{ field: 'created', op: 'greater_than', value }], any: [] }, columns: ['status'] });
    expect(validateView(hours(''))).toMatch(/hours/);
    expect(validateView(hours(null))).toMatch(/hours/);
    expect(validateView(hours('0'))).toBeNull();
    const fresh = { id: 1, status: 'open', createdAt: Date.now() - 1000, tags: [] };
    expect(matches({ all: [{ field: 'created', op: 'greater_than', value: '' }], any: [] }, fresh, {})).toBe(false);
  });

  it('checks fields and derives option values', () => {
    expect(optionValue('Pro Plan')).toBe('pro_plan');
    expect(validateField({ id: 'a', title: 'Plan', type: 'dropdown', options: [] }, [])).toMatch(/option/);
    expect(validateField({ id: 'a', title: 'Plan', type: 'dropdown', options: [{ label: 'A b' }, { label: 'a B' }] }, [])).toMatch(/same name/);
    expect(validateField({ id: 'a', title: 'plan', type: 'text' }, [{ id: 'b', title: 'Plan' }])).toMatch(/already/);
    expect(validateField({ id: 'a', title: 'Mood', type: 'dropdown', options: [{ label: 'Happy' }, { label: '👍' }] }, [])).toMatch(/letter or number/);
    expect(validateField({ id: 'a', title: 'Mood', type: 'dropdown', options: [{ label: '👍 Good' }, { label: '👎 Bad' }] }, [])).toBeNull();
  });

  it('builds data the server accepts unchanged', () => {
    const trigger = {
      id: 'abcd1234', title: 'Escalate', active: true, event: 'any',
      conditions: { all: [{ field: 'priority', op: 'is', value: 'urgent' }, { field: 'field:plan', op: 'is', value: 'pro' }], any: [] },
      actions: [{ field: 'group', value: 'support' }, { field: 'notify_email', to: 'team@example.com', subject: 'Hi', body: 'Body' }],
    };
    expect(validateConfig('triggers', [trigger])).toEqual([trigger]);
    const view = { id: 'v1234567', title: 'Mine', active: true, conditions: { all: [{ field: 'created', op: 'less_than', value: 24 }], any: [] }, columns: ['status', 'subject'], sort: { field: 'createdAt', dir: 'asc' }, groupBy: 'status' };
    expect(validateConfig('views', [view])).toEqual([view]);
  });

  it('keeps every column the view editor offers', async () => {
    const { COLUMNS } = await import('../src/views/ticket-table.js');
    const columns = Object.keys(COLUMNS);
    const view = { id: 'v1234567', title: 'Wide', active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns, sort: { field: 'updatedAt', dir: 'desc' }, groupBy: null };
    expect(validateConfig('views', [view])[0].columns).toEqual(columns);
  });
});

describe('placeholders', () => {
  it('leave names that are not placeholders as typed', async () => {
    const { renderPlaceholders } = await import('../src/shared/rules.js');
    expect(renderPlaceholders('{{constructor}} {{__proto__}} {{toString}} {{requester.first_name}}', { requester: { name: 'Ann Lee' } }))
      .toBe('{{constructor}} {{__proto__}} {{toString}} Ann');
  });
});

describe('small helpers', () => {
  it('moves, names copies and converts minutes', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(duplicateTitle('A', [{ title: 'A' }, { title: 'A (copy)' }])).toBe('A (copy 2)');
    expect(splitMinutes(135)).toEqual({ h: 2, m: 15 });
    expect(joinMinutes('2', '15')).toBe(135);
    expect(joinMinutes('', '')).toBeNull();
    expect(formatMinutes(72 * 60)).toBe('3 days');
    expect(formatMinutes(90)).toBe('1h 30m');
  });
});

describe('rule sections render', () => {
  let saved;
  beforeEach(() => {
    saved = [];
    const listeners = new Set();
    app.replica = {
      cfg: {
        macros: [{ id: 'm1234567', title: 'Close and thank', active: true, actions: [{ field: 'status', value: 'solved' }], comment: { html: '<p>Hi {{requester.first_name}}</p>', public: true } }],
        views: [],
        triggers: [{ id: 't1234567', title: 'Notify', active: true, event: 'created', conditions: { all: [{ field: 'actor', op: 'is', value: 'customer' }], any: [] }, actions: [{ field: 'notify_requester', subject: 's', body: 'b' }] }],
        fields: [plan],
        groups: [{ id: 'support', name: 'Support' }],
        sla: null,
      },
      members: { u1: { uuid: 'u1', name: 'Olivia', role: 'owner', active: true, groups: ['support'] } },
      me: { uuid: 'u1', name: 'Olivia', role: 'owner', groups: ['support'] },
      meta: { name: 'Acme' },
      tickets: new Map([[1, { id: 1, subject: 'Help', status: 'open', priority: 'urgent', requester: 7, tags: [], updatedAt: Date.now(), createdAt: Date.now() }]]),
      users: new Map([[7, { id: 7, name: 'Carla Customer' }]]),
      orgs: new Map(),
      agents() { return Object.values(this.members); },
      isAdmin() { return true; },
      setConfig(kind, value) {
        this.cfg = { ...this.cfg, [kind]: value };
        for (const fn of listeners) fn({ detail: { kinds: new Set(['c']) } });
      },
      addEventListener: (t, fn) => listeners.add(fn),
      removeEventListener: (t, fn) => listeners.delete(fn),
    };
    app.api = { put: async (path, body) => { saved.push([path, body.value]); return { value: body.value }; }, desk: 'd' };
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function render(section, path = ['admin', section]) {
    const { renderSection } = await import('../src/views/admin-rules.js');
    const el = document.createElement('div');
    document.body.append(el);
    const cleanup = renderSection(el, { section, route: { path, query: {} } });
    return { el, cleanup };
  }

  it('lists macros and saves an active toggle', async () => {
    const { el, cleanup } = await render('macros');
    expect(el.textContent).toContain('Close and thank');
    expect(el.textContent).toContain('Set status to Solved');
    el.querySelector('input[role="switch"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved[0][0]).toBe('/cfg/macros');
    expect(saved[0][1][0].active).toBe(false);
    cleanup();
  });

  it('keeps every quick toggle and move while earlier saves are still out', async () => {
    app.replica.cfg.views = [
      { id: 'va123456', title: 'A', active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns: ['status'] },
      { id: 'vb123456', title: 'B', active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns: ['status'] },
      { id: 'vc123456', title: 'C', active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns: ['status'] },
    ];
    app.api.put = async (path, body) => {
      await new Promise((r) => setTimeout(r, 30));
      saved.push([path, body.value]);
      return { value: body.value };
    };
    const { el, cleanup } = await render('views');
    const switches = [...el.querySelectorAll('.ar-item input[role="switch"]')];
    switches[0].click();
    switches[1].click();
    el.querySelector('[aria-label="Move C up"]').click();
    el.querySelector('[aria-label="Move C up"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const last = saved.at(-1)[1];
    expect(last.map((v) => [v.title, v.active])).toEqual([['C', true], ['A', false], ['B', false]]);
    cleanup();
  });

  it('opens a view editor with a live match count and adds a condition with focus', async () => {
    const { el } = await render('views', ['admin', 'views', 'new']);
    expect(el.querySelector('.ar-editor')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200));
    expect(el.querySelector('.ar-live').textContent).toMatch(/1 ticket match/);
    const before = el.querySelectorAll('.rb-all .rb-row').length;
    el.querySelector('.rb-all .rb-add').click();
    expect(el.querySelectorAll('.rb-all .rb-row').length).toBe(before + 1);
    expect(document.activeElement.dataset.focus).toBe(`all-${before}-field`);
    el.querySelector(`[data-focus="all-${before}-remove"]`).click();
    expect(el.querySelectorAll('.rb-all .rb-row').length).toBe(before);
  });

  it('renders triggers in order with plain-language summaries', async () => {
    const { el } = await render('triggers');
    expect(el.querySelector('.ar-order').textContent).toBe('1');
    expect(el.textContent).toContain('if the change is made by the customer, then email the requester');
  });

  it('labels every builder control', async () => {
    const { el } = await render('triggers', ['admin', 'triggers', 't1234567']);
    for (const btn of el.querySelectorAll('.rb-row .select-btn')) {
      const ids = (btn.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean);
      expect(ids.length).toBe(2);
      expect(document.getElementById(ids[0]).textContent).not.toBe('');
    }
    for (const input of el.querySelectorAll('.rb-row input, .rb-row textarea')) {
      expect(el.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    }
  });

  it('edits service level targets in hours and minutes', async () => {
    const { el } = await render('sla');
    const first = el.querySelector('.ar-sla-table tbody tr input');
    first.value = '2';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(saved[0][0]).toBe('/cfg/sla');
    expect(saved[0][1].targets.urgent.first).toBe(120);
  });

  it('asks before leaving unsaved service level targets', async () => {
    const { confirmLeave } = await import('../src/ui/router.js');
    const { el, cleanup } = await render('sla');
    const first = el.querySelector('.ar-sla-table tbody tr input');
    first.value = '3';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    const leaving = confirmLeave();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg?.textContent).toContain('Discard your changes?');
    [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Keep editing').click();
    expect(await leaving).toBe(false);
    cleanup();
    expect(await confirmLeave()).toBe(true);
  });

  it('shows tracking as on after resetting to the defaults', async () => {
    app.replica.cfg.sla = { enabled: false, targets: {} };
    const { el } = await render('sla');
    const sw = el.querySelector('input[role="switch"]');
    expect(sw.checked).toBe(false);
    [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Reset to defaults')).click();
    expect(sw.checked).toBe(true);
    expect(el.querySelector('.ar-sla-wrap').classList.contains('off')).toBe(false);
  });

  it('says which rules still use a field before it is deleted', async () => {
    app.replica.cfg.views = [{ id: 'v1234567', title: 'Pro', active: true, conditions: { all: [{ field: `field:${plan.id}`, op: 'is', value: 'pro' }], any: [] }, columns: ['status'] }];
    const { el } = await render('fields');
    el.querySelector(`[aria-label="Actions for ${plan.title}"]`).click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete')).click();
    await new Promise((r) => setTimeout(r, 0));
    const text = document.querySelector('dialog[open]').textContent;
    expect(text).toContain('1 view still uses this field');
    expect(text).not.toContain('stop matching');
  });

  it('keeps keyboard focus on a moved option or view', async () => {
    const { el } = await render('fields', ['admin', 'fields', 'plan']);
    const up = el.querySelector('[aria-label="Move option 2 up"]');
    up.focus();
    up.click();
    expect(document.activeElement.getAttribute('aria-label')).toBe('Move option 1 down');
    el.remove();
    app.replica.cfg.views = ['A', 'B'].map((t) => ({ id: `v${t}123456`, title: t, active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns: ['status'] }));
    const list = (await render('views')).el;
    const moveB = list.querySelector('[aria-label="Move B up"]');
    moveB.focus();
    moveB.click();
    await new Promise((r) => setTimeout(r, 250));
    expect(document.activeElement.getAttribute('aria-label')).toBe('Move B down');
  });

  it('announces a validation error once, through its alert', async () => {
    const { el } = await render('macros', ['admin', 'macros', 'new']);
    el.querySelector('form.ar-editor').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    const alert = el.querySelector('.ar-error[role="alert"]');
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toMatch(/title/);
    const { announce } = await import('../src/ui/dom.js');
    expect(announce.mock.calls.filter(([message]) => alert.textContent.includes(message))).toEqual([]);
  });

  it('shows field editors with option rows', async () => {
    const { el } = await render('fields', ['admin', 'fields', 'plan']);
    expect(el.querySelectorAll('.ar-opt').length).toBe(2);
    expect(el.querySelectorAll('.ar-type').length).toBe(1);
  });
});
