// @vitest-environment jsdom
/**
 * Regression tests from a second review round of the view screens.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';

const TODAY = '2026-10-12';

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  Element.prototype.scrollIntoView ??= function () {};
  const D = globalThis.HTMLDialogElement?.prototype;
  if (D && !D.showModal) {
    D.showModal = function () {
      this.setAttribute('open', '');
    };
    D.close = function () {
      this.removeAttribute('open');
    };
  }
});

beforeEach(async () => {
  document.body.replaceChildren();
  location.hash = '';
  app.demo = true;
  app.user = null;
  app.team = null;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0 });
  await app.store.init();
});

async function inZone(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

describe('local dates', () => {
  it('shows the local day in the "Updated" meta line', async () => {
    await inZone('America/New_York', async () => {
      const { metaLine } = await import('../src/views/common.js');
      const { formatDate } = await import('../src/core/dates.js');
      // 9 pm on October 12 in New York is October 13 in UTC.
      const line = metaLine({ updatedAt: new Date(2026, 9, 12, 21, 0, 0).toISOString() });
      expect(line.textContent).toBe(`Updated ${formatDate('2026-10-12')}`);
    });
  });
});

function ctx(params = {}, query = {}) {
  return { params, query, route: { params, query }, watch() {}, onDispose() {}, live: (fn) => fn() };
}

async function mount(mod, params = {}, query = {}) {
  const out = (await mod).render(ctx(params, query));
  const node = out instanceof Node ? out : out.node;
  document.body.append(node);
  return { node, out };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const button = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));

describe('new bills screen', () => {
  it('leaves no gap in bill numbers when a matter turns out to have nothing to bill', async () => {
    const store = app.store;
    const { node } = await mount(import('../src/views/bill-generate.js'));
    const rows = [...node.querySelectorAll('.gen-table tbody tr')];
    expect(rows.length).toBeGreaterThan(1);
    const keep = rows[0].querySelector('a[href^="#/matters/"]').getAttribute('href').split('/').pop();
    // While the first bill is being numbered, another device bills every
    // other matter.
    const real = store.nextNumber;
    let raced = false;
    store.nextNumber = async (coll) => {
      if (!raced) {
        raced = true;
        for (const a of store.all('activities')) if (a.matterId !== keep && !a.billId) store.patch('activities', a.id, { billId: 'elsewhere' });
        for (const m of store.all('matters')) if (m.id !== keep && m.billing?.method === 'flat') store.patch('matters', m.id, { billing: { ...m.billing, flatFeeBilled: true } });
      }
      return real(coll);
    };
    const before = store.all('bills').length;
    button(node, /Generate \d+ draft/).click();
    for (let i = 0; i < 50 && store.all('bills').length === before; i++) await flush();
    await flush();
    const made = store.all('bills').slice(before);
    expect(made.length).toBe(1);
    expect(await real('bills')).toBe(made[0].number + 1);
  });
});

describe('event dialog', () => {
  it('keeps an event that ends at midnight running to the end of its day', async () => {
    const { openEventDialog } = await import('../src/views/dialogs.js');
    const done = openEventDialog({ date: TODAY });
    const form = document.querySelector('dialog form');
    form.querySelector('[name=title]').value = 'Late filing';
    form.querySelector('[name=start]').value = '22:00';
    form.querySelector('[name=end]').value = '00:00';
    form.requestSubmit();
    const ev = await done;
    expect(ev.start).toBe('22:00');
    expect(ev.end).toBe('23:59');
  });
});

describe('entries on a bill awaiting approval', () => {
  function pendingEntry() {
    const store = app.store;
    const b = store.all('bills').find((x) => x.status === 'draft' && x.lines.some((l) => l.activityId && l.kind === 'time'));
    store.patch('bills', b.id, { status: 'pending' });
    const line = b.lines.find((l) => l.activityId && l.kind === 'time');
    return { bill: store.get('bills', b.id), act: store.get('activities', line.activityId) };
  }

  it('updates the bill line when the entry is edited', async () => {
    const { bill, act } = pendingEntry();
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const done = openActivityDialog({ activity: act });
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).not.toMatch(/issued bill/);
    expect(dlg.textContent).toMatch(new RegExp(`bill #${bill.number}, which is awaiting approval`));
    dlg.querySelector('[name=duration]').value = '7';
    dlg.querySelector('form').requestSubmit();
    await done;
    const line = app.store.get('bills', bill.id).lines.find((l) => l.activityId === act.id);
    expect(line.minutes).toBe(420);
  });

  it('removes the bill line when the entry is deleted', async () => {
    const { bill, act } = pendingEntry();
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    openActivityDialog({ activity: act });
    const dlg = document.querySelector('dialog');
    button(dlg, /^Delete$/).click();
    await flush();
    const confirm = [...document.querySelectorAll('dialog')].pop();
    expect(confirm.textContent).toMatch(new RegExp(`bill #${bill.number}`));
    expect(confirm.textContent).not.toMatch(/issued bill/);
    button(confirm, /Delete entry/).click();
    await flush();
    expect(app.store.get('activities', act.id)).toBeFalsy();
    expect(app.store.get('bills', bill.id).lines.some((l) => l.activityId === act.id)).toBe(false);
  });
});

/** A view context whose watch() follows the store, like the real view host. */
function liveCtx(params = {}, query = {}) {
  const disposers = [];
  return {
    params,
    query,
    route: { params, query },
    live: (fn) => fn(),
    watch(colls, fn) {
      const set = new Set(colls);
      disposers.push(app.store.subscribe((changed) => [...changed].some((c) => set.has(c)) && fn(changed)));
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    dispose: () => disposers.forEach((d) => d()),
  };
}

describe('trust balances', () => {
  it('keeps typing in the search box when the data changes in the background', async () => {
    const { render } = await import('../src/views/accounts.js');
    const c = liveCtx();
    const out = render(c);
    document.body.append(out.node);
    const input = out.node.querySelector('input[aria-label="Search trust balances"]');
    input.focus();
    input.value = 'Ha';
    input.dispatchEvent(new Event('input'));
    // A sync lands before the search has run.
    const t = app.store.all('transactions')[0];
    app.store.patch('transactions', t.id, { memo: `${t.memo || ''} ` });
    await flush();
    const now = out.node.querySelector('input[aria-label="Search trust balances"]');
    expect(document.activeElement).toBe(input);
    expect(now).toBe(input);
    expect(now.value).toBe('Ha');
    c.dispose();
  });
});

/** Run fn and return the text of the CSV file it downloads. */
async function capturedCsv(fn) {
  const blobs = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (b) => (blobs.push(b), 'blob:x');
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    await fn();
  } finally {
    URL.createObjectURL = create;
    // downloadCsv revokes its URL a second later; jsdom has no revokeObjectURL to put back.
    URL.revokeObjectURL = revoke ?? (() => {});
    HTMLAnchorElement.prototype.click = click;
  }
  const text = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blobs[0]);
  });
  return text.replace(/^\uFEFF/, '');
}

