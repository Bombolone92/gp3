import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { notifications } from '../src/views/notifications.js';

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
  app.ref = 'local/desk1';
  Object.defineProperty(app, 'me', { value: { uuid: 'me', username: 'al', name: 'Al Agent' }, configurable: true });
  app.memberName = () => 'Bo';
  app.userName = () => 'Customer';
});

describe('notifications', () => {
  it('toggles one panel from the bell', () => {
    const bell = notifications.button();
    document.body.append(bell);
    bell.click();
    expect(document.querySelectorAll('.notif-panel').length).toBe(1);
    bell.click();
    expect(document.querySelectorAll('.notif-panel').length).toBe(0);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    bell.click();
    expect(document.querySelectorAll('.notif-panel').length).toBe(1);
    bell.click();
  });

  it('stays in step with other tabs of the same desk', () => {
    const key = 'help-desk:notifications:local/desk1';
    const replica = new EventTarget();
    notifications.attach(replica);
    const bell = notifications.button();
    // This tab learned of #1; another tab then marked it read.
    replica.dispatchEvent(new CustomEvent('activity', { detail: { change: { r: 1, at: 10, ev: { by: 'bo', assigned: 'me' } }, ticket: { id: 1, subject: 'One' } } }));
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
    localStorage.setItem(key, JSON.stringify([{ id: '1', kind: 'assigned', text: 'x', ticket: 1, at: 10, read: true }]));
    window.dispatchEvent(new StorageEvent('storage', { key }));
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
    // A new notification here does not bring the read one back.
    replica.dispatchEvent(new CustomEvent('activity', { detail: { change: { r: 2, at: 20, ev: { by: 'bo', assigned: 'me' } }, ticket: { id: 2, subject: 'Two' } } }));
    const stored = JSON.parse(localStorage.getItem(key));
    expect(stored.map((n) => [n.id, n.read])).toEqual([['2', false], ['1', true]]);
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });
});

describe('mentions', () => {
  it('match whole handles only', async () => {
    const { mentions } = await import('../src/views/notifications.js');
    const me = { username: 'al', name: 'Al Agent' };
    expect(mentions('Can @al take a look?', me)).toBe(true);
    expect(mentions('Thanks @al.', me)).toBe(true);
    expect(mentions('@AL, see above', me)).toBe(true);
    expect(mentions('Ask @alice about it', me)).toBe(false);
    expect(mentions('cc @al.b', me)).toBe(false);
    expect(mentions('email al@example.com', me)).toBe(false);
    expect(mentions('ping @a.l', { username: 'a.l', name: '' })).toBe(true);
    expect(mentions('ping @axl', { username: 'a.l', name: '' })).toBe(false);
  });
});

describe('mentions in long notes', () => {
  it('notify wherever the mention is in the note', async () => {
    const { makeBackend, makeDesk, OWNER, AGENT } = await import('./helpers.js');
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const { rev } = await t.ok(AGENT, 'GET', `${P}/sync?since=0`);
    await t.ok(OWNER, 'POST', `${P}/tickets/${ticket.id}`, { comment: { html: `<p>${'Checked the logs again. '.repeat(10)}</p><p>@al can you take a look? Not @alice.</p>`, public: false } });
    const { changes } = await t.ok(AGENT, 'GET', `${P}/sync?since=${rev}`);
    const change = changes.find((c) => c.k === 't' && c.ev?.comment);
    expect(change.ev.comment.mentions).toEqual(['al', 'alice']);
    const replica = new EventTarget();
    notifications.attach(replica);
    const bell = notifications.button();
    replica.dispatchEvent(new CustomEvent('activity', { detail: { change: { ...change, at: 50 }, ticket: change.v } }));
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('read handles the way the preview check does', async () => {
    const { mentionsIn } = await import('../src/server/tickets.js');
    expect(mentionsIn('Thanks @al. Ask @Alice, cc @al.b and al@example.com')).toEqual(['al', 'alice', 'al.b', 'example.com']);
    expect(mentionsIn("@अमित please check, and @D'Arcy too. Also @J.R.")).toEqual(['अमित', "d'arcy", 'j.r']);
  });
});

describe('suspended tickets', () => {
  it('do not notify anyone', () => {
    const replica = new EventTarget();
    notifications.attach(replica);
    const bell = notifications.button();
    const before = bell.getAttribute('aria-label');
    replica.dispatchEvent(new CustomEvent('activity', { detail: { change: { r: 90, at: 1000, ev: { by: 'bo', assigned: 'me' } }, ticket: { id: 9, subject: 'Spam', spam: true, createdAt: 999, assignee: 'me' } } }));
    expect(bell.getAttribute('aria-label')).toBe(before);
  });
});
