/**
 * Ticket operations shared by the agent API, the help center and email
 * import: creating tickets, applying updates with their event trail and
 * triggers, finding or creating customers, and sending notifications.
 */
import { deskKeys } from '../shared/keys.js';
import { randomId, secret } from '../shared/ids.js';
import {
  STATUSES, PRIORITIES, TYPES, CHANNELS, LIMITS, cleanLine, normEmail, normTags, oneOf, emailDomain,
  cleanFieldValue, isUnsolved, ValidationError, cleanText,
} from '../shared/model.js';
import { sanitizeHtml, htmlToText, preview, escapeHtml, textToHtml } from '../shared/html.js';
import { matches, applyActions, renderPlaceholders } from '../shared/rules.js';
import { fail } from './http.js';

/** Fields recorded in the event trail when they change. */
const TRACKED = ['subject', 'status', 'priority', 'type', 'assignee', 'group', 'requester', 'tags', 'followers', 'ccs', 'problem', 'dueAt', 'spam'];

export function eventId(now) {
  return `${String(now).padStart(13, '0')}${randomId(4)}`;
}

export function eventKey(K, ticketId, id) {
  return `${K.eventPrefix(ticketId)}${id}`;
}

/** Customer (end user) lookups and creation. */
export async function findUserByEmail(store, K, email) {
  const id = await store.get(K.userByEmail(email));
  if (!id) return null;
  return store.get(K.user(id));
}

export async function orgForEmail(store, K, email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (await store.get(K.orgByDomain(domain))) || null;
}

/** Create a customer record. Returns the stored user. */
export async function createUser(store, K, input, by) {
  const email = normEmail(input.email);
  const name = cleanLine(input.name, LIMITS.name) || (email ? email.split('@')[0] : '');
  if (!name) throw new ValidationError('A customer needs a name or an email address', 'name');
  if (input.email && !email) throw new ValidationError('That email address does not look right', 'email');
  if (email) {
    const existing = await findUserByEmail(store, K, email);
    if (existing) return existing;
  }
  const seq = await store.incr(K.seq, { u: 1 });
  const id = seq.u;
  const now = store.now();
  const org = input.org ? Number(input.org) || null : email ? await orgForEmail(store, K, email) : null;
  const user = {
    id,
    name,
    email: email || null,
    phone: cleanLine(input.phone, 40) || null,
    org,
    tags: normTags(input.tags),
    notes: cleanText(input.notes, LIMITS.notes) || '',
    locale: cleanLine(input.locale, 20) || null,
    tz: cleanLine(input.tz, 60) || null,
    // Customers are never tied to a Puter account: an email address typed
    // into a form proves nothing about who typed it.
    puter: null,
    suspended: false,
    createdAt: now,
    updatedAt: now,
  };
  const records = [{ key: K.user(id), value: user }];
  if (email) records.push({ key: K.userByEmail(email), value: id });
  await store.commit(K, records, { k: 'u', id, v: user, by: by?.id || null });
  return user;
}

/** Resolve the requester of a new ticket: an id, or a name and email. */
export async function resolveRequester(store, K, input, by) {
  if (input && (typeof input === 'number' || typeof input === 'string') && Number(input)) {
    const user = await store.get(K.user(Number(input)));
    if (!user) throw new ValidationError('That requester no longer exists', 'requester');
    return user;
  }
  if (input && input.id) return resolveRequester(store, K, input.id, by);
  if (input && (input.email || input.name)) return createUser(store, K, input, by);
  throw new ValidationError('Choose who the ticket is for', 'requester');
}

/** Clean custom field values against the desk's field definitions. */
export function cleanFields(defs, values, base = {}) {
  const out = { ...base };
  if (!values || typeof values !== 'object') return out;
  for (const def of defs || []) {
    if (!(def.id in values)) continue;
    const v = cleanFieldValue(def, values[def.id]);
    if (v === undefined) delete out[def.id];
    else out[def.id] = v;
  }
  return out;
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  return (a ?? null) === (b ?? null);
}

export function diffTickets(before, after) {
  const changes = [];
  for (const f of TRACKED) {
    if (!sameValue(before[f], after[f])) changes.push({ field: f, from: before[f] ?? null, to: after[f] ?? null });
  }
  const bf = before.fields || {};
  const af = after.fields || {};
  for (const id of new Set([...Object.keys(bf), ...Object.keys(af)])) {
    if (!sameValue(bf[id], af[id])) changes.push({ field: `field:${id}`, from: bf[id] ?? null, to: af[id] ?? null });
  }
  return changes;
}

