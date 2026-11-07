import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  digest, sendVersion, base64Of, mailerAvailable, sendDocument,
  describeSendResult, recipientOutcome, describeUnreached, failureMessage, EMAIL_WORKER_URL, MAX_RECIPIENTS,
  MAX_ATTACHMENTS, MAX_SUBJECT_CHARS, MAX_BODY_CHARS,
} from '../src/lib/mailer.js';

const doc = { id: 'doc-1', number: 'INV-0042', kind: 'invoice' };
const settings = { business: { name: 'Aurora Studio', email: 'hi@aurora.example' } };

/** A puter whose workers.exec records the request and answers with `reply`. */
function fakePuter(reply = { ok: true, sent: 1, results: [] }, { status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    workers: {
      exec: vi.fn(async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: status >= 200 && status < 300, status, json: async () => reply };
      }),
    },
  };
}

const send = (p, over = {}) => sendDocument(
  { doc, settings, recipients: [{ email: 'maya@northwind.example' }], subject: 'S', body: 'B', ...over },
  { getPuter: () => p },
);

describe('caps', () => {
  it('holds the sheet to exactly what the worker enforces', () => {
    // The worker is deployed on its own and cannot be imported here, so its
    // constants are read off its source: a cap that drifted on one side would
    // either refuse messages the worker takes or, worse, let through a
    // message the worker silently shortens.
    const src = readFileSync(new URL('../src/workers/email-worker.js', import.meta.url), 'utf8');
    const cap = (name) => {
      const m = src.match(new RegExp(`^const ${name} = ([\\d_]+);`, 'm'));
      expect(m, name).toBeTruthy();
      return Number(m[1].replaceAll('_', ''));
    };
    expect(MAX_RECIPIENTS).toBe(cap('MAX_RECIPIENTS'));
    expect(MAX_ATTACHMENTS).toBe(cap('MAX_ATTACHMENTS'));
    expect(MAX_SUBJECT_CHARS).toBe(cap('MAX_SUBJECT_CHARS'));
    expect(MAX_BODY_CHARS).toBe(cap('MAX_BODY_CHARS'));
  });
});

describe('digest', () => {
  it('is stable, and moves when anything in the message does', () => {
    expect(digest(['a', 'b'])).toBe(digest(['a', 'b']));
    expect(digest(['a', 'b'])).not.toBe(digest(['a', 'c']));
  });

  it('is the hex the worker will accept', () => {
    expect(digest(['x'])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates a message from one with the same words in another field', () => {
    const a = sendVersion({ to: 'a@x.example', subject: 'Due', body: 'today' });
    const b = sendVersion({ to: 'a@x.example', subject: 'Due today', body: '' });
    expect(a).not.toBe(b);
  });

  it('is per recipient, so a copy to a second address is its own message', () => {
    const base = { subject: 'S', body: 'B' };
    expect(sendVersion({ ...base, to: 'a@x.example' }))
      .not.toBe(sendVersion({ ...base, to: 'b@x.example' }));
  });

  it('reads an address the way the worker does — trimmed and lowercased', () => {
    expect(sendVersion({ to: ' Maya@X.Example ', subject: 'S', body: 'B' }))
      .toBe(sendVersion({ to: 'maya@x.example', subject: 'S', body: 'B' }));
  });

  it('counts an attachment by name and size, not by re-hashing its bytes', () => {
    const one = sendVersion({ to: 'a@x.example', attachments: [{ filename: 'a.pdf', content: 'AAAA' }] });
    const same = sendVersion({ to: 'a@x.example', attachments: [{ filename: 'a.pdf', content: 'BBBB' }] });
    const bigger = sendVersion({ to: 'a@x.example', attachments: [{ filename: 'a.pdf', content: 'AAAAAA' }] });
    expect(one).toBe(same);
    expect(one).not.toBe(bigger);
  });
});

describe('base64Of', () => {
  it('encodes bytes', async () => {
    expect(await base64Of(new Uint8Array([72, 105]))).toBe('SGk=');
  });

  it('handles a payload past the argument limit of a single spread', async () => {
    const big = new Uint8Array(200_000).fill(65);
    const out = await base64Of(big);
    expect(out).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(out).length).toBe(200_000);
  });

  it('takes an ArrayBuffer as readily as a view of one', async () => {
    expect(await base64Of(new Uint8Array([72, 105]).buffer)).toBe('SGk=');
  });
});

describe('mailerAvailable', () => {
  it('needs the worker bridge — it is what carries the session', () => {
    expect(mailerAvailable(() => null)).toBe(false);
    expect(mailerAvailable(() => ({}))).toBe(false);
    expect(mailerAvailable(() => ({ workers: {} }))).toBe(false);
    expect(mailerAvailable(() => ({ workers: { exec: () => {} } }))).toBe(true);
  });
});

