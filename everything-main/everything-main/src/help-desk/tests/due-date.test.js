/** A task's due date, far from UTC (here UTC+14). */
process.env.TZ = 'Pacific/Kiritimati';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for the UI');
    await tick(20);
  }
}

let app;
let unmount;
const root = document.createElement('div');

beforeAll(async () => {
  localStorage.clear();
  await import('../dev/mock-puter.js');
  ({ app } = await import('../src/app.js'));
  const { mountShell } = await import('../src/views/shell.js');
  const { currentUser } = await import('../src/client/puter.js');
  document.body.append(root);
  app.user = await currentUser();
  await app.loadDoc();
  const desk = await app.createDesk({ name: 'Due Desk', agentName: 'Olivia Owner' });
  await app.openDesk('local', desk);
  location.hash = '#/home';
  unmount = mountShell(root);
  await tick(50);
});

afterAll(() => {
  unmount?.();
  app.replica?.close();
});

describe('due date', () => {
  it('shows the day that was chosen', async () => {
    const res = await app.api.post('/tickets', { subject: 'Renew the certificate', type: 'task', requester: { email: 'ops@example.com', name: 'Ops' }, comment: { html: '<p>Before it expires</p>', public: true } });
    app.replica.upsert('t', res.ticket);
    location.hash = `#/tickets/${res.ticket.id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const input = await until(() => root.querySelector('.t-props input[type="date"]'));
    input.value = '2026-10-20';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.t-props input[type="date"]').value).toBe('2026-10-20');
  });
});