/**
 * Clean an agent's patch against the ticket and desk configuration. Only
 * known fields pass; ids must exist.
 */
export function cleanPatch(patch, { members, cfg, ticket }) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if ('subject' in patch) {
    const s = cleanLine(patch.subject, LIMITS.subject);
    if (!s) throw new ValidationError('The subject cannot be empty', 'subject');
    out.subject = s;
  }
  if ('status' in patch) {
    const s = oneOf(patch.status, STATUSES);
    if (!s || s === 'closed') throw new ValidationError('Choose a valid status', 'status');
    out.status = s;
  }
  if ('priority' in patch) out.priority = oneOf(patch.priority, PRIORITIES, null);
  if ('type' in patch) out.type = oneOf(patch.type, TYPES, null);
  if ('assignee' in patch) {
    const a = patch.assignee || null;
    if (a && !members[a]?.active) throw new ValidationError('That agent is not on this help desk', 'assignee');
    out.assignee = a;
  }
  if ('group' in patch) {
    const g = patch.group || null;
    if (g && !(cfg.groups || []).some((x) => x.id === g)) throw new ValidationError('That group no longer exists', 'group');
    out.group = g;
  }
  if ('tags' in patch) out.tags = normTags(patch.tags);
  if ('followers' in patch) {
    out.followers = [...new Set((Array.isArray(patch.followers) ? patch.followers : []).filter((u) => members[u]))].slice(0, 50);
  }
  if ('ccs' in patch) {
    out.ccs = [...new Set((Array.isArray(patch.ccs) ? patch.ccs : []).map(normEmail).filter(Boolean))].slice(0, 9);
  }
  if ('fields' in patch) out.fields = cleanFields(cfg.fields, patch.fields, ticket?.fields || {});
  if ('problem' in patch) out.problem = Number(patch.problem) || null;
  if ('dueAt' in patch) out.dueAt = Number(patch.dueAt) || null;
  if ('requester' in patch) {
    // Every ticket has a requester: emails, "My requests" and the index of
    // a customer's tickets all depend on it.
    const r = Number(patch.requester);
    if (!Number.isInteger(r) || r <= 0) throw new ValidationError('Choose a requester', 'requester');
    out.requester = r;
  }
  return out;
}

function commentFrom(input, { by, via, now }) {
  if (!input) return null;
  const html = sanitizeHtml(input.html ?? textToHtml(input.text || ''), { maxLength: LIMITS.comment });
  const text = htmlToText(html);
  const attachments = Array.isArray(input.attachments) ? input.attachments.slice(0, LIMITS.attachmentsPerComment).map(cleanAttachment).filter(Boolean) : [];
  if (!text && !attachments.length) return null;
  return {
    kind: 'comment',
    public: input.public !== false,
    html,
    text: text.slice(0, 20000),
    attachments,
    by,
    via,
    at: now,
  };
}

function cleanAttachment(a) {
  if (!a || typeof a.id !== 'string' || !/^[a-z0-9]{8,40}$/.test(a.id)) return null;
  return { id: a.id, name: cleanLine(a.name, 200) || 'file', size: Number(a.size) || 0, type: cleanLine(a.type, 100) || 'application/octet-stream' };
}

/**
 * Run the desk's active triggers against an update. Each trigger fires at
 * most once, in order, and sees the ticket as earlier triggers left it.
 */
export function runTriggers(triggers, { before, after, event, actor, comment, me }) {
  let t = after;
  const fired = [];
  const notifications = [];
  for (const trig of triggers || []) {
    if (!trig.active) continue;
    if (trig.event === 'created' && event !== 'created') continue;
    if (trig.event === 'updated' && event !== 'updated') continue;
    if (!matches(trig.conditions, t, { before, actor, comment, me })) continue;
    const res = applyActions(t, trig.actions, { me });
    t = res.ticket;
    fired.push({ id: trig.id, title: trig.title });
    for (const n of res.notifications) notifications.push({ ...n, trigger: trig.title });
  }
  return { ticket: t, fired, notifications };
}