describe('bills export', () => {
  it('writes status labels, not internal ids', async () => {
    const store = app.store;
    const b = store.all('bills').find((x) => x.status === 'issued');
    const { billTotals } = await import('../src/core/finance.js');
    store.put('payments', { billId: b.id, clientId: b.clientId, matterId: b.matterId, date: TODAY, amountCents: Math.floor(billTotals(b).total / 2), method: 'check' });
    const { node } = await mount(import('../src/views/billing.js'), {}, { status: 'all' });
    const csv = await capturedCsv(() => button(node, /^Export$/).click());
    const { parseCsv } = await import('../src/core/csv.js');
    const rows = parseCsv(csv);
    const col = rows[0].indexOf('Status');
    const statuses = new Set(rows.slice(1).map((r) => r[col]));
    expect(statuses.has('Partially paid')).toBe(true);
    expect(statuses.has('partial')).toBe(false);
    expect(statuses.has('issued')).toBe(false);
  });
});

describe('bills export numbers', () => {
  it('writes bill numbers as whole numbers', async () => {
    const { node } = await mount(import('../src/views/billing.js'), {}, { status: 'all' });
    const csv = await capturedCsv(() => button(node, /^Export$/).click());
    const { parseCsv } = await import('../src/core/csv.js');
    const rows = parseCsv(csv);
    const nums = new Set(app.store.all('bills').map((b) => String(b.number)));
    for (const r of rows.slice(1)) expect(nums.has(r[0])).toBe(true);
  });
});

