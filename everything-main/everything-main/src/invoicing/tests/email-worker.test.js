import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { instantiateWorker, makeKv } from './helpers/worker-harness.js';

const RAW = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/workers/email-worker.js'),
  'utf8',
);

const CALLER = { uuid: 'user-uuid-1', username: 'aurora', puter: { authToken: 'caller-token' } };
const VIEW = 'https://inv-abc123.puter.site/k7f2m9qz4x.html';
const PAY = 'https://paypal.me/aurora/1200.00USD';

/**
 * A worker with a fake `puter.email` on both the owner (`me`) and the caller
 * (`user`) — the two forms the send can take. `outcome` lets a test decide what
 * a given send does; by default every message is accepted.
 */
function loadWorker({ outcome = null, ownerSend = null, callerSend = null } = {}) {
  const kv = makeKv();
  const sent = [];
  const mailer = (via, override) =>
    vi.fn(async (message) => {
      if (override) return override(message);
      sent.push({ via, ...message });
      const out = outcome ? outcome(message) : null;
      return { messageId: `m${sent.length}`, cost: 25, suppressed: [], failed: [], ...(out || {}) };
    });
  const me = { puter: { kv, authToken: 'owner-token', email: { send: mailer('me', ownerSend) } } };
  const caller = { ...CALLER, puter: { ...CALLER.puter, email: { send: mailer('user', callerSend) } } };
  return { worker: instantiateWorker(RAW, { kv, me }), kv, sent, me, caller };
}

function payload(overrides = {}) {
  return {
    document: {
      id: 'doc-1',
      number: 'INV-0042',
      kind: 'invoice',
      businessName: 'Aurora Studio',
      businessEmail: 'hi@aurora.example',
      viewUrl: VIEW,
      payUrl: PAY,
    },
    recipients: [{ email: 'maya@northwind.example', name: 'Maya Chen', version: 'abcd1234' }],
    subject: 'Invoice INV-0042 from Aurora Studio',
    body: `Hi Maya,\n\nInvoice INV-0042 for $1,200.00 is ready.\n\nView it here: ${VIEW}\nPay online: ${PAY}\n\nThank you,\nAurora Studio`,
    ...overrides,
  };
}

async function post(world, body = payload(), { user = world.caller } = {}) {
  return world.worker.call('POST', '/send', { json: body, user });
}

describe('email worker: access', () => {
  it('reports its version without auth', async () => {
    const res = await loadWorker().worker.call('GET', '/health');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('refuses a caller with no Puter session — nothing to bill, nothing to send', async () => {
    const world = loadWorker();
    const res = await world.worker.call('POST', '/send', { json: payload() });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('sign_in_required');
    expect(world.sent).toHaveLength(0);
  });

  it('refuses a session it cannot pin to a person', async () => {
    const world = loadWorker();
    const res = await post(world, payload(), { user: { puter: { authToken: 't' } } });
    expect(res.status).toBe(401);
    expect((await res.json()).detail).toBe('no_identity');
  });

  it('takes the caller on `requestor` too', async () => {
    const world = loadWorker();
    const res = await world.worker.call('POST', '/send', {
      json: payload(), user: world.caller, bindAs: 'requestor',
    });
    expect((await res.json()).sent).toBe(1);
  });

  it('refuses a session with no token to put on the bill, rather than billing the app owner', async () => {
    const world = loadWorker();
    // A caller the worker can name, whose session did not carry the token that
    // charges them, and who has no mailer of their own to send through: the
    // only way left would spend the app owner's money.
    const tokenless = { uuid: 'user-uuid-3', puter: {} };
    const res = await post(world, payload(), { user: tokenless });
    expect(res.status).toBe(401);
    expect((await res.json()).detail).toBe('no_billable_sender');
    expect(world.sent).toHaveLength(0);
  });

  it('still sends through the caller’s own mailer when only their token is missing', async () => {
    const world = loadWorker();
    const noToken = { uuid: 'user-uuid-4', puter: { email: world.caller.puter.email } };
    expect((await (await post(world, payload(), { user: noToken })).json()).sent).toBe(1);
    expect(world.sent[0].via).toBe('user');
    expect(world.sent[0].emailAccessToken).toBe('owner-token');
    expect(world.sent[0].requesterToken).toBeUndefined();
  });

  it('never hands the mailer an undefined requesterToken', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0]).toHaveProperty('requesterToken', 'caller-token');
  });

  it('whoami reports the session without leaking a value', async () => {
    const world = loadWorker();
    const res = await world.worker.call('GET', '/whoami', { user: world.caller });
    const data = await res.json();
    expect(data.identified).toBe(true);
    expect(data.has.authToken).toBe(true);
    expect(data.billable).toEqual([true, true]);
    expect(JSON.stringify(data)).not.toContain('caller-token');
  });
});