export function portalLink(meta, desk, ticket) {
  if (!meta?.appUrl || !meta?.server) return '';
  return `${meta.appUrl.replace(/#.*$/, '')}#/help/${meta.server}/${desk}/requests/${ticket.id}?key=${ticket.key}`;
}

/** Send trigger notifications by email. Failures are reported, not thrown. */
export async function sendNotifications(env, { meta, desk, ticket, requester, agentName, comment, notifications }) {
  const results = [];
  if (!notifications.length) return results;
  if (!env.email || !meta.email?.enabled) {
    return notifications.map((n) => ({ to: null, ok: false, skipped: env.email ? 'disabled' : 'offline', trigger: n.trigger }));
  }
  const link = portalLink(meta, desk, ticket);
  const data = { ticket, requester, agent: { name: agentName }, desk: meta, link, commentText: comment?.text || '' };
  for (const n of notifications) {
    const to = n.kind === 'notify_requester' ? requester?.email : normEmail(n.to);
    if (!to || requester?.suspended) {
      results.push({ to: null, ok: false, skipped: 'no_email', trigger: n.trigger });
      continue;
    }
    const recipients = [to, ...(n.kind === 'notify_requester' ? ticket.ccs || [] : [])].slice(0, 10);
    // The daily cap counts emails delivered, one per recipient.
    if (env.store && !(await env.store.allow(deskKeys(desk).rate('mail', 'day'), env.emailCap ?? 500, 86400, recipients.length))) {
      results.push({ to: null, ok: false, skipped: 'daily_limit', trigger: n.trigger });
      continue;
    }
    const subject = cleanLine(renderPlaceholders(n.subject || '[{{desk.name}}] {{ticket.subject}}', data), 300);
    const bodyText = renderPlaceholders(n.body || '{{comment.text}}', data);
    const text = `${bodyText}\n\n${link ? `View your request: ${link}\n\n` : ''}Request #${ticket.id}`;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1d2125">${textToHtml(bodyText)}${
      link ? `<p><a href="${escapeHtml(link)}">View your request</a></p>` : ''
    }<p style="color:#6b7280;font-size:12px">Request #${ticket.id} &middot; ${escapeHtml(meta.name || 'Help desk')}</p></div>`;
    try {
      const res = await env.email({ to: recipients, subject: `${subject} [#${ticket.id}]`, text, html, replyTo: meta.email.replyTo || (meta.email.inbox && meta.email.address) || undefined });
      results.push({ to: recipients, ok: !(res?.failed?.length), failed: res?.failed || [], trigger: n.trigger });
    } catch (e) {
      results.push({ to: recipients, ok: false, error: e?.code || e?.message || 'send_failed', trigger: n.trigger });
    }
  }
  return results;
}

/**
 * Create a ticket. `actor` is { type: 'agent'|'customer'|'system', id, name }.
 * Returns { ticket, events, notifications }.
 */