describe('new bills period', () => {
  it('explains an empty list when the period starts after it ends', async () => {
    const { node } = await mount(import('../src/views/bill-generate.js'), {}, { from: '2026-10-12', to: '2026-09-01' });
    const empty = node.querySelector('.empty-state, .empty');
    expect(node.textContent).toMatch(/Nothing to bill/);
    expect(node.textContent).toMatch(/“Work from” date is after the “Work through” date/);
    expect(empty).toBeTruthy();
  });
});

describe('form section links', () => {
  async function scrollsWith(modPath, linkSel) {
    const mm = globalThis.matchMedia;
    const siv = Element.prototype.scrollIntoView;
    const calls = [];
    globalThis.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, removeEventListener() {} });
    Element.prototype.scrollIntoView = function (opts) {
      calls.push(opts);
    };
    try {
      const { node } = await mount(import(modPath));
      node.querySelector(linkSel).click();
    } finally {
      globalThis.matchMedia = mm;
      Element.prototype.scrollIntoView = siv;
    }
    return calls;
  }

  it('jumps without animation on the contact form when reduced motion is preferred', async () => {
    const calls = await scrollsWith('../src/views/contact-form.js', '.form-index-link');
    expect(calls.length).toBe(1);
    expect(calls[0].behavior).not.toBe('smooth');
  });

  it('jumps without animation on the matter form when reduced motion is preferred', async () => {
    const calls = await scrollsWith('../src/views/matter-form.js', '.form-index a');
    expect(calls.length).toBe(1);
    expect(calls[0].behavior).not.toBe('smooth');
  });
});