describe('sendDocument', () => {
  it('gives up on a worker that never answers, and says the message may still go out', async () => {
    const p = { workers: { exec: vi.fn(() => new Promise(() => {})) } };
    await expect(sendDocument(
      { doc, settings, recipients: [{ email: 'maya@northwind.example' }], subject: 'S', body: 'B' },
      { getPuter: () => p, timeoutMs: 20 },
    )).rejects.toThrow(/did not answer in time/);
    // A reply inside the bound is not a timeout, and the timer is cleared.
    const quick = { workers: { exec: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sent: 1, results: [] }) })) } };
    await expect(sendDocument(
      { doc, settings, recipients: [{ email: 'maya@northwind.example' }], subject: 'S', body: 'B' },
      { getPuter: () => quick, timeoutMs: 20 },
    )).resolves.toMatchObject({ sent: 1 });
  });

  it('answers a worker it could not reach at all in words the user can act on', async () => {
    // Offline mid-send, or nobody deployed one: the bridge itself rejects, and
    // "Failed to fetch" is not an instruction.
    const p = { workers: { exec: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) } };
    await expect(send(p)).rejects.toThrow(/Could not reach the email service/);
  });

  it('posts to the worker with the document, the message, and a version', async () => {
    const p = fakePuter();
    await send(p);
    const { url, body } = p.calls[0];
    expect(url).toBe(`${EMAIL_WORKER_URL}/send`);
    expect(body.document).toMatchObject({ id: 'doc-1', number: 'INV-0042', kind: 'invoice' });
    expect(body.subject).toBe('S');
    expect(body.recipients[0].version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('carries the business as the name on the mail and the address replies go to', async () => {
    const p = fakePuter();
    await send(p);
    expect(p.calls[0].body.document).toMatchObject({
      businessName: 'Aurora Studio', businessEmail: 'hi@aurora.example',
    });
  });

  it('normalizes and de-duplicates addresses before they cost anything', async () => {
    const p = fakePuter();
    await send(p, {
      recipients: [{ email: ' Maya@Northwind.example ' }, { email: 'maya@northwind.example' }],
    });
    expect(p.calls[0].body.recipients).toHaveLength(1);
    expect(p.calls[0].body.recipients[0].email).toBe('maya@northwind.example');
  });

  it('holds itself to what the worker will take in one request', async () => {
    const p = fakePuter();
    await send(p, {
      recipients: Array.from({ length: 9 }, (_, i) => ({ email: `a${i}@x.example` })),
    });
    expect(p.calls[0].body.recipients).toHaveLength(MAX_RECIPIENTS);
  });

  it('refuses to send with nobody to send to, rather than asking the worker', async () => {
    const p = fakePuter();
    await expect(send(p, { recipients: [{ email: '' }] })).rejects.toThrow(/nobody/i);
    expect(p.calls).toHaveLength(0);
  });

  it('says to use the mail app when this device has no worker bridge', async () => {
    await expect(send({})).rejects.toThrow(/mail app/i);
  });

  it('turns a refusal into words the user can act on', async () => {
    const p = fakePuter({ error: 'daily_limit' }, { status: 429 });
    await expect(send(p)).rejects.toThrow(/limit/i);
  });

  it('treats a 200 that is not ok as a failure — the worker owns that flag', async () => {
    const p = fakePuter({ ok: false, error: 'boom' });
    await expect(send(p)).rejects.toThrow(/Could not send/i);
  });

  it('passes `force` through for a deliberate resend', async () => {
    const p = fakePuter();
    await send(p, { force: true });
    expect(p.calls[0].body.force).toBe(true);
  });
});

describe('failureMessage', () => {
  it('names the fix for each refusal it can name', () => {
    expect(failureMessage(401, {})).toMatch(/Sign in/i);
    expect(failureMessage(429, {})).toMatch(/limit/i);
    expect(failureMessage(200, { error: 'attachments_invalid' })).toMatch(/Send fewer/i);
    expect(failureMessage(404, {})).toMatch(/mail app/i);
    expect(failureMessage(500, {})).toMatch(/try again/i);
  });
  it('says the service is busy when the worker could not read its counter', () => {
    expect(failureMessage(503, { error: 'temporarily_unavailable' })).toMatch(/busy right now/i);
    expect(failureMessage(200, { error: 'temporarily_unavailable' })).toMatch(/busy right now/i);
  });
});

describe('describeSendResult', () => {
  it('names the recipient when there was one', () => {
    const out = describeSendResult({ sent: 1 }, { recipients: ['maya@northwind.example'] });
    expect(out.message).toBe('Emailed to maya@northwind.example');
    expect(out.resend).toBe(false);
  });

  it('counts them when there were several', () => {
    expect(describeSendResult({ sent: 2 }, { recipients: ['a@x.example', 'b@x.example'] }).message)
      .toBe('Emailed to 2 recipients');
  });

  it('offers a resend when the worker had already sent this exact message', () => {
    const out = describeSendResult({ sent: 0, skipped: 1 });
    expect(out.resend).toBe(true);
    expect(out.message).toMatch(/already have/i);
  });

  it('reports a failure without hiding what did go out', () => {
    const out = describeSendResult({ sent: 1, failed: 1 });
    expect(out.message).toMatch(/Sent to 1, but 1/);
    expect(out.resend).toBe(false);
  });

  it('names who actually received it, not who was asked for', () => {
    // The client already had this exact message; only the sender's own copy
    // went out. Reporting the client as emailed would be a lie the user acts
    // on ("they have it, I can stop chasing").
    const out = describeSendResult({
      sent: 1,
      skipped: 1,
      results: [
        { email: 'maya@northwind.example', status: 'skipped', reason: 'already_sent' },
        { email: 'hi@aurora.example', status: 'sent' },
      ],
    }, { recipients: ['maya@northwind.example', 'hi@aurora.example'] });
    expect(out.message).toContain('hi@aurora.example');
    expect(out.message).not.toContain('maya@northwind.example');
    expect(out.message).toMatch(/already had it/i);
  });

  it('does not hide a recipient today’s limit held back', () => {
    const out = describeSendResult({
      sent: 1,
      skipped: 1,
      results: [
        { email: 'a@x.example', status: 'sent' },
        { email: 'b@x.example', status: 'skipped', reason: 'daily_limit' },
      ],
    }, { recipients: ['a@x.example', 'b@x.example'] });
    expect(out.message).toMatch(/held back by today's email limit/i);
    expect(out.resend).toBe(false);
  });

  it('offers the resend only for a duplicate, never for an unexplained nothing', () => {
    const dupe = describeSendResult({
      sent: 0,
      skipped: 1,
      results: [{ email: 'a@x.example', status: 'skipped', reason: 'already_sent' }],
    });
    expect(dupe.resend).toBe(true);
    const nothing = describeSendResult({ sent: 0, skipped: 0, results: [] });
    expect(nothing.resend).toBe(true); // no per-recipient detail: the old shape
    const odd = describeSendResult({
      sent: 0,
      skipped: 1,
      results: [{ email: 'a@x.example', status: 'skipped', reason: 'daily_limit' }],
    });
    expect(odd.resend).toBe(false);
    expect(odd.message).not.toMatch(/already have/i);
  });

  it('says an opt-out is an opt-out, not a fault to retry', () => {
    const out = describeSendResult({ sent: 0, suppressed: 1 });
    expect(out.message).toMatch(/opted out/i);
    expect(out.resend).toBe(false);
  });
});

describe('recipientOutcome', () => {
  const client = 'maya@northwind.example';
  const self = 'hi@aurora.example';

  it('reads one address’s own result, not the tally', () => {
    // The client bounced and only the sender's copy went: sent is 1, and
    // that 1 says nothing about the client.
    const out = { sent: 1, failed: 1, results: [
      { email: client, status: 'failed', reason: 'delivery_failed' },
      { email: self, status: 'sent' },
    ] };
    expect(recipientOutcome(out, client)).toEqual({ reached: false, status: 'failed', reason: 'delivery_failed' });
    expect(recipientOutcome(out, self).reached).toBe(true);
  });

  it('counts a message they already have as reached', () => {
    const out = { sent: 1, skipped: 1, results: [
      { email: client, status: 'skipped', reason: 'already_sent' },
      { email: self, status: 'sent' },
    ] };
    expect(recipientOutcome(out, client).reached).toBe(true);
  });

  it('does not count an opt-out, a held-back address, or one the worker never answered for', () => {
    const held = { sent: 1, results: [{ email: client, status: 'skipped', reason: 'daily_limit' }, { email: self, status: 'sent' }] };
    expect(recipientOutcome(held, client).reached).toBe(false);
    const opted = { sent: 1, results: [{ email: client, status: 'suppressed' }, { email: self, status: 'sent' }] };
    expect(recipientOutcome(opted, client).reached).toBe(false);
    // The worker dropped the address without a result entry.
    const dropped = { sent: 1, results: [{ email: self, status: 'sent' }] };
    expect(recipientOutcome(dropped, client)).toEqual({ reached: false, status: 'missing', reason: '' });
  });

  it('matches the address however it was cased, and falls back to the tally for an old reply', () => {
    const out = { sent: 1, results: [{ email: client, status: 'sent' }] };
    expect(recipientOutcome(out, ' Maya@Northwind.example ').reached).toBe(true);
    expect(recipientOutcome({ sent: 1 }, client)).toEqual({ reached: true, status: 'unknown', reason: '' });
    expect(recipientOutcome({ sent: 0 }, client).reached).toBe(false);
  });
});

describe('describeUnreached', () => {
  it('names the address and why, and says the copy went when it did', () => {
    expect(describeUnreached('maya@x.example', { status: 'failed' }, { copySent: true }))
      .toBe('Could not deliver to maya@x.example. Your copy was sent.');
    expect(describeUnreached('maya@x.example', { status: 'suppressed' }))
      .toMatch(/opted out/);
    expect(describeUnreached('maya@x.example', { status: 'skipped', reason: 'daily_limit' }))
      .toMatch(/held back by today's email limit/);
    expect(describeUnreached('maya@x.example', { status: 'missing' }))
      .toBe('Could not deliver to maya@x.example.');
  });
});