export async function createTicket(env, desk, ctx, input, actor) {
  const { store } = env;
  const K = deskKeys(desk);
  const { meta, members, cfg } = ctx;
  const now = store.now();
  const subject = cleanLine(input.subject, LIMITS.subject);
  if (!subject) throw new ValidationError('Add a subject', 'subject');
  const via = oneOf(input.via, CHANNELS, actor.type === 'customer' ? 'portal' : 'web');
  const comment = commentFrom(input.comment, { by: actor, via, now });
  if (!comment && actor.type === 'customer') throw new ValidationError('Describe your request', 'description');
  // The requester is resolved below, from an email or a customer id.
  const { requester: _requester, ...fields } = input;
  const base = cleanPatch(
    { status: 'new', priority: 'normal', ...fields, subject },
    { members, cfg, ticket: null },
  );
  // Only once everything else is valid, so a refused ticket leaves no new
  // customer behind.
  const requester = await resolveRequester(store, K, input.requester, actor);
  const seq = await store.incr(K.seq, { t: 1 });
  const id = seq.t;
  let ticket = {
    id,
    subject,
    status: 'new',
    priority: null,
    type: null,
    assignee: null,
    group: null,
    followers: [],
    ccs: [],
    tags: [],
    fields: {},
    ...base,
    requester: requester.id,
    org: requester.org || null,
    via,
    submitter: actor.type === 'agent' ? actor.id : null,
    createdAt: now,
    updatedAt: now,
    solvedAt: null,
    closedAt: null,
    firstReplyAt: null,
    // An agent opening a ticket with a public message has written to the
    // customer already (see slaStatus).
    lastAgentReplyAt: actor.type === 'agent' && comment?.public ? now : null,
    lastCustomerAt: actor.type === 'customer' ? now : null,
    preview: comment ? preview(comment.html) : '',
    desc: comment ? comment.text.slice(0, 600) : '',
    csat: null,
    spam: false,
    deleted: null,
    mergedInto: null,
    problem: base.problem || null,
    key: secret(24),
    updatedBy: actor.id || null,
    // Help center requests: which Puter account sent it (for "My requests"),
    // and whether it was filed under an existing customer by an unverified sender.
    submitterPuter: actor.type === 'customer' && /^[\w-]{6,64}$/.test(String(input.submitterPuter || '')) ? input.submitterPuter : null,
    unverified: actor.type === 'customer' && !!input.unverified,
  };
  if (actor.type === 'agent' && ticket.status === 'new' && ticket.assignee) ticket.status = 'open';
  // A suspended customer's request is filed straight to Suspended tickets,
  // quietly: no triggers, so no replies and no assignment.
  const spam = actor.type === 'customer' && input.spam === true;
  if (spam) ticket.spam = true;
  const trig = spam
    ? { ticket, fired: [], notifications: [] }
    : runTriggers(cfg.triggers, { before: null, after: ticket, event: 'created', actor: actor.type, comment, me: actor.id });
  ticket = trig.ticket;
  if (ticket.status === 'solved') ticket.solvedAt = now;
  const events = [];
  if (comment) events.push({ ...comment, id: eventId(now), ticket: id });
  events.push({
    id: eventId(now + 1),
    ticket: id,
    kind: 'create',
    at: now,
    by: actor,
    via,
    changes: diffTickets({}, ticket).filter((c) => c.to !== null && !(Array.isArray(c.to) && !c.to.length)),
    triggers: trig.fired,
  });
  const records = [
    { key: K.ticket(id), value: ticket },
    { key: K.requesterTicket(requester.id, id), value: 1 },
    ...events.map((e) => ({ key: eventKey(K, id, e.id), value: e })),
  ];
  if (ticket.submitterPuter) records.push({ key: K.submitterTicket(ticket.submitterPuter, id), value: 1 });
  if (ticket.status === 'solved') records.push({ key: K.solved(id), value: now });
  await store.commit(K, records, { k: 't', id, v: ticket, by: actor.id || null, ev: summarizeEvents(events, actor) });
  const notified = await sendNotifications(env, {
    meta, desk, ticket, requester, agentName: actor.name, comment, notifications: trig.notifications,
  });
  return { ticket, events, requester, notified };
}

