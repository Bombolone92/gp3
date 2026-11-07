/**
 * The help desk backend: every route the app and the help center call. It
 * is written against small injected services (a Puter KV store, a file
 * store, an email sender and an identity lookup) so the same code runs in
 * three places: the Puter worker an owner deploys, the owner's own browser
 * before any worker exists, and the tests.
 */
import { deskKeys, idFromKey, PRESENCE_TTL_SECONDS } from '../shared/keys.js';
import { randomId, secret, isId, sha256 } from '../shared/ids.js';
import {
  LIMITS, ValidationError, cleanLine, cleanText, normEmail, normTags, normDomain, ROLES, isEmail, cleanFieldValue,
} from '../shared/model.js';
import { sanitizeHtml, htmlToText, preview, textToHtml } from '../shared/html.js';
import { Routes, fail, errorBody } from './http.js';
import { Store } from './store.js';
import { defaultConfig, CONFIG_KINDS } from './defaults.js';
import { validateConfig, validateMeta } from './config.js';
import {
  createTicket, updateTicket, ticketEvents, createUser, autoClose, eventId, eventKey, findUserByEmail, writeTicket,
} from './tickets.js';
import { cleanMessage, ticketNumberFrom, cleanSubject } from './email.js';

const SWEEP_EVERY = 60 * 60 * 1000;
/** Attachment types served as themselves; every other file is plain bytes. */
export const SAFE_FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip']);
/** Most notification emails one desk may send per day, so the help center cannot be used to spam. */
const DAILY_EMAIL_CAP = 500;
const SYNC_WINDOW = 400;