describe('event attendees', () => {
  it('keeps an inactive attendee when the event is saved', async () => {
    const store = app.store;
    const [a, b] = store.all('users');
    store.patch('users', b.id, { active: false });
    const ev = store.put('events', { title: 'Mediation', kind: 'meeting', date: TODAY, start: '10:00', end: '11:00', attendeeIds: [a.id, b.id] });
    const { openEventDialog } = await import('../src/views/dialogs.js');
    const done = openEventDialog({ event: ev });
    const dlg = document.querySelector('dialog');
    expect(dlg.querySelector('fieldset').textContent).toMatch(`${b.name} (inactive)`);
    dlg.querySelector('[name=location]').value = 'Room 4';
    dlg.querySelector('form').requestSubmit();
    const saved = await done;
    expect(saved.location).toBe('Room 4');
    expect(saved.attendeeIds).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe('task lists', () => {
  it('assigns a deactivated role holder’s tasks to the responsible lawyer', async () => {
    const store = app.store;
    const [resp, staff] = store.all('users');
    const m = store.all('matters').find((x) => x.status === 'open');
    store.patch('matters', m.id, { responsibleId: resp.id, staffId: staff.id });
    store.patch('users', staff.id, { active: false });
    const list = store.put('taskLists', { name: 'Intake', items: [{ name: 'Collect documents', assignee: 'staff', dueOffset: 3 }] });
    const { applyTaskList } = await import('../src/views/tasks.js');
    const done = applyTaskList({ matterId: m.id });
    const dlg = [...document.querySelectorAll('dialog')].pop();
    dlg.querySelector('[name=listId]').value = list.id;
    dlg.querySelector('form').requestSubmit();
    const tasks = await done;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(resp.id);
  });
});

describe('task list assignees', () => {
  it('leaves a task unassigned when neither its role holder nor the responsible lawyer is active', async () => {
    const { tasksFromList } = await import('../src/core/matters.js');
    const list = { id: 'l', items: [{ name: 'A', assignee: 'originating' }, { name: 'B', assignee: 'staff' }] };
    const tasks = tasksFromList(list, { id: 'm', responsibleId: 'u-gone', originatingId: 'u-gone2', staffId: 'u-here' }, TODAY, (id) => id === 'u-here');
    expect(tasks.map((t) => t.assigneeId)).toEqual([null, 'u-here']);
  });
});

describe('deleting a former client', () => {
  /** A contact with bills who is no longer the client on any matter. */
  function formerClient() {
    const store = app.store;
    const b = store.all('bills').find((x) => x.clientId);
    const c = store.get('contacts', b.clientId);
    const other = store.all('contacts').find((x) => x.id !== c.id && x.type === 'company');
    for (const m of store.all('matters')) if (m.clientId === c.id) store.patch('matters', m.id, { clientId: other.id });
    return c;
  }
  const confirmIfAsked = async () => {
    await flush();
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    if (dlg) button(dlg, /^Delete( contact)?$/)?.click();
    await flush();
  };

  it('refuses from the contact page while bills or payments point at the contact', async () => {
    const c = formerClient();
    const { node } = await mount(import('../src/views/contact-detail.js'), { id: c.id });
    node.querySelector('[aria-label="More actions"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete contact')).click();
    await confirmIfAsked();
    expect(app.store.get('contacts', c.id)).toBeTruthy();
    expect(document.querySelector('.toast').textContent).toMatch(/bills/);
  });

  it('keeps such contacts when several are deleted from the list', async () => {
    const c = formerClient();
    const { node } = await mount(import('../src/views/contacts.js'));
    const search = node.querySelector('input[type=search]');
    search.value = c.companyName || c.lastName;
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    const row = [...node.querySelectorAll('tbody tr:not(.dt-spacer)')].find((tr) => tr.querySelector(`a[href="#/contacts/${c.id}"]`));
    const cb = row.querySelector('td.dt-check input');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    button(node.querySelector('.bulk-bar'), /^Delete$/).click();
    await confirmIfAsked();
    expect(app.store.get('contacts', c.id)).toBeTruthy();
  });
});

describe('dashboard billing tiles', () => {
  it('describes and links bills awaiting approval when it counts them', async () => {
    const store = app.store;
    for (const b of store.all('bills')) if (b.status === 'draft') store.patch('bills', b.id, { status: 'pending' });
    const { node } = await mount(import('../src/views/dashboard.js'));
    const pending = store.all('bills').filter((b) => b.status === 'pending').length;
    expect(pending).toBeGreaterThan(0);
    const tile = [...node.querySelectorAll('a.stat')].find((a) => /bill/i.test(a.querySelector('.stat-label').textContent) || /status=(draft|pending)/.test(a.getAttribute('href')));
    // Counted bills are all awaiting approval, so the tile must say so and open them.
    expect(tile.textContent).toMatch(/pending approval/i);
    expect(tile.getAttribute('href')).toBe('#/billing?status=pending');
  });
});

describe('issuing a held draft', () => {
  async function generated() {
    const store = app.store;
    const before = new Set(store.all('bills').map((b) => b.id));
    const { node } = await mount(import('../src/views/bill-generate.js'));
    const rows = [...node.querySelectorAll('.gen-table tbody tr')];
    for (const tr of rows.slice(1)) {
      const cb = tr.querySelector('input[type=checkbox]');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    }
    button(node, /Generate 1 draft/).click();
    for (let i = 0; i < 50 && store.all('bills').length === before.size; i++) await flush();
    document.body.replaceChildren();
    return store.all('bills').find((b) => !before.has(b.id));
  }

  it('dates a generated draft as of the day it is issued, keeping its terms', async () => {
    const b = await generated();
    expect(b.issueDate).toBe(TODAY);
    const terms = (new Date(b.dueDate) - new Date(b.issueDate)) / 86400000;
    app.today = () => '2026-11-20';
    const { issueBills } = await import('../src/views/billing-actions.js');
    issueBills([b]);
    const out = app.store.get('bills', b.id);
    expect(out.status).toBe('issued');
    expect(out.issueDate).toBe('2026-11-20');
    expect((new Date(out.dueDate) - new Date(out.issueDate)) / 86400000).toBe(terms);
  });

  it('keeps an issue date the user set on the draft', async () => {
    const b = await generated();
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: b.id });
    button(node, /^Edit$/).click();
    const issue = [...document.querySelectorAll('input[type=date][required]')].find((i) => i.value === b.issueDate);
    issue.value = '2026-10-01';
    issue.dispatchEvent(new Event('change'));
    button(document.body, /Save changes/).click();
    app.today = () => '2026-11-20';
    const { approveBills } = await import('../src/views/billing-actions.js');
    approveBills([app.store.get('bills', b.id)]);
    approveBills([app.store.get('bills', b.id)]);
    const out = app.store.get('bills', b.id);
    expect(out.status).toBe('issued');
    expect(out.issueDate).toBe('2026-10-01');
    expect(out.dueDate).toBe(b.dueDate);
  });
});