/** The @handles in a note, lowercased ("Thanks @al." mentions al). */
export function mentionsIn(text) {
  const out = new Set();
  // Letters with their combining marks (Devanagari vowel signs, say), and
  // apostrophes and dots inside a name ("d'arcy", "j.r").
  for (const m of String(text || '').matchAll(/@([\p{L}\p{N}_][\p{M}]*(?:[\p{L}\p{M}\p{N}_.'’-]*[\p{L}\p{M}\p{N}_])?)/gu)) out.add(m[1].toLowerCase());
  return [...out].slice(0, 20);
}

/** A short description of what an update did, carried in the change feed. */
export function summarizeEvents(events, actor) {
  const out = { by: actor?.id || null, byType: actor?.type || null };
  for (const e of events) {
    if (e.kind === 'comment') {
      out.comment = { public: e.public, preview: preview(e.html, 140) };
      // From the whole note: a mention past the preview still notifies.
      if (!e.public) out.comment.mentions = mentionsIn(e.text);
    }
    if (e.changes) {
      for (const c of e.changes) {
        if (c.field === 'assignee') out.assigned = c.to;
        if (c.field === 'status') out.status = c.to;
      }
    }
  }
  return out;
}

/**
 * Update a ticket: field changes and/or a comment from an agent or customer.
 * Field changes go out as path updates so two people changing different
 * fields at the same moment both keep their change.
 */
export async function updateTicket(env, desk, ctx, id, input, actor) {
  const { store } = env;
  const K = deskKeys(desk);
  const { meta, members, cfg } = ctx;
  const before = await store.get(K.ticket(id));
  if (!before) fail(404, 'not_found', 'That ticket no longer exists');
  // A satisfaction rating is the one thing a closed ticket still takes.
  if (before.status === 'closed' && !input.csat) fail(409, 'closed', 'Closed tickets cannot be changed. Create a follow-up instead.');
  if (before.deleted && !input.allowDeleted) fail(409, 'deleted', 'This ticket is in the trash. Restore it to make changes.');
  const now = store.now();
  const patch = actor.type === 'agent' ? cleanPatch(input.patch, { members, cfg, ticket: before }) : {};
  if (input.system) Object.assign(patch, input.system);
  const via = actor.type === 'customer' ? (input.via || 'portal') : 'web';
  const comment = commentFrom(input.comment, { by: actor, via, now });
  if (comment && actor.type === 'customer') comment.public = true;
  let after = { ...before, ...patch };
  if (input.csat) after.csat = input.csat;
  if (patch.requester && patch.requester !== before.requester) {
    const user = await store.get(K.user(patch.requester));
    if (!user) throw new ValidationError('That requester no longer exists', 'requester');
    after.org = user.org || null;
  }
  // Customer replies reopen a ticket that was waiting on them or solved.
  if (actor.type === 'customer' && comment && ['pending', 'solved', 'hold'].includes(before.status) && !('status' in patch)) {
    after.status = 'open';
  }
  if (actor.type === 'agent' && after.status === 'new' && (comment || after.assignee) && !('status' in (input.patch || {}))) after.status = 'open';
  // Fields marked required to solve are required whichever way an agent
  // solves (the ticket screen, bulk edit, a macro); merging closes as is.
  if (actor.type === 'agent' && patch.status === 'solved' && before.status !== 'solved' && !input.system?.mergedInto) {
    const missing = (cfg.fields || []).filter((f) => f.active && f.required && (after.fields?.[f.id] == null || after.fields[f.id] === ''));
    if (missing.length) throw new ValidationError(`Fill in ${missing.map((f) => f.title).join(', ')} before solving`, `field:${missing[0].id}`);
  }
  const trig = runTriggers(cfg.triggers, { before, after, event: 'updated', actor: actor.type, comment, me: actor.id });
  after = trig.ticket;
  // A closed ticket keeps its fields; triggers on its rating can still notify.
  if (before.status === 'closed') after = { ...before, csat: after.csat };
  const changes = diffTickets(before, after);
  if (!changes.length && !comment && !input.csat && !input.force) return { ticket: before, events: [], notified: [] };
  // Timestamps that drive reporting and service level targets.
  const stamps = { updatedAt: now, updatedBy: actor.id || null };
  if (comment) {
    stamps.preview = preview(comment.html);
    if (actor.type === 'customer') stamps.lastCustomerAt = now;
    if (actor.type === 'agent' && comment.public) {
      stamps.lastAgentReplyAt = now;
      if (!before.firstReplyAt) {
        stamps.firstReplyAt = now;
        // On a ticket an agent opened with a public message, the first reply
        // answers the customer's message after it (as slaStatus counts), or
        // nothing at all when the agent writes again first.
        if (before.lastAgentReplyAt) stamps.firstReplyFrom = before.lastCustomerAt > before.lastAgentReplyAt ? before.lastCustomerAt : null;
      }
    }
  }
  if (after.status === 'solved' && before.status !== 'solved') stamps.solvedAt = now;
  if (after.status !== 'solved' && before.status === 'solved') stamps.solvedAt = null;
  const paths = { ...stamps };
  if (input.csat) paths.csat = input.csat;
  const removed = [];
  for (const c of changes) {
    if (c.field.startsWith('field:')) {
      // One path per custom field, so agents filling in different fields at
      // once both keep theirs; an emptied field is removed.
      const fid = c.field.slice(6);
      if (after.fields?.[fid] === undefined) removed.push(`fields.${fid}`);
      else paths[`fields.${fid}`] = after.fields[fid];
    } else paths[c.field] = after[c.field] ?? null;
  }
  if (after.org !== before.org) paths.org = after.org;
  const newRequester = patch.requester && patch.requester !== before.requester;
  if (newRequester) {
    // The help center link and "My requests" belonged to the old requester;
    // they must not keep showing the ticket, now about someone else.
    paths.key = secret(24);
    paths.submitterPuter = null;
    paths.unverified = false;
  }
  const events = [];
  if (comment) events.push({ ...comment, id: eventId(now), ticket: id });
  if (input.csat) events.push({ id: eventId(now), ticket: id, kind: 'rating', at: now, by: actor, score: input.csat.score, comment: input.csat.comment });
  if (changes.length || trig.fired.length) {
    events.push({ id: eventId(now + 1), ticket: id, kind: 'change', at: now, by: actor, via, changes, triggers: trig.fired, macro: input.macro || null });
  }
  const ticket = await writeTicket(store, K, id, paths, removed);
  // The ticket itself was written by the path update above; writing it whole
  // again would undo a concurrent change to another field.
  const records = events.map((e) => ({ key: eventKey(K, id, e.id), value: e }));
  if (patch.requester && patch.requester !== before.requester) {
    records.push({ key: K.requesterTicket(patch.requester, id), value: 1 });
  }
  if (ticket.status === 'solved' && before.status !== 'solved') records.push({ key: K.solved(id), value: now });
  await store.commit(K, records, { k: 't', id, v: ticket, by: actor.id || null, ev: summarizeEvents(events, actor) });
  if (newRequester) {
    await store.del(K.requesterTicket(before.requester, id)).catch(() => {});
    if (before.submitterPuter) await store.del(K.submitterTicket(before.submitterPuter, id)).catch(() => {});
  }
  if (before.status === 'solved' && ticket.status !== 'solved') await store.del(K.solved(id)).catch(() => {});
  let notified = [];
  if (trig.notifications.length) {
    const requester = await store.get(K.user(ticket.requester));
    notified = await sendNotifications(env, { meta, desk, ticket, requester, agentName: actor.name, comment, notifications: trig.notifications });
  }
  return { ticket, events, notified };
}

/**
 * Write some fields of a ticket with a path update and return the stored
 * ticket. Every write also bumps the ticket's `ver` atomically, and the copy
 * that comes back includes every write that landed before it. Copies can
 * then be ordered by `ver`, even when two updates land in the opposite order
 * of their clocks (which `updatedAt` cannot tell apart).
 */
export async function writeTicket(store, K, id, paths, remove = []) {
  await store.update(K.ticket(id), paths);
  if (remove.length) await store.remove(K.ticket(id), ...remove);
  const ticket = await store.incr(K.ticket(id), { ver: 1 });
  return ticket && typeof ticket === 'object' ? ticket : store.get(K.ticket(id));
}

/** Close solved tickets older than the desk's auto-close window. */
export async function autoClose(env, desk, meta, { limit = 50 } = {}) {
  const { store } = env;
  const K = deskKeys(desk);
  const days = Number(meta.autoCloseDays ?? 4);
  if (!(days > 0)) return 0;
  const cutoff = store.now() - days * 24 * 3600 * 1000;
  // Entries are listed by ticket number, not by when the ticket was solved,
  // so read on past the ones not due yet (a recent bulk solve of old tickets
  // would otherwise hide every due ticket after them).
  const due = [];
  let cursor;
  let pages = 0;
  do {
    const page = await store.page(K.solvedPrefix, { limit: 500, cursor });
    for (const item of page.items) if (Number(item.value) <= cutoff) due.push(item);
    cursor = page.cursor;
  } while (cursor && due.length < limit && ++pages < 20);
  let closed = 0;
  for (const { key } of due) {
    if (closed >= limit) break;
    const id = Number(key.slice(K.solvedPrefix.length));
    const t = await store.get(K.ticket(id));
    if (t && t.status === 'solved' && !t.deleted && !t.spam) {
      const now = store.now();
      const ticket = await writeTicket(store, K, id, { status: 'closed', closedAt: now, updatedAt: now });
      const ev = { id: eventId(now), ticket: id, kind: 'change', at: now, by: { type: 'system', id: null, name: 'Automation' }, changes: [{ field: 'status', from: 'solved', to: 'closed' }] };
      await store.commit(K, [{ key: eventKey(K, id, ev.id), value: ev }], { k: 't', id, v: ticket, by: null, ev: { byType: 'system', status: 'closed' } });
      closed++;
    }
    await store.del(key).catch(() => {});
  }
  return closed;
}

/** Load every event of a ticket in time order. */
export async function ticketEvents(store, K, id) {
  const rows = await store.all(K.eventPrefix(id), { max: 5000 });
  return rows.map((r) => r.value).filter(Boolean).sort((a, b) => (a.id < b.id ? -1 : 1));
}