export function createBackend(options) {
  const store = new Store(options.kv, options.now || (() => Date.now()));
  const env = {
    store,
    fs: options.fs || null,
    email: options.email || null,
    ownerUuid: options.ownerUuid || (async () => null),
    build: options.build || { id: 'dev', at: 0 },
  };
  const routes = new Routes();
  const articleCache = new Map();

  /* ------------------------------------------------------------ helpers */

  async function identity(req) {
    const who = await req.who?.();
    if (!who || !who.uuid) fail(401, 'unauthorized', 'Sign in with Puter to continue');
    return who;
  }

  function deskId(value) {
    if (!isId(value, 6, 24)) fail(404, 'no_desk', 'This help desk does not exist');
    return value;
  }

  /** Load a desk for one of its agents. */
  async function agentContext(req, { admin = false, owner = false, allowDeleted = false } = {}) {
    const desk = deskId(req.params.desk);
    const who = await identity(req);
    const K = deskKeys(desk);
    const [meta, members, groups, fields, triggers] = await store.getMany([
      K.meta, K.members, K.cfg('groups'), K.cfg('fields'), K.cfg('triggers'),
    ]);
    if (!meta || (meta.deleted && !allowDeleted)) fail(404, 'no_desk', 'This help desk does not exist');
    const me = members && Object.hasOwn(members, who.uuid) ? members[who.uuid] : null;
    if (!me || !me.active) fail(403, 'not_member', 'You are not an agent on this help desk');
    if (owner && me.role !== 'owner') fail(403, 'forbidden', 'Only the owner can do that');
    if (admin && me.role === 'agent') fail(403, 'forbidden', 'Only administrators can do that');
    return {
      desk, K, meta, members, me, who,
      cfg: { groups: groups || [], fields: fields || [], triggers: triggers || [] },
      actor: { type: 'agent', id: who.uuid, name: me.name || who.username },
    };
  }

  /** Load a desk for its help center (no sign-in needed). */
  async function portalContext(req) {
    const desk = deskId(req.params.desk);
    const K = deskKeys(desk);
    const [meta, members, groups, fields, triggers] = await store.getMany([
      K.meta, K.members, K.cfg('groups'), K.cfg('fields'), K.cfg('triggers'),
    ]);
    if (!meta || meta.deleted || !meta.portal?.enabled) fail(404, 'no_portal', 'This help center is not available');
    return { desk, K, meta, members: members || {}, cfg: { groups: groups || [], fields: fields || [], triggers: triggers || [] } };
  }

  async function rateLimit(K, scope, who, limit, windowSeconds) {
    const key = K.rate(scope, (await sha256(who || 'anon')).slice(0, 20));
    if (!(await store.allow(key, limit, windowSeconds))) {
      fail(429, 'rate_limited', 'Too many requests. Please wait a few minutes and try again.');
    }
  }

  /**
   * The network a visitor is on, for rate limits: the IPv4 address, or the
   * first 48 bits of an IPv6 address (one site). IPv4 written as IPv6
   * (::ffff:1.2.3.4) counts as IPv4, and shortened IPv6 is expanded first.
   */
  function ipOf(req) {
    const raw = String(req.headers?.['x-real-ip'] || req.ip || 'local').trim().toLowerCase();
    if (!raw.includes(':')) return raw;
    const v4 = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (v4) return v4[1];
    const [head, tail = ''] = raw.split('%')[0].split('::');
    const left = head ? head.split(':') : [];
    const right = raw.includes('::') && tail ? tail.split(':') : [];
    const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
  }

  function num(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) fail(404, 'not_found', 'Not found');
    return n;
  }

  /**
   * Announce a change to the team. Callers change members with path updates,
   * never by writing the whole list back, so concurrent changes all survive;
   * the feed entry reads the list once its revision is taken.
   */
  async function memberChange(K, by) {
    let members = null;
    await store.commit(K, [], async () => {
      members = (await store.get(K.members)) || {};
      return { k: 'm', id: 'members', v: members, by };
    });
    return members;
  }

  /* ------------------------------------------------------------- health */

  routes.get('/health', async () => ({ ok: true, build: env.build.id, builtAt: env.build.at }));

  /* ------------------------------------------------------------- desks */

  routes.post('/api/desks', async (req) => {
    const who = await identity(req);
    const owner = await env.ownerUuid();
    // Fail closed: if the owner cannot be told, nobody may create desks.
    if (!owner || owner !== who.uuid) fail(403, 'forbidden', 'Only the owner of this server can create help desks on it');
    const body = req.body || {};
    const name = cleanLine(body.name, 80);
    if (!name) throw new ValidationError('Give the help desk a name', 'name');
    const desk = isId(body.id, 8, 24) ? body.id : randomId(10);
    const K = deskKeys(desk);
    if (await store.get(K.meta)) fail(409, 'exists', 'A help desk with that id already exists');
    const now = store.now();
    const meta = {
      id: desk,
      name,
      owner: who.uuid,
      createdAt: now,
      appUrl: null,
      server: null,
      timezone: cleanLine(body.timezone, 60) || null,
      autoCloseDays: 4,
      portal: { enabled: false, title: name, intro: 'Search for answers or send us a request.', color: null, signInRequired: false },
      email: { enabled: true, replyTo: null },
      csat: { enabled: true },
      sweptAt: now,
      ...validateMeta({ appUrl: body.appUrl, server: body.server }, {}),
    };
    const members = {
      [who.uuid]: {
        uuid: who.uuid, username: who.username || '', name: cleanLine(body.agentName, 80) || who.username || 'Owner',
        role: 'owner', groups: ['support'], active: true, joinedAt: now,
      },
    };
    const cfg = defaultConfig();
    await store.setMany([
      { key: K.meta, value: meta },
      { key: K.members, value: members },
      { key: K.seq, value: { t: 0, u: 0, o: 0, a: 0 } },
      ...CONFIG_KINDS.map((kind) => ({ key: K.cfg(kind), value: cfg[kind] })),
    ]);
    return { desk, meta };
  });

  /**
   * Copy a desk's records into this server. Used when an owner who started
   * in the browser turns on team access and the server's store turns out to
   * be separate from the one the browser used. Owner only, desk keys only.
   */
  routes.post('/api/import/:desk', async (req) => {
    const who = await identity(req);
    const owner = await env.ownerUuid();
    if (!owner || owner !== who.uuid) fail(403, 'forbidden', 'Only the owner of this server can import data');
    const desk = deskId(req.params.desk);
    const prefix = deskKeys(desk).prefix;
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 500)
      .filter((it) => typeof it?.key === 'string' && it.key.startsWith(prefix) && it.key.length < 512 && !it.key.startsWith(`${prefix}ch:`) && !it.key.startsWith(`${prefix}pr:`))
      .map((it) => ({ key: it.key, value: it.value }));
    await store.setMany(items);
    return { written: items.length };
  });

  routes.get('/api/d/:desk/bootstrap', async (req) => {
    const c = await agentContext(req);
    const vals = await store.getMany([...CONFIG_KINDS.map((k) => c.K.cfg(k)), c.K.rev]);
    const cfg = Object.fromEntries(CONFIG_KINDS.map((k, i) => [k, vals[i]]));
    return { meta: c.meta, members: c.members, cfg, rev: Number(vals[vals.length - 1]) || 0, me: c.me };
  });

  routes.put('/api/d/:desk/meta', async (req) => {
    const c = await agentContext(req, { admin: true });
    const patch = validateMeta(req.body || {}, c.meta);
    if (!Object.keys(patch).length) return { meta: c.meta };
    const meta = await store.update(c.K.meta, patch);
    await store.commit(c.K, [], { k: 'd', id: 'meta', v: meta, by: c.who.uuid });
    return { meta };
  });

  routes.put('/api/d/:desk/cfg/:kind', async (req) => {
    const c = await agentContext(req, { admin: true });
    const kind = req.params.kind;
    if (!CONFIG_KINDS.includes(kind)) fail(404, 'not_found', 'Unknown settings');
    const value = validateConfig(kind, req.body?.value);
    await store.commit(c.K, [{ key: c.K.cfg(kind), value }], { k: 'c', id: kind, v: value, by: c.who.uuid });
    return { value };
  });

  routes.delete('/api/d/:desk', async (req) => {
    const c = await agentContext(req, { owner: true, allowDeleted: true });
    if (!c.meta.deleted) await store.update(c.K.meta, { deleted: store.now() });
    // The settings and member list go last, so the owner can keep calling
    // until everything else is gone.
    const keys = await store.keysUnder(c.K.prefix, { max: 2000 });
    const rest = keys.filter((k) => k !== c.K.meta && k !== c.K.members);
    await store.delMany(rest);
    const done = keys.length < 2000;
    if (done) {
      // The desk's attachments go with it.
      if (env.fs?.delete) await env.fs.delete(`help-desk/${c.desk}`, { recursive: true }).catch(() => {});
      await store.delMany([c.K.members, c.K.meta]);
    }
    return { remaining: !done };
  });

  /* -------------------------------------------------------------- sync */

  routes.get('/api/d/:desk/sync', async (req) => {
    const c = await agentContext(req);
    const since = Math.max(0, Number(req.query?.since) || 0);
    const head = Number(await store.get(c.K.rev)) || 0;
    // sweptAt is a cheap first check; the counter makes sure only one of
    // several agents syncing at the same moment runs the sweep.
    if (store.now() - (c.meta.sweptAt || 0) > SWEEP_EVERY && await store.allow(c.K.rate('sweep', 'auto-close'), 1, Math.ceil(SWEEP_EVERY / 1000))) {
      await store.update(c.K.meta, { sweptAt: store.now() });
      await autoClose(env, c.desk, c.meta).catch(() => 0);
    }
    if (since >= head) return { rev: head, head, changes: [] };
    if (head - since > SYNC_WINDOW) return { rev: head, head, reset: true, changes: [] };
    const keys = [];
    for (let r = since + 1; r <= head; r++) keys.push(c.K.change(r));
    const values = await store.getMany(keys);
    const changes = [];
    let rev = since;
    for (const v of values) {
      if (!v) break; // written by a request still in flight; read it next time
      changes.push(v);
      rev = v.r;
    }
    return { rev, head, changes, gap: rev < head };
  });

  const KIND_PREFIX = { tickets: 'ticketPrefix', users: 'userPrefix', orgs: 'orgPrefix', articles: 'articlePrefix' };

  /**
   * A listing tells the reader which revision it includes, and the reader
   * replays the change feed from there. A write that has taken a revision
   * but not yet stored its record would be missed both ways, so wait (a
   * little) for the latest entries to land before reading. Entries still
   * missing are expired or failed writes; they are remembered for a minute
   * so the next listing does not wait for them again.
   */
  const missingEntries = new Map();
  async function settledRev(c) {
    const rev = Number(await store.get(c.K.rev)) || 0;
    const known = missingEntries.get(c.desk);
    const skip = known && known.until > store.now() ? known.revs : new Set();
    let open = [];
    for (let r = Math.max(1, rev - 9); r <= rev; r++) if (!skip.has(r)) open.push(r);
    for (let attempt = 0; open.length && attempt < 4; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 150));
      const found = await store.getMany(open.map((r) => c.K.change(r)));
      open = open.filter((_, i) => !found[i]);
    }
    if (open.length) missingEntries.set(c.desk, { revs: new Set([...skip, ...open]), until: store.now() + 60000 });
    return rev;
  }

  routes.get('/api/d/:desk/records/:kind', async (req) => {
    const c = await agentContext(req);
    // Own keys only: "__proto__" or "constructor" must not reach a listing.
    const prop = Object.hasOwn(KIND_PREFIX, req.params.kind) ? KIND_PREFIX[req.params.kind] : null;
    if (!prop) fail(404, 'not_found', 'Unknown records');
    const rev = req.query?.cursor ? null : await settledRev(c);
    const page = await store.page(c.K[prop], { limit: 500, cursor: req.query?.cursor || undefined });
    return { items: page.items.map((i) => i.value).filter(Boolean), cursor: page.cursor, rev };
  });

  /* ----------------------------------------------------------- tickets */

  routes.post('/api/d/:desk/tickets', async (req) => {
    const c = await agentContext(req);
    const res = await createTicket(env, c.desk, c, req.body || {}, c.actor);
    return { ticket: res.ticket, events: res.events, requester: res.requester, notified: res.notified };
  });

  routes.get('/api/d/:desk/tickets/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const ticket = await store.get(c.K.ticket(id));
    if (!ticket) fail(404, 'not_found', 'That ticket does not exist');
    const events = await ticketEvents(store, c.K, id);
    return { ticket, events };
  });

  routes.post('/api/d/:desk/tickets/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const body = req.body || {};
    const res = await updateTicket(env, c.desk, c, id, { patch: body.patch, comment: body.comment, macro: body.macro || null }, c.actor);
    return res;
  });

  async function setFlags(c, id, flags, field) {
    const before = await store.get(c.K.ticket(id));
    if (!before) fail(404, 'not_found', 'That ticket does not exist');
    const now = store.now();
    const ticket = await writeTicket(store, c.K, id, { ...flags, updatedAt: now, updatedBy: c.who.uuid });
    // Every flag that actually changed (a restore can clear spam, the trash
    // or both); `field` names the one the action is about when none did.
    const changes = Object.keys(flags).filter((f) => !!before[f] !== !!ticket[f]).map((f) => ({ field: f, from: before[f] ?? null, to: ticket[f] ?? null }));
    const ev = {
      id: eventId(now), ticket: id, kind: 'change', at: now, by: c.actor,
      changes: changes.length ? changes : [{ field, from: before[field] ?? null, to: ticket[field] ?? null }],
    };
    // Solved tickets in the trash or spam do not wait to be closed; restored ones do again.
    const records = [{ key: eventKey(c.K, id, ev.id), value: ev }];
    if (ticket.status === 'solved' && !ticket.deleted && !ticket.spam) records.push({ key: c.K.solved(id), value: ticket.solvedAt || now });
    await store.commit(c.K, records, { k: 't', id, v: ticket, by: c.who.uuid, ev: { byType: 'agent' } });
    if (ticket.deleted || ticket.spam) await store.del(c.K.solved(id)).catch(() => {});
    return ticket;
  }

  routes.post('/api/d/:desk/tickets/:id/delete', async (req) => {
    const c = await agentContext(req);
    return { ticket: await setFlags(c, num(req.params.id), { deleted: store.now() }, 'deleted') };
  });

  routes.post('/api/d/:desk/tickets/:id/restore', async (req) => {
    const c = await agentContext(req);
    return { ticket: await setFlags(c, num(req.params.id), { deleted: null, spam: false }, 'deleted') };
  });

  routes.post('/api/d/:desk/tickets/:id/spam', async (req) => {
    const c = await agentContext(req);
    return { ticket: await setFlags(c, num(req.params.id), { spam: req.body?.spam !== false }, 'spam') };
  });

  routes.delete('/api/d/:desk/tickets/:id', async (req) => {
    const c = await agentContext(req, { admin: true });
    const id = num(req.params.id);
    const ticket = await store.get(c.K.ticket(id));
    if (!ticket) return { ok: true };
    if (!ticket.deleted) fail(409, 'not_deleted', 'Move the ticket to the trash before deleting it for good');
    const events = await store.all(c.K.eventPrefix(id), { max: 10000 });
    // Deleted for good includes the files attached to it.
    const fileIds = [...new Set(events.flatMap((e) => (e.value?.attachments || []).map((a) => a?.id)).filter((f) => isId(f, 8, 40)))];
    const files = (await store.getMany(fileIds.map((f) => c.K.file(f)))).filter(Boolean);
    if (env.fs?.delete) await Promise.all(files.map((f) => env.fs.delete(f.path).catch(() => {})));
    await store.delMany([...events.map((e) => e.key), ...fileIds.map((f) => c.K.file(f)), c.K.requesterTicket(ticket.requester, id), c.K.solved(id)]);
    await store.del(c.K.ticket(id));
    await store.commit(c.K, [], { k: 't', id, v: null, by: c.who.uuid });
    return { ok: true };
  });

  routes.post('/api/d/:desk/tickets-bulk', async (req) => {
    const c = await agentContext(req);
    if (!Array.isArray(req.body?.ids)) throw new ValidationError('Choose the tickets to change', 'ids');
    const ids = [...new Set(req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
    const action = req.body?.action || 'update';
    const results = [];
    for (const id of ids) {
      try {
        if (action === 'delete') results.push({ id, ticket: await setFlags(c, id, { deleted: store.now() }, 'deleted') });
        else if (action === 'restore') results.push({ id, ticket: await setFlags(c, id, { deleted: null, spam: false }, 'deleted') });
        else if (action === 'spam') results.push({ id, ticket: await setFlags(c, id, { spam: true }, 'spam') });
        else {
          const res = await updateTicket(env, c.desk, c, id, { patch: req.body?.patch, comment: req.body?.comment }, c.actor);
          results.push({ id, ticket: res.ticket });
        }
      } catch (e) {
        results.push({ id, error: errorBody(e).body.message });
      }
    }
    return { results };
  });

  routes.post('/api/d/:desk/tickets/:id/merge', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const into = num(req.body?.into);
    if (id === into) throw new ValidationError('A ticket cannot be merged into itself', 'into');
    const [source, target] = await store.getMany([c.K.ticket(id), c.K.ticket(into)]);
    if (!source || !target) fail(404, 'not_found', 'One of the tickets no longer exists');
    if (target.status === 'closed') fail(409, 'closed', 'Closed tickets cannot receive merges');
    if (source.status === 'closed') fail(409, 'closed', 'Closed tickets cannot be merged');
    if (source.deleted || source.spam || target.deleted || target.spam) fail(409, 'unavailable', 'Tickets in the trash or marked as spam cannot be merged');
    if (source.mergedInto) fail(409, 'merged', 'This ticket was already merged'); 
    const publicNote = req.body?.public !== false;
    const sourceText = cleanText(req.body?.sourceComment, 4000) || `This request was closed and merged into request #${into} "${target.subject}".`;
    const targetText = cleanText(req.body?.targetComment, 4000) || `Request #${id} "${source.subject}" was closed and merged into this request.`;
    await updateTicket(env, c.desk, c, into, {
      comment: { html: textToHtml(targetText), public: publicNote },
      patch: { tags: [...new Set([...(target.tags || []), ...(source.tags || [])])] },
    }, c.actor);
    const res = await updateTicket(env, c.desk, c, id, {
      comment: { html: textToHtml(sourceText), public: publicNote },
      patch: { status: 'solved' },
      system: { mergedInto: into },
      force: true,
    }, c.actor);
    const now = store.now();
    const ticket = await writeTicket(store, c.K, id, { status: 'closed', closedAt: now, mergedInto: into });
    await store.commit(c.K, [], { k: 't', id, v: ticket, by: c.who.uuid, ev: { byType: 'agent', status: 'closed' } });
    await store.del(c.K.solved(id)).catch(() => {});
    return { ticket, target: into, events: res.events };
  });

  routes.post('/api/d/:desk/tickets/:id/presence', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const now = store.now();
    const mine = { uuid: c.who.uuid, name: c.actor.name, typing: !!req.body?.typing, at: now };
    if (req.body?.leave) await store.del(c.K.presence(id, c.who.uuid)).catch(() => {});
    else await store.set(c.K.presence(id, c.who.uuid), mine, Math.floor(now / 1000) + PRESENCE_TTL_SECONDS);
    const page = await store.page(c.K.presencePrefix(id), { limit: 50 });
    const viewers = page.items
      .map((i) => i.value)
      .filter((v) => v && v.uuid !== c.who.uuid && now - v.at < PRESENCE_TTL_SECONDS * 1000);
    return { viewers };
  });

  /**
   * Received email, read from the owner's Puter mailbox by their browser.
   * A message whose subject carries a request number continues that request
   * when it comes from its requester or a CC; anything else opens a new one.
   * Each message is imported once.
   */
  routes.post('/api/d/:desk/email/import', async (req) => {
    const c = await agentContext(req, { admin: true });
    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(0, 25);
    const results = [];
    for (const raw of messages) {
      const m = cleanMessage(raw);
      if (!m) {
        results.push({ status: 'skipped', reason: 'invalid' });
        continue;
      }
      const seenKey = `${c.K.prefix}mi:${(await sha256(m.id)).slice(0, 32)}`;
      if (await store.get(seenKey)) {
        results.push({ id: m.id, status: 'duplicate' });
        continue;
      }
      try {
        const attachments = m.attachments.filter((a) => a && typeof a.id === 'string');
        let requester = await findUserByEmail(store, c.K, m.from);
        const number = ticketNumberFrom(m.subject);
        const existing = number ? await store.get(c.K.ticket(number)) : null;
        const sender = requester?.id;
        const continues = existing && !existing.deleted && existing.status !== 'closed' &&
          ((sender && existing.requester === sender) || (existing.ccs || []).includes(m.from));
        if (requester?.suspended && continues) {
          // A suspended customer's reply must not reopen their ticket.
          results.push({ id: m.id, status: 'skipped', reason: 'suspended' });
        } else if (continues) {
          const actor = { type: 'customer', id: null, userId: sender || null, name: requester?.name || m.name };
          const res = await updateTicket(env, c.desk, c, number, { comment: { html: textToHtml(m.text), public: true, attachments }, via: 'email' }, actor);
          results.push({ id: m.id, status: 'appended', ticket: res.ticket });
        } else {
          if (!requester) requester = await createUser(store, c.K, { name: m.name, email: m.from }, c.actor);
          const actor = { type: 'customer', id: null, userId: requester.id, name: requester.name };
          const res = await createTicket(env, c.desk, c, {
            subject: cleanSubject(m.subject),
            requester: requester.id,
            comment: { html: textToHtml(m.text), public: true, attachments },
            via: 'email',
            // CCs from an inbound message are not copied: the sender chooses
            // them, and every CC would receive the desk's notifications.
            tags: existing && existing.status === 'closed' ? ['follow_up'] : [],
            // A suspended customer's new request goes to Suspended tickets.
            spam: !!requester.suspended,
          }, actor);
          results.push(requester.suspended
            ? { id: m.id, status: 'skipped', reason: 'suspended', ticket: res.ticket }
            : { id: m.id, status: 'created', ticket: res.ticket, requester });
        }
        await store.set(seenKey, 1, Math.floor(store.now() / 1000) + 180 * 86400);
      } catch (e) {
        results.push({ id: m.id, status: 'failed', reason: errorBody(e).body.message });
      }
    }
    return { results };
  });

  /* ------------------------------------------------------------- files */

  function safeName(name) {
    return cleanLine(name, 120).replace(/[\\/:*?"<>|]+/g, '_') || 'file';
  }

  routes.post('/api/d/:desk/files', async (req) => {
    const c = await agentContext(req);
    if (!env.fs) fail(501, 'no_files', 'File storage is not available');
    const blob = req.raw;
    if (!blob || typeof blob.size !== 'number') throw new ValidationError('No file was sent', 'file');
    if (blob.size > LIMITS.attachment) throw new ValidationError('Files can be up to 20 MB', 'file');
    let name = 'file';
    try {
      name = safeName(decodeURIComponent(req.headers?.['x-file-name'] || 'file'));
    } catch {
      /* keep default */
    }
    const id = randomId(16);
    // Only types a browser cannot run are kept; anything else is served as bytes.
    const claimed = cleanLine(req.headers?.['content-type'] || blob.type, 100).toLowerCase();
    const type = SAFE_FILE_TYPES.has(claimed) ? claimed : 'application/octet-stream';
    const path = `help-desk/${c.desk}/files/${id}/${name}`;
    const item = await env.fs.write(path, blob, { createMissingParents: true, overwrite: true });
    const meta = { id, name, size: blob.size, type, path: item?.path || path, by: c.who.uuid, at: store.now() };
    await store.set(c.K.file(id), meta);
    return { id, name, size: blob.size, type };
  });

  async function fileResponse(meta) {
    const blob = await env.fs.read(meta.path);
    const type = SAFE_FILE_TYPES.has(meta.type) ? meta.type : 'application/octet-stream';
    const disposition = type === 'application/octet-stream' ? 'attachment' : 'inline';
    return new Response(blob, {
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'",
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  routes.get('/api/d/:desk/files/:fid', async (req) => {
    const c = await agentContext(req);
    if (!env.fs) fail(501, 'no_files', 'File storage is not available');
    const meta = isId(req.params.fid, 8, 40) ? await store.get(c.K.file(req.params.fid)) : null;
    if (!meta) fail(404, 'not_found', 'That file no longer exists');
    return fileResponse(meta);
  });

  /* --------------------------------------------------------- customers */

  function userPatch(body) {
    const out = {};
    if ('name' in body) {
      const n = cleanLine(body.name, LIMITS.name);
      if (!n) throw new ValidationError('A customer needs a name', 'name');
      out.name = n;
    }
    if ('email' in body) {
      if (body.email && !isEmail(String(body.email).trim().toLowerCase())) throw new ValidationError('That email address does not look right', 'email');
      out.email = normEmail(body.email) || null;
    }
    if ('phone' in body) out.phone = cleanLine(body.phone, 40) || null;
    if ('org' in body) out.org = Number(body.org) || null;
    if ('tags' in body) out.tags = normTags(body.tags);
    if ('notes' in body) out.notes = cleanText(body.notes, LIMITS.notes);
    if ('locale' in body) out.locale = cleanLine(body.locale, 20) || null;
    if ('tz' in body) out.tz = cleanLine(body.tz, 60) || null;
    if ('suspended' in body) out.suspended = !!body.suspended;
    return out;
  }

  routes.post('/api/d/:desk/users', async (req) => {
    const c = await agentContext(req);
    const body = req.body || {};
    const email = normEmail(body.email);
    if (body.email && !email) throw new ValidationError('That email address does not look right', 'email');
    if (email) {
      const existing = await findUserByEmail(store, c.K, email);
      if (existing) fail(409, 'exists', `${existing.name} already uses that email address`, { current: existing });
    }
    return { user: await createUser(store, c.K, body, c.actor) };
  });

  routes.post('/api/d/:desk/users/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const before = await store.get(c.K.user(id));
    if (!before) fail(404, 'not_found', 'That customer no longer exists');
    const patch = userPatch(req.body || {});
    if ('email' in patch && patch.email !== before.email && patch.email) {
      const other = await store.get(c.K.userByEmail(patch.email));
      if (other && other !== id) fail(409, 'exists', 'Another customer already uses that email address');
    }
    const user = await store.update(c.K.user(id), { ...patch, updatedAt: store.now() });
    const records = [];
    if (patch.email && patch.email !== before.email) records.push({ key: c.K.userByEmail(patch.email), value: id });
    await store.commit(c.K, records, { k: 'u', id, v: user, by: c.who.uuid });
    if ('email' in patch && before.email && patch.email !== before.email) await store.del(c.K.userByEmail(before.email)).catch(() => {});
    return { user };
  });

  routes.delete('/api/d/:desk/users/:id', async (req) => {
    const c = await agentContext(req, { admin: true });
    const id = num(req.params.id);
    const user = await store.get(c.K.user(id));
    if (!user) return { ok: true };
    const page = await store.page(c.K.requesterPrefix(id), { limit: 1 });
    if (page.items.length) fail(409, 'has_tickets', 'This customer has tickets. Delete or reassign them first.');
    await store.delMany([user.email ? c.K.userByEmail(user.email) : null, user.puter ? c.K.userByUuid(user.puter) : null].filter(Boolean));
    await store.del(c.K.user(id));
    await store.commit(c.K, [], { k: 'u', id, v: null, by: c.who.uuid });
    return { ok: true };
  });

  routes.post('/api/d/:desk/users-import', async (req) => {
    const c = await agentContext(req, { admin: true });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 200) : [];
    const created = [];
    let skipped = 0;
    for (const row of rows) {
      const email = normEmail(row?.email);
      if (!email && !cleanLine(row?.name)) {
        skipped++;
        continue;
      }
      if (email && (await store.get(c.K.userByEmail(email)))) {
        skipped++;
        continue;
      }
      try {
        created.push(await createUser(store, c.K, row, c.actor));
      } catch {
        skipped++;
      }
    }
    return { created, skipped };
  });

  /* ----------------------------------------------------- organizations */

  function orgPatch(body) {
    const out = {};
    if ('name' in body) {
      const n = cleanLine(body.name, 120);
      if (!n) throw new ValidationError('An organization needs a name', 'name');
      out.name = n;
    }
    if ('domains' in body) out.domains = [...new Set((Array.isArray(body.domains) ? body.domains : String(body.domains || '').split(/[\s,]+/)).map(normDomain).filter(Boolean))].slice(0, 20);
    if ('notes' in body) out.notes = cleanText(body.notes, LIMITS.notes);
    if ('tags' in body) out.tags = normTags(body.tags);
    if ('group' in body) out.group = cleanLine(body.group, 40) || null;
    return out;
  }

  /** Each email domain matches one organization: refuse one another has. */
  async function checkDomains(c, id, domains) {
    const owners = await store.getMany((domains || []).map((d) => c.K.orgByDomain(d)));
    const taken = owners.map((o, i) => [domains[i], o]).filter(([, o]) => o && o !== id);
    if (!taken.length) return;
    const orgs = await store.getMany(taken.map(([, o]) => c.K.org(o)));
    const clash = taken.findIndex((_, i) => orgs[i]);
    if (clash >= 0) throw new ValidationError(`${taken[clash][0]} already belongs to ${orgs[clash].name}`, 'domains');
  }

  async function syncDomains(c, id, before, after) {
    const old = new Set(before || []);
    const now = new Set(after || []);
    const records = [...now].filter((d) => !old.has(d)).map((d) => ({ key: c.K.orgByDomain(d), value: id }));
    if (records.length) await store.setMany(records);
    const gone = [...old].filter((d) => !now.has(d));
    for (const d of gone) {
      if ((await store.get(c.K.orgByDomain(d))) === id) await store.del(c.K.orgByDomain(d));
    }
  }

  routes.post('/api/d/:desk/orgs', async (req) => {
    const c = await agentContext(req);
    const patch = orgPatch({ name: '', ...req.body });
    await checkDomains(c, null, patch.domains);
    const seq = await store.incr(c.K.seq, { o: 1 });
    const now = store.now();
    const org = { id: seq.o, name: patch.name, domains: patch.domains || [], notes: patch.notes || '', tags: patch.tags || [], group: patch.group || null, createdAt: now, updatedAt: now };
    await store.commit(c.K, [{ key: c.K.org(org.id), value: org }], { k: 'o', id: org.id, v: org, by: c.who.uuid });
    await syncDomains(c, org.id, [], org.domains);
    return { org };
  });

  routes.post('/api/d/:desk/orgs/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const before = await store.get(c.K.org(id));
    if (!before) fail(404, 'not_found', 'That organization no longer exists');
    const patch = orgPatch(req.body || {});
    if ('domains' in patch) await checkDomains(c, id, patch.domains);
    const org = await store.update(c.K.org(id), { ...patch, updatedAt: store.now() });
    await store.commit(c.K, [], { k: 'o', id, v: org, by: c.who.uuid });
    if ('domains' in patch) await syncDomains(c, id, before.domains, org.domains);
    return { org };
  });

  routes.delete('/api/d/:desk/orgs/:id', async (req) => {
    const c = await agentContext(req, { admin: true });
    const id = num(req.params.id);
    const org = await store.get(c.K.org(id));
    if (!org) return { ok: true };
    await syncDomains(c, id, org.domains, []);
    await store.del(c.K.org(id));
    await store.commit(c.K, [], { k: 'o', id, v: null, by: c.who.uuid });
    // Customers who belonged to it no longer do.
    const users = await store.all(c.K.userPrefix, { max: 20000 });
    for (const { value: u } of users) {
      if (u?.org !== id) continue;
      const user = await store.update(c.K.user(u.id), { org: null, updatedAt: store.now() });
      await store.commit(c.K, [], { k: 'u', id: u.id, v: user, by: c.who.uuid });
    }
    return { ok: true };
  });

  /* ---------------------------------------------------- knowledge base */

  function articlePatch(body) {
    const out = {};
    if ('title' in body) {
      const t = cleanLine(body.title, 200);
      if (!t) throw new ValidationError('Give the article a title', 'title');
      out.title = t;
    }
    if ('section' in body) out.section = cleanLine(body.section, 40) || null;
    if ('status' in body) out.status = body.status === 'published' ? 'published' : 'draft';
    if ('labels' in body) out.labels = normTags(body.labels);
    if ('promoted' in body) out.promoted = !!body.promoted;
    return out;
  }

  async function saveArticle(c, id, patch, body) {
    const now = store.now();
    const records = [];
    if (typeof body === 'string') {
      const html = sanitizeHtml(body, { maxLength: LIMITS.articleBody });
      patch.excerpt = preview(html, 240);
      patch.words = htmlToText(html).split(/\s+/).filter(Boolean).length;
      records.push({ key: c.K.articleBody(id), value: { html } });
    }
    patch.updatedAt = now;
    patch.updatedBy = c.who.uuid;
    const existing = await store.get(c.K.article(id));
    const article = existing ? await store.update(c.K.article(id), patch) : { id, createdAt: now, author: c.who.uuid, views: 0, up: 0, down: 0, labels: [], status: 'draft', promoted: false, ...patch };
    if (!existing) records.push({ key: c.K.article(id), value: article });
    await store.commit(c.K, records, { k: 'a', id, v: article, by: c.who.uuid });
    articleCache.delete(c.desk);
    return article;
  }

  routes.post('/api/d/:desk/articles', async (req) => {
    const c = await agentContext(req);
    const patch = articlePatch({ title: '', ...req.body });
    const seq = await store.incr(c.K.seq, { a: 1 });
    const article = await saveArticle(c, seq.a, patch, String(req.body?.body ?? ''));
    return { article };
  });

  routes.get('/api/d/:desk/articles/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    const [article, body] = await store.getMany([c.K.article(id), c.K.articleBody(id)]);
    if (!article) fail(404, 'not_found', 'That article no longer exists');
    return { article, body: body?.html || '' };
  });

  routes.post('/api/d/:desk/articles/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    if (!(await store.get(c.K.article(id)))) fail(404, 'not_found', 'That article no longer exists');
    const article = await saveArticle(c, id, articlePatch(req.body || {}), req.body && 'body' in req.body ? String(req.body.body ?? '') : undefined);
    return { article };
  });

  routes.delete('/api/d/:desk/articles/:id', async (req) => {
    const c = await agentContext(req);
    const id = num(req.params.id);
    await store.delMany([c.K.articleBody(id)]);
    await store.del(c.K.article(id));
    await store.commit(c.K, [], { k: 'a', id, v: null, by: c.who.uuid });
    articleCache.delete(c.desk);
    return { ok: true };
  });

  /* ------------------------------------------------------------ people */

  routes.post('/api/d/:desk/invites', async (req) => {
    const c = await agentContext(req, { admin: true });
    const role = ROLES.includes(req.body?.role) ? req.body.role : 'agent';
    const code = secret(20);
    const now = store.now();
    const expiresAt = now + 7 * 24 * 3600 * 1000;
    const invite = { code, role, by: c.who.uuid, byName: c.actor.name, at: now, expiresAt, note: cleanLine(req.body?.note, 120) };
    await store.set(c.K.invite(code), invite, Math.floor(expiresAt / 1000));
    return { invite };
  });

  routes.get('/api/d/:desk/invites', async (req) => {
    const c = await agentContext(req, { admin: true });
    const page = await store.page(`${c.K.prefix}inv:`, { limit: 200 });
    return { invites: page.items.map((i) => i.value).filter((v) => v && v.expiresAt > store.now()) };
  });

  routes.delete('/api/d/:desk/invites/:code', async (req) => {
    const c = await agentContext(req, { admin: true });
    if (/^[a-z0-9]{10,40}$/.test(req.params.code)) await store.del(c.K.invite(req.params.code));
    return { ok: true };
  });

  /** What an invite link is for, so the join screen can say it. */
  routes.get('/api/invite/:desk/:code', async (req) => {
    const desk = deskId(req.params.desk);
    await identity(req);
    const K = deskKeys(desk);
    const code = String(req.params.code || '');
    if (!/^[a-z0-9]{10,40}$/.test(code)) fail(404, 'bad_invite', 'This invite link is not valid');
    const [meta, invite] = await store.getMany([K.meta, K.invite(code)]);
    if (!meta || meta.deleted || !invite || invite.expiresAt < store.now()) fail(404, 'bad_invite', 'This invite link has expired or was already used. Ask an administrator for a new one.');
    return { name: meta.name, role: invite.role, by: invite.byName || null, expiresAt: invite.expiresAt };
  });

  routes.post('/api/join/:desk', async (req) => {
    const desk = deskId(req.params.desk);
    const who = await identity(req);
    const K = deskKeys(desk);
    const code = String(req.body?.code || '');
    await rateLimit(K, 'join', who.uuid, 10, 600);
    const [meta, members, invite, groups] = await store.getMany([K.meta, K.members, /^[a-z0-9]{10,40}$/.test(code) ? K.invite(code) : `${K.prefix}inv:none`, K.cfg('groups')]);
    if (!meta || meta.deleted) fail(404, 'no_desk', 'This help desk does not exist');
    if (members?.[who.uuid]?.active) return { desk, meta, me: members[who.uuid], already: true };
    if (!invite || invite.expiresAt < store.now()) fail(403, 'bad_invite', 'This invite link has expired or was already used. Ask an administrator for a new one.');
    const now = store.now();
    const me = {
      uuid: who.uuid, username: who.username || '', name: cleanLine(req.body?.name, 80) || who.username || 'Agent',
      // New agents join the default group, if the desk still has it.
      role: invite.role, groups: (groups || []).some((g) => g.id === 'support') ? ['support'] : [], active: true, joinedAt: now, invitedBy: invite.by,
    };
    await store.update(K.members, { [who.uuid]: me });
    await store.del(K.invite(code));
    await memberChange(K, who.uuid);
    return { desk, meta, me };
  });

  routes.post('/api/d/:desk/members/:uuid', async (req) => {
    const c = await agentContext(req);
    const uuid = req.params.uuid;
    const target = Object.hasOwn(c.members, uuid) ? c.members[uuid] : null;
    if (!target) fail(404, 'not_found', 'That person is not on this help desk');
    const self = uuid === c.who.uuid;
    const isAdmin = c.me.role !== 'agent';
    if (!self && !isAdmin) fail(403, 'forbidden', 'Only administrators can change other agents');
    const body = req.body || {};
    const patch = {};
    if ('name' in body) patch[`${uuid}.name`] = cleanLine(body.name, 80) || target.name;
    if (isAdmin && 'groups' in body) {
      const ids = new Set((c.cfg.groups || []).map((g) => g.id));
      patch[`${uuid}.groups`] = (Array.isArray(body.groups) ? body.groups : []).filter((g) => ids.has(g));
    }
    if (isAdmin && !self && target.role !== 'owner') {
      if ('role' in body && ROLES.includes(body.role)) patch[`${uuid}.role`] = body.role;
      if ('active' in body) patch[`${uuid}.active`] = !!body.active;
    }
    if ('signature' in body) patch[`${uuid}.signature`] = sanitizeHtml(body.signature, { maxLength: 4000 });
    if (!Object.keys(patch).length) return { member: target };
    await store.update(c.K.members, patch);
    const members = await memberChange(c.K, c.who.uuid);
    return { member: members[uuid] };
  });

  routes.delete('/api/d/:desk/members/:uuid', async (req) => {
    const uuid = req.params.uuid;
    const c = await agentContext(req, { admin: req.params.uuid !== (await req.who?.())?.uuid });
    const target = Object.hasOwn(c.members, uuid) ? c.members[uuid] : null;
    if (!target) return { ok: true };
    if (target.role === 'owner') fail(409, 'owner', 'The owner cannot be removed');
    await store.remove(c.K.members, uuid);
    await memberChange(c.K, c.who.uuid);
    return { ok: true };
  });

  /* ------------------------------------------------------------ export */

  routes.get('/api/d/:desk/export/events', async (req) => {
    const c = await agentContext(req, { admin: true });
    const page = await store.page(`${c.K.prefix}e:`, { limit: 500, cursor: req.query?.cursor || undefined });
    return { items: page.items.map((i) => i.value).filter(Boolean), cursor: page.cursor };
  });

  /* ------------------------------------------------------- help center */

  function publicTicket(t, meta) {
    return {
      id: t.id, subject: t.subject, status: t.status === 'new' ? 'open' : t.status === 'hold' ? 'open' : t.status,
      // The rating's comment too, so changing a rating starts from it.
      createdAt: t.createdAt, updatedAt: t.updatedAt, solvedAt: t.solvedAt, csat: t.csat ? { score: t.csat.score, comment: t.csat.comment || '' } : null,
      csatEnabled: !!meta.csat?.enabled, followUp: t.followUp || null,
    };
  }

  /**
   * A message as the requester sees it. On a request filed by an unverified
   * sender (anyone can type an existing customer's email), the stored
   * customer's name is left out so the form cannot be used to look it up.
   */
  function publicEvent(e, members, { hideCustomer = false } = {}) {
    const agent = e.by?.type === 'agent';
    return {
      id: e.id, at: e.at, html: e.html, attachments: e.attachments || [],
      by: agent ? { type: 'agent', name: members[e.by.id]?.name || e.by.name || 'Support' } : { type: e.by?.type || 'customer', name: hideCustomer ? '' : e.by?.name || '' },
    };
  }

  /** The requester behind a help center call: a link key or their Puter account. */
  async function requestAccess(req, p, id) {
    const ticket = await store.get(p.K.ticket(id));
    if (!ticket || ticket.deleted || ticket.spam) fail(404, 'not_found', 'We could not find that request');
    const key = String(req.query?.key || req.body?.key || '');
    if (key && key.length >= 16 && key === ticket.key) return ticket;
    const who = await req.who?.().catch(() => null);
    if (who?.uuid && ticket.submitterPuter && ticket.submitterPuter === who.uuid) return ticket;
    fail(403, 'forbidden', 'This link is not valid for that request');
  }

  async function publishedArticles(p) {
    const hit = articleCache.get(p.desk);
    if (hit && hit.until > store.now()) return hit.items;
    const rows = await store.all(p.K.articlePrefix, { max: 2000 });
    const items = rows.map((r) => r.value).filter((a) => a && a.status === 'published')
      .map(({ id, title, section, excerpt, labels, updatedAt, promoted, up, down }) => ({ id, title, section, excerpt, labels, updatedAt, promoted, up, down }));
    articleCache.set(p.desk, { items, until: store.now() + 60 * 1000 });
    return items;
  }

  routes.get('/p/:desk', async (req) => {
    const p = await portalContext(req);
    const [kb, fields] = await store.getMany([p.K.cfg('kb'), p.K.cfg('fields')]);
    return {
      desk: p.desk,
      name: p.meta.name,
      portal: p.meta.portal,
      csat: !!p.meta.csat?.enabled,
      kb: kb || { categories: [], sections: [] },
      fields: (fields || []).filter((f) => f.active && f.portal).map(({ id, title, type, options, required, desc }) => ({ id, title, type, options, required, desc })),
    };
  });

  routes.get('/p/:desk/articles', async (req) => {
    const p = await portalContext(req);
    return { articles: await publishedArticles(p) };
  });

  routes.get('/p/:desk/articles/:id', async (req) => {
    const p = await portalContext(req);
    const id = num(req.params.id);
    const [article, body] = await store.getMany([p.K.article(id), p.K.articleBody(id)]);
    if (!article || article.status !== 'published') fail(404, 'not_found', 'That article is not available');
    const viewKey = p.K.rate('view', (await sha256(`${ipOf(req)}:${id}`)).slice(0, 20));
    store.allow(viewKey, 1, 3600).then((first) => (first ? store.incr(p.K.article(id), { views: 1 }) : null)).catch(() => {});
    const { author, updatedBy, ...rest } = article;
    return { article: rest, body: body?.html || '' };
  });

  routes.post('/p/:desk/articles/:id/vote', async (req) => {
    const p = await portalContext(req);
    const id = num(req.params.id);
    await rateLimit(p.K, 'vote', `${ipOf(req)}:${id}`, 3, 3600);
    const article = await store.get(p.K.article(id));
    if (!article || article.status !== 'published') fail(404, 'not_found', 'That article is not available');
    const next = await store.incr(p.K.article(id), { [req.body?.up ? 'up' : 'down']: 1 });
    return { up: next.up || 0, down: next.down || 0 };
  });

  routes.post('/p/:desk/requests', async (req) => {
    const p = await portalContext(req);
    const body = req.body || {};
    const who = await req.who?.().catch(() => null);
    if (p.meta.portal?.signInRequired && !who?.uuid) fail(401, 'unauthorized', 'Sign in to send a request');
    await rateLimit(p.K, 'req', ipOf(req), 10, 3600);
    const email = normEmail(body.email);
    if (!email) throw new ValidationError('Enter a valid email address so we can reply', 'email');
    const name = cleanLine(body.name, LIMITS.name) || email.split('@')[0];
    const description = cleanText(body.description, 20000).trim();
    if (!description) throw new ValidationError('Describe your request', 'description');
    // Checked before a customer is created for a new address.
    if (!cleanLine(body.subject, LIMITS.subject)) throw new ValidationError('Add a subject', 'subject');
    const portalFields = p.cfg.fields.filter((x) => x.active && x.portal);
    if (body.fields !== undefined && (!body.fields || typeof body.fields !== 'object')) throw new ValidationError('The request fields are not valid', 'fields');
    const missing = portalFields.find((f) => f.required && cleanFieldValue(f, body.fields?.[f.id]) === undefined);
    if (missing) throw new ValidationError(`${missing.title} is required`, `field:${missing.id}`);
    let requester = await findUserByEmail(store, p.K, email);
    // Anyone can type any address, so a request filed under a customer who
    // already exists is marked for agents as coming from an unverified sender.
    const unverified = !!requester;
    if (!requester) requester = await createUser(store, p.K, { name, email }, { type: 'customer', id: null });
    const actor = { type: 'customer', id: null, userId: requester.id, name: requester.name };
    const fields = {};
    for (const f of portalFields) {
      if (body.fields && f.id in body.fields) fields[f.id] = body.fields[f.id];
    }
    const res = await createTicket(env, p.desk, p, {
      subject: body.subject,
      requester: requester.id,
      comment: { html: textToHtml(description), public: true },
      via: 'portal',
      fields,
      unverified,
      submitterPuter: who?.uuid || null,
      // Accepted as usual so a suspended sender learns nothing, but filed as spam.
      spam: !!requester.suspended,
    }, actor);
    if (requester.suspended) return { id: null, key: null, accepted: true };
    return { id: res.ticket.id, key: res.ticket.key };
  });

  routes.get('/p/:desk/requests/:id', async (req) => {
    const p = await portalContext(req);
    const id = num(req.params.id);
    const ticket = await requestAccess(req, p, id);
    const [events, requester] = await Promise.all([ticketEvents(store, p.K, id), store.get(p.K.user(ticket.requester))]);
    const hideCustomer = !!ticket.unverified;
    return {
      ticket: publicTicket(ticket, p.meta),
      requester: requester ? { name: hideCustomer ? '' : requester.name, email: requester.email } : null,
      events: events.filter((e) => e.kind === 'comment' && e.public).map((e) => publicEvent(e, p.members, { hideCustomer })),
    };
  });

  routes.post('/p/:desk/requests/:id/comments', async (req) => {
    const p = await portalContext(req);
    const id = num(req.params.id);
    const ticket = await requestAccess(req, p, id);
    await rateLimit(p.K, 'reply', ipOf(req), 60, 3600);
    const text = cleanText(req.body?.body, 20000).trim();
    if (!text) throw new ValidationError('Write a reply first', 'body');
    const requester = await store.get(p.K.user(ticket.requester));
    // Like new requests, a suspended customer's reply is accepted quietly and
    // dropped: it must not reopen the ticket or start a follow-up.
    if (requester?.suspended) return { ticket: publicTicket(ticket, p.meta) };
    const actor = { type: 'customer', id: null, userId: ticket.requester, name: requester?.name || 'Customer' };
    if (ticket.status === 'closed') {
      // A closed request takes no more replies; the reply opens a follow-up.
      const res = await createTicket(env, p.desk, p, {
        subject: ticket.subject.startsWith('Re: ') ? ticket.subject : `Re: ${ticket.subject}`,
        requester: ticket.requester,
        comment: { html: textToHtml(`${text}\n\n(Follow-up to request #${ticket.id})`), public: true },
        via: 'portal',
        tags: ['follow_up'],
        submitterPuter: ticket.submitterPuter,
        unverified: ticket.unverified,
      }, actor);
      const original = await writeTicket(store, p.K, id, { followUp: res.ticket.id });
      await store.commit(p.K, [], { k: 't', id, v: original, by: null });
      return { followUp: { id: res.ticket.id, key: res.ticket.key } };
    }
    const res = await updateTicket(env, p.desk, p, id, { comment: { html: textToHtml(text), public: true } }, actor);
    return { ticket: publicTicket(res.ticket, p.meta) };
  });

  routes.post('/p/:desk/requests/:id/solve', async (req) => {
    const p = await portalContext(req);
    const id = num(req.params.id);
    const ticket = await requestAccess(req, p, id);
    if (ticket.status === 'solved' || ticket.status === 'closed') return { ticket: publicTicket(ticket, p.meta) };
    const requester = await store.get(p.K.user(ticket.requester));
    const actor = { type: 'customer', id: null, userId: ticket.requester, name: requester?.name || 'Customer' };
    const res = await updateTicket(env, p.desk, p, id, { system: { status: 'solved' } }, actor);
    return { ticket: publicTicket(res.ticket, p.meta) };
  });

  routes.post('/p/:desk/requests/:id/rate', async (req) => {
    const p = await portalContext(req);
    if (!p.meta.csat?.enabled) fail(404, 'not_found', 'Ratings are turned off');
    const id = num(req.params.id);
    const ticket = await requestAccess(req, p, id);
    if (!['solved', 'closed'].includes(ticket.status)) fail(409, 'not_solved', 'You can rate a request once it is solved');
    const score = req.body?.score === 'bad' ? 'bad' : 'good';
    const comment = cleanText(req.body?.comment, 2000);
    // The same rating again changes nothing and writes nothing.
    if (ticket.csat && ticket.csat.score === score && (ticket.csat.comment || '') === comment) return { ticket: publicTicket(ticket, p.meta) };
    await rateLimit(p.K, 'rate', `${ipOf(req)}:${id}`, 5, 3600);
    const now = store.now();
    const csat = { score, comment, at: now };
    const requester = await store.get(p.K.user(ticket.requester));
    const actor = { type: 'customer', id: null, userId: ticket.requester, name: requester?.name || 'Customer' };
    // Through the usual update, so triggers on satisfaction run and notify.
    const res = await updateTicket(env, p.desk, p, id, { csat }, actor);
    return { ticket: publicTicket(res.ticket, p.meta) };
  });

  routes.get('/p/:desk/mine', async (req) => {
    const p = await portalContext(req);
    const who = await identity(req);
    const keys = await store.keysUnder(p.K.submitterPrefix(who.uuid), { max: 500 });
    const ids = keys.map(idFromKey).filter(Boolean);
    const tickets = await store.getMany(ids.map((i) => p.K.ticket(i)));
    return {
      // The index can outlive a change of requester; the ticket has the final say.
      requests: tickets.filter((t) => t && !t.deleted && !t.spam && t.submitterPuter === who.uuid).map((t) => ({ ...publicTicket(t, p.meta), key: t.key })).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  });

  routes.get('/p/:desk/files/:fid', async (req) => {
    const p = await portalContext(req);
    const id = num(req.query?.ticket);
    await requestAccess(req, p, id);
    const fid = req.params.fid;
    if (!isId(fid, 8, 40) || !env.fs) fail(404, 'not_found', 'That file is not available');
    const events = await ticketEvents(store, p.K, id);
    const shared = events.some((e) => e.kind === 'comment' && e.public && (e.attachments || []).some((a) => a.id === fid));
    if (!shared) fail(404, 'not_found', 'That file is not available');
    const meta = await store.get(p.K.file(fid));
    if (!meta) fail(404, 'not_found', 'That file is not available');
    return fileResponse(meta);
  });

  /* ---------------------------------------------------------- dispatch */

  async function handle(req) {
    const m = routes.match(req.method, req.path);
    if (!m) return { status: 404, body: { error: 'not_found', message: 'Unknown endpoint' } };
    // Every route reads fields of an object body; anything else is refused
    // here rather than failing halfway through a route.
    const body = req.body;
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return { status: 400, body: { error: 'bad_request', message: 'The request body must be a JSON object' } };
    }
    try {
      const out = await m.route.handler({ ...req, params: m.params });
      if (typeof Response !== 'undefined' && out instanceof Response) return { response: out };
      return { status: 200, body: out ?? { ok: true } };
    } catch (e) {
      if (!(e && e.status) && options.log) options.log(e);
      return errorBody(e);
    }
  }

  return { handle, routes, env };
}
