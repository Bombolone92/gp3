// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ticketNumberFrom, cleanSubject, stripQuoted } from '../src/server/email.js';
import { makeBackend, makeDesk, OWNER, AGENT } from './helpers.js';

describe('email parsing', () => {
  it('finds the request number in notification subjects', () => {
    expect(ticketNumberFrom('Re: [Acme] Printer [#42]')).toBe(42);
    expect(ticketNumberFrom('Request #7 update')).toBe(7);
    expect(ticketNumberFrom('Hello')).toBe(null);
  });

  it('cleans reply prefixes and tags from subjects', () => {
    expect(cleanSubject('RE: Fwd: Printer on fire [#42]')).toBe('Printer on fire');
    expect(cleanSubject('')).toBe('(no subject)');
  });

  it('drops quoted history under a reply', () => {
    const text = 'Thanks, that worked.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Support <x@y.z> wrote:\n> Try again\n> please';
    expect(stripQuoted(text)).toBe('Thanks, that worked.');
    expect(stripQuoted('Fine\n> quoted')).toBe('Fine');
    expect(stripQuoted('Line one\nLine two')).toBe('Line one\nLine two');
  });
});

describe('email import', () => {
  const msg = (over) => ({ messageId: `<${Math.random()}@mail>`, from: { name: 'Pat Doe', address: 'pat@client.io' }, subject: 'Cannot export', text: 'Export fails', date: new Date().toISOString(), ...over });

  it('creates a ticket from a new email and threads replies into it', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const first = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, { messages: [msg()] });
    expect(first.results[0].status).toBe('created');
    const ticket = first.results[0].ticket;
    expect(ticket.via).toBe('email');
    expect(ticket.subject).toBe('Cannot export');
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/${ticket.id}`, { patch: { status: 'pending' }, comment: { html: '<p>Which browser?</p>' } });
    const reply = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, {
      messages: [msg({ subject: `Re: Cannot export [#${ticket.id}]`, text: 'Firefox.\n\nOn Mon someone wrote:\n> Which browser?' })],
    });
    expect(reply.results[0].status).toBe('appended');
    expect(reply.results[0].ticket.status).toBe('open');
    const full = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${ticket.id}`);
    expect(full.events.filter((e) => e.kind === 'comment').map((e) => e.text)).toContain('Firefox.');
  });

  it('imports each message once and does not let strangers reply into a ticket', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const m = msg();
    const a = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, { messages: [m] });
    const again = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, { messages: [m] });
    expect(again.results[0].status).toBe('duplicate');
    const id = a.results[0].ticket.id;
    const stranger = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, {
      messages: [msg({ from: { address: 'eve@evil.io' }, subject: `Re: [#${id}]` })],
    });
    expect(stranger.results[0].status).toBe('created');
    expect(stranger.results[0].ticket.id).not.toBe(id);
  });

  it('is limited to administrators', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    expect((await t.call(AGENT, 'POST', `/api/d/${desk}/email/import`, { messages: [msg()] })).status).toBe(403);
  });
});
