/**
 * The key layout in the owner's key-value store. Every help desk lives under
 * its own prefix, `hd:<desk>:`, and each record type has a short segment so
 * a prefix listing reads exactly one collection:
 *
 *   meta                  desk settings (name, portal, email, owner)
 *   members               agents by Puter uuid (one small document)
 *   cfg:<kind>            groups, macros, views, fields, triggers, sla, kb
 *   seq                   counters: { t: tickets, u: users, o: orgs, a: articles }
 *   rev                   change counter, bumped on every write
 *   ch:<rev>              change feed entry (expires after CHANGE_TTL)
 *   t:<id>                ticket
 *   e:<id>:<n>            ticket event: comment, note or field change
 *   u:<id>                customer (end user)
 *   ue:<email>            customer id by email
 *   uu:<uuid>             customer id by Puter account
 *   rt:<user>:<ticket>    tickets by requester
 *   ps:<uuid>:<ticket>    tickets a signed-in Puter account sent from the help center
 *   o:<id>                organization
 *   od:<domain>           organization id by email domain
 *   k:<id>                knowledge base article (summary, listed)
 *   kb:<id>               knowledge base article body (read on open)
 *   f:<id>                attachment metadata (the bytes are a file)
 *   sv:<ticket>           solved tickets waiting to be closed automatically
 *   pr:<ticket>:<uuid>    who is viewing a ticket (expires)
 *   inv:<code>            invite (expires)
 *   rl:<scope>:<who>      rate limit counters (expire)
 *
 * Numeric ids are zero padded so listings come back in numeric order.
 */
import { pad } from './ids.js';

export const CHANGE_TTL_SECONDS = 14 * 24 * 3600;
export const PRESENCE_TTL_SECONDS = 45;

export const deskPrefix = (desk) => `hd:${desk}:`;

export function deskKeys(desk) {
  const p = deskPrefix(desk);
  return {
    prefix: p,
    meta: `${p}meta`,
    members: `${p}members`,
    cfg: (kind) => `${p}cfg:${kind}`,
    seq: `${p}seq`,
    rev: `${p}rev`,
    change: (rev) => `${p}ch:${pad(rev, 12)}`,
    changePrefix: `${p}ch:`,
    ticket: (id) => `${p}t:${pad(id)}`,
    ticketPrefix: `${p}t:`,
    event: (id, n) => `${p}e:${pad(id)}:${pad(n, 6)}`,
    eventPrefix: (id) => `${p}e:${pad(id)}:`,
    user: (id) => `${p}u:${pad(id)}`,
    userPrefix: `${p}u:`,
    userByEmail: (email) => `${p}ue:${email}`,
    userByUuid: (uuid) => `${p}uu:${uuid}`,
    requesterTicket: (user, ticket) => `${p}rt:${pad(user)}:${pad(ticket)}`,
    requesterPrefix: (user) => `${p}rt:${pad(user)}:`,
    submitterTicket: (uuid, ticket) => `${p}ps:${uuid}:${pad(ticket)}`,
    submitterPrefix: (uuid) => `${p}ps:${uuid}:`,
    org: (id) => `${p}o:${pad(id)}`,
    orgPrefix: `${p}o:`,
    orgByDomain: (domain) => `${p}od:${domain}`,
    article: (id) => `${p}k:${pad(id)}`,
    articlePrefix: `${p}k:`,
    articleBody: (id) => `${p}kb:${pad(id)}`,
    file: (id) => `${p}f:${id}`,
    solved: (id) => `${p}sv:${pad(id)}`,
    solvedPrefix: `${p}sv:`,
    presence: (ticket, uuid) => `${p}pr:${pad(ticket)}:${uuid}`,
    presencePrefix: (ticket) => `${p}pr:${pad(ticket)}:`,
    invite: (code) => `${p}inv:${code}`,
    rate: (scope, who) => `${p}rl:${scope}:${who}`,
  };
}

/** The numeric id at the end of a record key. */
export function idFromKey(key) {
  const m = /:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Per-user document in each user's own KV (not the desk's). */
export const USER_DOC_KEY = 'hdu:me';
