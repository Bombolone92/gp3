import { describe, it, expect, vi } from 'vitest';
import { sendDocument, parseRecipients, failureMessage, describeResult, digest, mailerAvailable } from '../src/mailer.js';

const fakePuter = (response) => ({ workers: { exec: vi.fn(async () => response) } });
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('mailer', () => {
  it('validates recipient lists', () => {
    expect(parseRecipients('a@x.com, B@x.com; a@x.com').list).toEqual(['a@x.com', 'b@x.com']);
    expect(parseRecipients('nope').error).toMatch(/not an email/);
    expect(parseRecipients('').error).toMatch(/at least one/);
  });

  it('posts the document through the worker bridge', async () => {
    const p = fakePuter(res(200, { ok: true, sent: 1, results: [{ email: 'c@x.com', status: 'sent' }] }));
    const out = await sendDocument({ kind: 'quote', doc: { id: 'q1', number: 7 }, settings: { company: { name: 'Acme', email: 'hi@acme.test' } }, to: ['c@x.com'], subject: 'Quote #7', body: 'Hello' }, { getPuter: () => p });
    expect(out.sent).toBe(1);
    const [url, init] = p.workers.exec.mock.calls[0];
    expect(url).toMatch(/\/send$/);
    const payload = JSON.parse(init.body);
    expect(payload.document).toMatchObject({ id: 'q1', number: '7', kind: 'quote', businessName: 'Acme', businessEmail: 'hi@acme.test' });
    expect(payload.recipients[0]).toEqual({ email: 'c@x.com', version: digest(['c@x.com', 'Quote #7', 'Hello']) });
  });

  it('turns worker refusals into actionable messages', async () => {
    const p = fakePuter(res(429, { error: 'daily_limit' }));
    await expect(sendDocument({ kind: 'invoice', doc: { id: 'i' }, settings: {}, to: ['a@b.co'], subject: 's', body: 'b' }, { getPuter: () => p })).rejects.toThrow(/email limit/);
    expect(failureMessage(401, {})).toMatch(/Sign in/);
  });

  it('reports unreachable workers and missing SDKs', async () => {
    const p = { workers: { exec: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) } };
    await expect(sendDocument({ kind: 'invoice', doc: { id: 'i' }, settings: {}, to: ['a@b.co'], subject: 's', body: 'b' }, { getPuter: () => p })).rejects.toThrow(/Could not reach/);
    expect(mailerAvailable(() => null)).toBe(false);
  });

  it('summarizes results', () => {
    expect(describeResult({ sent: 2, results: [] }).message).toMatch(/2 recipients/);
    expect(describeResult({ sent: 0, results: [{ status: 'skipped', reason: 'already_sent' }] }).duplicate).toBe(true);
  });

  it('does not count recipients cut off by the daily limit as emailed', () => {
    const out = { sent: 1, failed: 0, suppressed: 0, results: [{ email: 'a@x.co', status: 'sent' }, { email: 'b@x.co', status: 'skipped', reason: 'daily_limit' }, { email: 'c@x.co', status: 'skipped', reason: 'daily_limit' }] };
    const r = describeResult(out);
    expect(r).toMatchObject({ ok: true, partial: true, delivered: ['a@x.co'] });
    expect(r.message).toMatch(/2 not sent because today's email limit/);
    const none = describeResult({ sent: 0, results: [{ email: 'b@x.co', status: 'skipped', reason: 'daily_limit' }] });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/email limit/);
  });
});
