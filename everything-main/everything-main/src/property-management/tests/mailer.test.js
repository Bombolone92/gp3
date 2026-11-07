import { describe, it, expect, vi } from 'vitest';
import { sendEmail, parseRecipients, failureMessage, describeResult, recipientResults, digest, mailerAvailable, mailtoHref, MAX_RECIPIENTS } from '../src/mailer.js';

const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const fakePuter = (handler) => ({ workers: { exec: vi.fn(handler) } });

describe('mailer', () => {
  it('validates and deduplicates recipients', () => {
    expect(parseRecipients('a@x.com, B@x.com; a@x.com').list.map((r) => r.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(parseRecipients([{ name: 'Ann', email: 'Ann@X.com' }]).list[0]).toEqual({ name: 'Ann', email: 'ann@x.com' });
    expect(parseRecipients('nope').error).toMatch(/not an email/);
    expect(parseRecipients('').error).toMatch(/at least one/);
    expect(parseRecipients('a@x.com b@x.com', { max: 1 }).error).toMatch(/at most 1/);
    // Longer than an address can be: the email worker would drop it unreported.
    expect(parseRecipients(`${'a'.repeat(250)}@x.com`).error).toMatch(/not an email/);
  });

  it('posts a message through the worker bridge', async () => {
    const p = fakePuter(async () => res(200, { ok: true, sent: 1, results: [{ email: 'c@x.com', status: 'sent' }] }));
    const out = await sendEmail({ id: 'm1', to: [{ name: 'C', email: 'c@x.com' }], subject: 'Rent', body: 'Hello', senderName: 'Acme', replyTo: 'hi@acme.test' }, { getPuter: () => p });
    expect(out.sent).toBe(1);
    const [url, init] = p.workers.exec.mock.calls[0];
    expect(url).toMatch(/\/send$/);
    const payload = JSON.parse(init.body);
    expect(payload.message).toEqual({ id: 'm1', kind: 'email', senderName: 'Acme', senderEmail: 'hi@acme.test' });
    expect(payload.recipients[0]).toEqual({ email: 'c@x.com', name: 'C', version: digest(['c@x.com', 'Rent', 'Hello']) });
  });

  it('sends long lists in batches the worker accepts', async () => {
    const p = fakePuter(async (url, init) => {
      const n = JSON.parse(init.body).recipients.length;
      return res(200, { ok: true, sent: n, results: [] });
    });
    const to = Array.from({ length: 12 }, (_, i) => `t${i}@x.com`);
    const out = await sendEmail({ id: 'm2', to, subject: 's', body: 'b' }, { getPuter: () => p });
    expect(p.workers.exec).toHaveBeenCalledTimes(Math.ceil(12 / MAX_RECIPIENTS));
    for (const [, init] of p.workers.exec.mock.calls) expect(JSON.parse(init.body).recipients.length).toBeLessThanOrEqual(MAX_RECIPIENTS);
    expect(out.sent).toBe(12);
  });

  it('stops after a daily limit and reports partial results', async () => {
    let call = 0;
    const p = fakePuter(async () => (++call === 1 ? res(200, { ok: true, sent: 5, results: [] }) : res(429, { error: 'daily_limit' })));
    const out = await sendEmail({ id: 'm3', to: Array.from({ length: 15 }, (_, i) => `t${i}@x.com`), subject: 's', body: 'b' }, { getPuter: () => p });
    expect(p.workers.exec).toHaveBeenCalledTimes(2);
    expect(out.sent).toBe(5);
    expect(out.failed).toBe(10);
  });

  it('turns worker refusals into actionable messages', async () => {
    const p = fakePuter(async () => res(429, { error: 'daily_limit' }));
    await expect(sendEmail({ id: 'm4', to: ['a@b.co'], subject: 's', body: 'b' }, { getPuter: () => p })).rejects.toThrow(/email limit/);
    expect(failureMessage(401, {})).toMatch(/Sign in/);
  });

  it('reports unreachable workers and missing SDKs', async () => {
    const p = fakePuter(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(sendEmail({ id: 'm5', to: ['a@b.co'], subject: 's', body: 'b' }, { getPuter: () => p })).rejects.toThrow(/Could not reach/);
    expect(mailerAvailable(() => null)).toBe(false);
    await expect(sendEmail({ id: 'm6', to: ['a@b.co'], subject: 's', body: 'b' }, { getPuter: () => null })).rejects.toThrow(/Puter session/);
  });

  it('summarizes results', () => {
    expect(describeResult({ sent: 2, results: [] }).message).toMatch(/2 recipients/);
    expect(describeResult({ sent: 0, results: [{ status: 'skipped', reason: 'already_sent' }] }).duplicate).toBe(true);
    expect(describeResult({ sent: 1, failed: 1, results: [] }).message).toMatch(/1 could not/);
  });

  it('reports recipients the daily limit stopped as not sent', () => {
    const out = { sent: 2, skipped: 3, failed: 0, results: [{ email: 'a@x.com', status: 'sent' }, { email: 'b@x.com', status: 'sent' }, ...['c', 'd', 'e'].map((n) => ({ email: `${n}@x.com`, status: 'skipped', reason: 'daily_limit' }))] };
    const s = describeResult(out);
    expect(s).toMatchObject({ ok: true, partial: true });
    expect(s.message).toBe('Emailed 2, but 3 could not be sent today: the daily email limit was reached.');
    expect(recipientResults(out).filter((r) => r.status === 'failed')).toHaveLength(3);
    const none = describeResult({ sent: 0, skipped: 2, results: [{ status: 'skipped', reason: 'daily_limit' }, { status: 'skipped', reason: 'daily_limit' }] });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/daily email limit/);
  });

  it('does not record a recipient still being sent by an earlier try as sent', () => {
    const out = { sent: 0, skipped: 1, results: [{ email: 'a@x.com', status: 'skipped', reason: 'in_progress' }] };
    expect(describeResult(out)).toMatchObject({ ok: false });
    expect(describeResult(out).message).toMatch(/earlier try is still sending/);
    expect(recipientResults(out)).toEqual([{ email: 'a@x.com', status: 'failed' }]);
  });

  it('says a message is too long before sending any of it', async () => {
    const p = fakePuter(async () => res(200, { ok: true, sent: 1, results: [] }));
    await expect(sendEmail({ id: 'm', to: 'a@x.com', subject: 'Hi', body: 'x'.repeat(20001) }, { getPuter: () => p })).rejects.toThrow(/too long to email/);
    expect(p.workers.exec).not.toHaveBeenCalled();
  });

  it('builds mailto links that keep spaces readable', () => {
    const href = mailtoHref({ to: [{ email: 'a@x.com' }, 'b@x.com'], subject: 'Rent due', body: 'Hi there' });
    expect(href.startsWith('mailto:a%40x.com,b%40x.com?')).toBe(true);
    expect(href).toContain('subject=Rent%20due');
    expect(href).not.toContain('+');
  });
});