describe('email worker: validation', () => {
  const bad = async (body, error) => {
    const world = loadWorker();
    const res = await post(world, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(world.sent).toHaveLength(0);
  };

  it('needs a document id shaped like one', async () => {
    await bad(payload({ document: { ...payload().document, id: 'a|b' } }), 'document_id_required');
  });

  it('needs a recipient', async () => {
    await bad(payload({ recipients: [{ email: 'not-an-address', version: 'abcd1234' }] }), 'recipients_required');
  });

  it('needs a version per recipient, so a duplicate can be recognised', async () => {
    await bad(payload({ recipients: [{ email: 'maya@northwind.example' }] }), 'version_required');
  });

  it('needs a body — the message is the caller’s, and there is no default', async () => {
    await bad(payload({ body: '   ' }), 'body_required');
  });

  it('falls back to a subject when one is not supplied', async () => {
    const world = loadWorker();
    await post(world, payload({ subject: '' }));
    expect(world.sent[0].subject).toBe('Invoice INV-0042');
  });

  it('folds a newline out of the subject: that is how header injection starts', async () => {
    const world = loadWorker();
    await post(world, payload({ subject: 'Invoice\nBcc: someone@else.example' }));
    expect(world.sent[0].subject).toBe('Invoice Bcc: someone@else.example');
  });

  it('folds Unicode’s own line breaks the same way', async () => {
    const world = loadWorker();
    await post(world, payload({ subject: 'Invoice\u2028Bcc: a@b.example\u0085X-Injected: 1\u2029' }));
    expect(world.sent[0].subject).toBe('Invoice Bcc: a@b.example X-Injected: 1');
  });

  it('never cuts a subject or a body through the middle of a character', async () => {
    const world = loadWorker();
    const subject = `${'a'.repeat(199)}\u{1F600}tail`;
    const body = `${'b'.repeat(19_999)}\u{1F600}tail`;
    await post(world, payload({ subject, body }));
    expect(world.sent[0].subject).toBe('a'.repeat(199));
    expect(world.sent[0].subject.isWellFormed()).toBe(true);
    expect(world.sent[0].text.isWellFormed()).toBe(true);
    expect(world.sent[0].text.length).toBeLessThanOrEqual(20_000);
  });

  it('sends one private message per recipient, never a shared Cc', async () => {
    const world = loadWorker();
    const res = await post(world, payload({
      recipients: [
        { email: 'maya@northwind.example', version: 'abcd1234' },
        { email: 'hi@aurora.example', version: 'abcd1235' },
      ],
    }));
    expect((await res.json()).sent).toBe(2);
    expect(world.sent.map((m) => m.to)).toEqual(['maya@northwind.example', 'hi@aurora.example']);
    for (const message of world.sent) expect(typeof message.to).toBe('string');
  });

  it('drops a duplicate address rather than mailing it twice', async () => {
    const world = loadWorker();
    const res = await post(world, payload({
      recipients: [
        { email: 'maya@northwind.example', version: 'abcd1234' },
        { email: 'MAYA@northwind.example', version: 'ffff0000' },
      ],
    }));
    expect((await res.json()).sent).toBe(1);
  });

  it('replies go to the business, not to whatever the platform sends from', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0].replyTo).toBe('hi@aurora.example');
  });

  it('refuses an address carrying NEXT LINE, the one line break \\s does not see', async () => {
    // U+0085 is a header break to a transport that honours it, and not
    // whitespace to JavaScript — so it slipped past the address shape test
    // into To and Reply-To, the two header fields line() did not cover.
    const world = loadWorker();
    const res = await post(world, payload({
      document: { ...payload().document, businessEmail: 'hi@aurora.example\u0085X-Injected:1' },
    }));
    expect(res.status).toBe(200);
    expect(world.sent[0].replyTo ?? '').not.toContain('X-Injected');
    expect(world.sent[0].replyTo ?? '').not.toContain('\u0085');
    const world2 = loadWorker();
    const res2 = await post(world2, payload({
      recipients: [{ email: 'maya@northwind.example\u0085Bcc:evil.example', name: 'Maya', version: 'abcd1234' }],
    }));
    expect(res2.status).toBe(400);
    expect(world2.sent).toHaveLength(0);
  });
});

