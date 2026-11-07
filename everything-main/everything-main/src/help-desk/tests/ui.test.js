/**
 * End-to-end style tests of the agent workspace in jsdom: the real app,
 * backend and replica over the dev mock of the Puter SDK.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axe from 'axe-core';

let app;
let mountShell;
let unmount;
let desk;
const root = document.createElement('div');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for the UI');
    await tick(20);
  }
}

async function go(hash) {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick(30);
}

beforeAll(async () => {
  localStorage.clear();
  await import('../dev/mock-puter.js');
  ({ app } = await import('../src/app.js'));
  ({ mountShell } = await import('../src/views/shell.js'));
  const { currentUser } = await import('../src/client/puter.js');
  document.body.append(root);
  app.user = await currentUser();
  await app.loadDoc();
  desk = await app.createDesk({ name: 'Test Desk', agentName: 'Olivia Owner' });
  await app.openDesk('local', desk);
  // A couple of tickets to work with.
  for (const [subject, email] of [['Printer on fire', 'ann@example.com'], ['Refund please', 'bob@example.com']]) {
    const res = await app.api.post('/tickets', { subject, requester: { email, name: email.split('@')[0] }, comment: { html: `<p>${subject}</p>`, public: true } });
    app.replica.upsert('t', res.ticket);
    app.replica.upsert('u', res.requester);
  }
  location.hash = '#/home';
  unmount = mountShell(root);
  await tick(50);
});

afterAll(() => {
  unmount?.();
  app.replica?.close();
});

describe('agent workspace', () => {
  it('renders the shell with navigation and the desk name', async () => {
    await until(() => root.querySelector('.desk-switch'));
    expect(root.querySelector('.desk-switch').textContent).toContain('Test Desk');
    const labels = [...root.querySelectorAll('.rail-item')].map((a) => a.getAttribute('aria-label'));
    expect(labels).toContain('Views');
    expect(labels).toContain('Source code on GitHub (opens in a new tab)');
    expect(root.querySelector('.rail-github').getAttribute('href')).toBe('https://github.com/heyputer/everything');
  });

  it('lists tickets in a view with counts', async () => {
    await go('#/views/sys-unsolved');
    await until(() => root.querySelectorAll('tbody tr[data-id]').length === 2);
    const link = [...root.querySelectorAll('.side-link')].find((a) => a.textContent.includes('All unsolved'));
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.querySelector('.count').textContent).toBe('2');
  });

  it('opens a ticket in a tab and replies with a status change', async () => {
    const t = [...app.replica.tickets.values()].find((x) => x.subject === 'Printer on fire');
    await go(`#/tickets/${t.id}`);
    await until(() => root.querySelector('.ev-comment'));
    expect(root.querySelector('.t-subject').textContent).toBe('Printer on fire');
    expect([...root.querySelectorAll('.tab-title')].map((x) => x.textContent)).toContain('Printer on fire');
    const editor = root.querySelector('.editor-content');
    editor.innerHTML = '<p>Please unplug it.</p>';
    editor.dispatchEvent(new Event('input'));
    root.querySelector('.submit-more').click();
    const pending = await until(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Pending')));
    pending.click();
    await until(() => app.replica.tickets.get(t.id).status === 'pending');
    const full = await app.api.get(`/tickets/${t.id}`);
    const reply = full.events.find((e) => e.kind === 'comment' && e.html.includes('unplug'));
    expect(reply.public).toBe(true);
  });

  it('records internal notes as private', async () => {
    const t = [...app.replica.tickets.values()].find((x) => x.subject === 'Refund please');
    await go(`#/tickets/${t.id}`);
    await until(() => root.querySelector('.ev-comment'));
    root.querySelector('.mode-btn').click();
    const note = await until(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Internal note')));
    note.click();
    expect(root.querySelector('.t-composer').classList.contains('internal')).toBe(true);
    const editor = root.querySelector('.editor-content');
    editor.innerHTML = '<p>Checking with finance</p>';
    editor.dispatchEvent(new Event('input'));
    root.querySelector('.submit-main').click();
    await until(() => root.querySelector('.ev-internal'));
    const full = await app.api.get(`/tickets/${t.id}`);
    expect(full.events.find((e) => e.html?.includes('finance')).public).toBe(false);
  });

  it('applies a macro to the pending changes and the reply', async () => {
    const t = [...app.replica.tickets.values()].find((x) => x.subject === 'Refund please');
    await go(`#/tickets/${t.id}`);
    await until(() => root.querySelector('.macro-btn'));
    root.querySelector('.macro-btn').click();
    const option = await until(() => [...document.querySelectorAll('.picker-option')].find((o) => o.textContent.includes('Ask for more details')));
    option.click();
    expect(root.querySelector('.editor-content').textContent).toContain('Could you share a few more details');
    expect(root.querySelector('.submit-main').textContent).toContain('Pending');
  });

  it('has no serious accessibility violations on the views page', async () => {
    await go('#/views/sys-unsolved');
    await until(() => root.querySelectorAll('tbody tr[data-id]').length > 0);
    const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
