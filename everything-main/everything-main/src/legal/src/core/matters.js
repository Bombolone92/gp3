/** Matter numbering, conflict checks, and task list templates. Pure functions. */
import { padNumber, contactName, normalize } from './format.js';
import { addDays } from './dates.js';
import { newId } from './ids.js';

/** Last name (or company's first word) used in matter numbers. */
export function clientKey(client) {
  if (!client) return '';
  const raw = client.type === 'company' ? String(client.companyName || '').split(/\s+/)[0] : client.lastName || client.firstName || '';
  return raw.replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
}

/** "00012-Lopez", "00012", or "2026-00012" depending on the firm's format. */
export function displayNumber(number, { format = 'number-client', client = null, openDate = '' } = {}) {
  const n = padNumber(number);
  if (format === 'number') return n;
  if (format === 'year-number') return `${(openDate || new Date().toISOString()).slice(0, 4)}-${n}`;
  const key = clientKey(client);
  return key ? `${n}-${key}` : n;
}

/** Everyone tied to a matter: the client plus related contacts. */
export function matterParties(matter) {
  const out = [];
  if (matter.clientId) out.push({ contactId: matter.clientId, relationship: 'Client' });
  for (const r of matter.related || []) if (r.contactId) out.push({ contactId: r.contactId, relationship: r.relationship || 'Related' });
  return out;
}

/**
 * Conflict check: find contacts whose name, email, or phone resembles the
 * query, and every matter they are a party to. Returns
 * [{ contact, score, matters: [{ matter, relationship }] }], best first.
 */
export function conflictSearch(query, { contacts, matters }) {
  const q = normalize(query).trim();
  if (q.length < 2) return [];
  const tokens = q.split(/[\s,]+/).filter(Boolean); // "Smith, John" works too
  if (!tokens.length) return [];
  // A query that looks like a phone number matches digits only, however either side is punctuated.
  const qDigits = /^[\d\s()+.-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const phoneHit = (c) =>
    qDigits.length >= 4 &&
    (c.phones || []).some((p) => {
      const d = String(p.number || '').replace(/\D/g, '');
      return d.length >= 4 && (d.includes(qDigits) || (d.length >= 7 && qDigits.endsWith(d)));
    });
  const byContact = new Map();
  for (const m of matters)
    for (const p of matterParties(m)) {
      if (!byContact.has(p.contactId)) byContact.set(p.contactId, []);
      byContact.get(p.contactId).push({ matter: m, relationship: p.relationship });
    }
  const out = [];
  for (const c of contacts) {
    const name = normalize(contactName(c));
    const extra = normalize([c.companyName, ...(c.emails || []).map((e) => e.address), ...(c.phones || []).map((p) => p.number)].join(' '));
    let score = 0;
    if (name === q) score = 100;
    else if (tokens.every((t) => name.includes(t))) score = 60 + (name.startsWith(tokens[0]) ? 10 : 0);
    else if (tokens.every((t) => (name + ' ' + extra).includes(t)) || phoneHit(c)) score = 40;
    else if (tokens.some((t) => t.length > 2 && name.split(/\s+/).some((w) => w.startsWith(t)))) score = 20;
    if (score) out.push({ contact: c, score, matters: byContact.get(c.id) || [] });
  }
  return out.sort((a, b) => b.score - a.score || b.matters.length - a.matters.length).slice(0, 50);
}

/** Matter descriptions can name parties that were never added as contacts. */
export function matterDescriptionHits(query, matters) {
  const q = normalize(query).trim();
  if (q.length < 3) return [];
  return matters.filter((m) => normalize(m.description).includes(q)).slice(0, 20);
}

/**
 * Tasks created when a task list template is applied to a matter. Due dates
 * count from `start`; assignees resolve from the matter's roles, skipping
 * users that `isActive` rejects (deactivated staff).
 */
export function tasksFromList(list, matter, start, isActive = () => true) {
  const who = (id) => (id && isActive(id) ? id : null);
  const roleUser = { responsible: who(matter.responsibleId), originating: who(matter.originatingId), staff: who(matter.staffId) };
  return (list.items || []).map((it) => ({
    id: newId(),
    name: it.name,
    description: it.description || '',
    matterId: matter.id,
    assigneeId: (it.assignee && roleUser[it.assignee]) || roleUser.responsible,
    dueDate: it.dueOffset === null || it.dueOffset === undefined || it.dueOffset === '' ? '' : addDays(start, Number(it.dueOffset) || 0),
    priority: it.priority || 'normal',
    done: false,
    listId: list.id,
  }));
}

/** Days until a statute of limitations date (negative once passed), or null. */
export function solDaysLeft(matter, today) {
  if (!matter?.solDate || matter.solSatisfied) return null;
  return Math.round((new Date(matter.solDate) - new Date(today)) / 86400000);
}