describe('email worker: the message', () => {
  const htmlOf = async (body) => {
    const world = loadWorker();
    await post(world, body);
    return world.sent[0].html;
  };

  it('sends the user’s own words as the plain-text half, unchanged', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0].text).toBe(payload().body);
  });

  it('escapes the body: a caller supplies text, never markup', async () => {
    const html = await htmlOf(payload({ body: 'Hi <script>alert(1)</script> & co' }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp; co');
  });

  it('keeps the line breaks the user typed', async () => {
    expect(await htmlOf(payload({ body: 'One\nTwo' }))).toContain('One<br>Two');
  });

  it('keeps the spacing the user typed, in the HTML half as in the text', async () => {
    const html = await htmlOf(payload({ body: 'Design work      10 h    $1,000.00\nHosting          1 yr   $200.00' }));
    expect(html).toContain('Design work      10 h    $1,000.00');
    expect(html).toMatch(/white-space:pre-wrap[^>]*>Design work/);
  });

  it('linkifies the share page and the pay link, and nothing else', async () => {
    const html = await htmlOf(payload({ body: `See ${VIEW} or ${PAY} or https://evil.example/x` }));
    expect(html).toContain(`href="${VIEW}"`);
    expect(html).toContain(`href="${PAY.replace(/&/g, '&amp;')}"`);
    expect(html).not.toContain('href="https://evil.example/x"');
    expect(html).toContain('https://evil.example/x'); // still readable, just not a link
  });

  it('refuses a view link that is not a share page this app publishes', async () => {
    for (const url of [
      'http://inv-abc.puter.site/k7f2m9qz4x.html',
      'https://evil.example/k7f2m9qz4x.html',
      'https://inv-abc.puter.site/../secret.html',
      'https://inv-abc.puter.site/k7f2m9qz4x.html?next=https://evil.example',
    ]) {
      const html = await htmlOf(payload({
        document: { ...payload().document, viewUrl: url, payUrl: '' },
        body: `Open ${url}`,
      }));
      expect(html, url).not.toContain(`href="${url}"`);
    }
  });

  it('drops a query and fragment from the view link rather than trusting them', async () => {
    const world = loadWorker();
    const dressed = `${VIEW}?utm=1#top`;
    await post(world, payload({
      document: { ...payload().document, viewUrl: dressed },
      body: `Open ${VIEW}`,
    }));
    expect(world.sent[0].html).toContain(`href="${VIEW}"`);
  });

  it('refuses a pay link with credentials in it — the disguise, not the domain', async () => {
    const disguised = 'https://paypal.me@evil.example/pay';
    const html = await htmlOf(payload({
      document: { ...payload().document, payUrl: disguised, viewUrl: '' },
      body: `Pay at ${disguised}`,
    }));
    expect(html).not.toContain('href=');
  });

  it('shows the pay link as its own URL, so a recipient reads where it goes', async () => {
    const html = await htmlOf(payload({ body: `Pay online: ${PAY}` }));
    expect(html).toContain(`>${PAY.replace(/&/g, '&amp;')}</a>`);
  });

  it('links a pay URL exactly as the caller spelled it, normalization and all', async () => {
    // A bare host gains a trailing slash under URL normalization; linking the
    // normalized form would leave the one in the body unlinked.
    const bare = 'https://pay.aurora.example';
    const html = await htmlOf(payload({
      document: { ...payload().document, payUrl: bare, viewUrl: '' },
      body: `Pay online: ${bare}`,
    }));
    expect(html).toContain(`href="${bare}"`);
  });

  it('carries the business name and nothing loaded from the network', async () => {
    const html = await htmlOf(payload());
    expect(html).toContain('Aurora Studio');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<style');
  });
});

describe('email worker: attachments', () => {
  const pdf = (n = 40) => ({
    filename: 'INV-0042.pdf', contentType: 'application/pdf', content: 'A'.repeat(n),
  });

  it('passes an attachment through', async () => {
    const world = loadWorker();
    await post(world, payload({ attachments: [pdf()] }));
    expect(world.sent[0].attachments).toEqual([
      { filename: 'INV-0042.pdf', contentType: 'application/pdf', content: 'A'.repeat(40) },
    ]);
  });

  it('sends no attachments key at all when there are none', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0].attachments).toBeUndefined();
  });

  it('strips a path out of a filename', async () => {
    const world = loadWorker();
    await post(world, payload({ attachments: [{ ...pdf(), filename: '../../etc/passwd' }] }));
    expect(world.sent[0].attachments[0].filename).toBe('etc-passwd');
  });

  it('strips the bidi overrides that disguise a filename’s extension', async () => {
    const world = loadWorker();
    await post(world, payload({ attachments: [{ ...pdf(), filename: 'invoice\u202efdp.exe' }] }));
    expect(world.sent[0].attachments[0].filename).toBe('invoicefdp.exe');
  });

  it('cuts a long filename between characters, never through one', async () => {
    const world = loadWorker();
    await post(world, payload({ attachments: [{ ...pdf(), filename: `${'a'.repeat(119)}\u{1F600}.pdf` }] }));
    const name = world.sent[0].attachments[0].filename;
    expect(name.isWellFormed()).toBe(true);
    expect(name).toBe('a'.repeat(119));
  });

  it('falls back to a generic type rather than trusting a malformed one', async () => {
    const world = loadWorker();
    await post(world, payload({ attachments: [{ ...pdf(), contentType: 'text/html\r\nX: y' }] }));
    expect(world.sent[0].attachments[0].contentType).toBe('application/octet-stream');
  });

  it('refuses the whole send when an attachment is not base64', async () => {
    const world = loadWorker();
    const res = await post(world, payload({ attachments: [{ ...pdf(), content: 'not base64!!' }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('attachments_invalid');
    // Better than quietly mailing an invoice with its PDF missing.
    expect(world.sent).toHaveLength(0);
  });

  it('refuses attachments that add up to more than it will carry', async () => {
    const world = loadWorker();
    const res = await post(world, payload({ attachments: [pdf(9 * 1024 * 1024)] }));
    expect((await res.json()).error).toBe('attachments_invalid');
  });
});

describe('email worker: not sending twice', () => {
  it('skips a message this recipient already has', async () => {
    const world = loadWorker();
    expect((await (await post(world)).json()).sent).toBe(1);
    const second = await (await post(world)).json();
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.results[0].reason).toBe('already_sent');
    expect(world.sent).toHaveLength(1);
  });

  it('sends again when the message changed — a reminder is not a duplicate', async () => {
    const world = loadWorker();
    await post(world);
    const next = payload({
      subject: 'Reminder: invoice INV-0042 is overdue',
      recipients: [{ email: 'maya@northwind.example', name: 'Maya Chen', version: 'beef0001' }],
    });
    expect((await (await post(world, next)).json()).sent).toBe(1);
    expect(world.sent).toHaveLength(2);
  });

  it('sends the identical message again when asked outright', async () => {
    const world = loadWorker();
    await post(world);
    expect((await (await post(world, payload({ force: true }))).json()).sent).toBe(1);
    expect(world.sent).toHaveLength(2);
  });

  it('keeps one user’s record from suppressing another’s', async () => {
    const world = loadWorker();
    await post(world);
    const other = { uuid: 'user-uuid-2', puter: { authToken: 't2', email: world.caller.puter.email } };
    expect((await (await post(world, payload(), { user: other })).json()).sent).toBe(1);
  });

  it('records nothing when the transport refused, so a retry still goes', async () => {
    const world = loadWorker({ outcome: () => ({ failed: ['maya@northwind.example'] }) });
    const res = await (await post(world)).json();
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
    expect([...world.kv.map.keys()].filter((k) => k.startsWith('mail:sent:'))).toEqual([]);
  });

  it('still sends, and still answers, when the record of earlier sends cannot be read', async () => {
    // The dedupe record saves money; it is not a gate. A KV read that throws
    // one recipient into a batch used to take the whole reply down after the
    // first message had already been handed over, so that delivery was never
    // reported — and the retry it invited sent it again.
    const world = loadWorker();
    world.kv.get = vi.fn(async () => { throw new Error('kv unavailable'); });
    const res = await (await post(world, payload({
      recipients: [
        { email: 'maya@northwind.example', version: 'abcd1234' },
        { email: 'hi@aurora.example', version: 'abcd1235' },
      ],
    }))).json();
    expect(res.ok).toBe(true);
    expect(res.sent).toBe(2);
    expect(res.results.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(world.sent).toHaveLength(2);
  });

  it('counts a suppressed address apart from a failure — that is a decision, not a fault', async () => {
    const world = loadWorker({ outcome: () => ({ suppressed: ['maya@northwind.example'] }) });
    const res = await (await post(world)).json();
    expect(res.suppressed).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('still reports a delivered message when its own bookkeeping cannot be written', async () => {
    // Once the transport has taken the message there is no unsending it. A KV
    // write that fails after that costs the dedupe record, nothing more —
    // calling it a failure would tell the user their invoice never arrived.
    const world = loadWorker();
    world.kv.set = vi.fn(async () => { throw new Error('kv unavailable'); });
    const res = await (await post(world)).json();
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.results[0].status).toBe('sent');
    expect(world.sent).toHaveLength(1);
  });

  it('reads the suppressed and failed lists defensively, in case they are counts', async () => {
    // This worker's own reply counts them; a transport that did the same would
    // otherwise throw on .includes() and land a delivered message in the catch.
    const world = loadWorker({ outcome: () => ({ suppressed: 0, failed: 1 }) });
    const res = await (await post(world)).json();
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.suppressed).toBe(0);
  });

  it('reports a thrown send as a failure without taking the request down', async () => {
    const world = loadWorker({ ownerSend: () => { throw new Error('mailbox full'); }, callerSend: () => { throw new Error('mailbox full'); } });
    const res = await (await post(world)).json();
    expect(res.ok).toBe(true);
    expect(res.failed).toBe(1);
    expect(res.results[0].reason).toContain('mailbox full');
  });

  it('stores no address, number, or amount in the owner’s KV', async () => {
    const world = loadWorker();
    await post(world);
    const dump = JSON.stringify([...world.kv.map.entries()]);
    expect(dump).not.toContain('northwind');
    expect(dump).not.toContain('INV-0042');
    expect(dump).not.toContain('doc-1');
  });
});

describe('email worker: the daily cap', () => {
  it('refuses once the user has spent the day’s allowance', async () => {
    const world = loadWorker();
    await post(world); // seeds the rate key
    const rateKey = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(rateKey, 200);
    const res = await post(world, payload({ force: true }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('daily_limit');
    expect(world.sent).toHaveLength(1);
  });

  it('counts only what actually went out', async () => {
    const world = loadWorker({ outcome: () => ({ failed: ['maya@northwind.example'] }) });
    await post(world);
    const rateKey = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    expect(Number(world.kv.map.get(rateKey)) || 0).toBe(0);
  });

  it('grants the last of the allowance to one of two requests racing for it, not both', async () => {
    // Read-then-bump let every request in flight see the same count: the
    // counter only moved after a whole batch had gone, so a burst of
    // concurrent requests each got the full remainder. The slots are claimed
    // atomically up front now, and the second request sees the first's claim.
    const world = loadWorker();
    await post(world);
    const rateKey = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(rateKey, 199);
    const gate = [];
    const incr = world.kv.incr;
    // Hold every increment until both requests have asked, so neither can
    // finish (and settle) before the other reads the counter.
    let held = 0;
    world.kv.incr = vi.fn((k, by) => {
      if (held >= 2) return incr(k, by); // the refunds, after the race is decided
      held += 1;
      return new Promise((resolve) => {
        gate.push(() => resolve(incr(k, by)));
        if (gate.length === 2) gate.splice(0).forEach((go) => go());
      });
    });
    const [a, b] = await Promise.all([
      post(world, payload({ force: true, recipients: [{ email: 'a@x.example', version: 'aaaa1111' }] })),
      post(world, payload({ force: true, recipients: [{ email: 'b@x.example', version: 'bbbb2222' }] })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(world.sent).toHaveLength(2); // the seed, plus exactly one of the pair
    expect(Number(world.kv.map.get(rateKey))).toBe(200);
  });

  it('hands back the slots a request claimed but did not use', async () => {
    const world = loadWorker();
    await post(world);
    const rateKey = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    // Same message again: skipped as already sent, so the claim is returned.
    await post(world);
    expect(Number(world.kv.map.get(rateKey))).toBe(1);
  });

  it('refuses cleanly, before anything is spent, when the counter cannot be read', async () => {
    const world = loadWorker();
    world.kv.incr = vi.fn(async () => { throw new Error('kv unavailable'); });
    const res = await post(world);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('temporarily_unavailable');
    expect(world.sent).toHaveLength(0);
  });

  it('stops mid-batch rather than overspending, and says who was skipped', async () => {
    const world = loadWorker();
    await post(world);
    const rateKey = [...world.kv.map.keys()].find((k) => k.startsWith('mail:rate:'));
    world.kv.map.set(rateKey, 199);
    const res = await (await post(world, payload({
      force: true,
      recipients: [
        { email: 'a@x.example', version: 'aaaa1111' },
        { email: 'b@x.example', version: 'bbbb2222' },
      ],
    }))).json();
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.results[1].reason).toBe('daily_limit');
  });
});

describe('email worker: which send form the platform takes', () => {
  it('bills the caller through the owner’s mailer by default', async () => {
    const world = loadWorker();
    await post(world);
    expect(world.sent[0].via).toBe('me');
    expect(world.sent[0].requesterToken).toBe('caller-token');
  });

  it('falls back to the caller’s mailer when the first form is not understood', async () => {
    const world = loadWorker({ ownerSend: () => { throw new Error('unknown parameter requesterToken'); } });
    await post(world);
    expect(world.sent[0].via).toBe('user');
    expect(world.sent[0].emailAccessToken).toBe('owner-token');
  });

  it('does not retry a message the transport already took a view on', async () => {
    const calls = [];
    const world = loadWorker({
      ownerSend: (m) => { calls.push('me'); throw new Error('recipient mailbox is full'); },
      callerSend: (m) => { calls.push('user'); return {}; },
    });
    const res = await (await post(world)).json();
    expect(calls).toEqual(['me']);
    expect(res.failed).toBe(1);
  });
});
