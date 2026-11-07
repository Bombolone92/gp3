/** Helpers shared by the contact list, form, and detail screens. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { avatar } from '../ui/components.js';
import { contactName, colorFor } from '../core/format.js';
import { where, mattersForContact } from '../core/derive.js';
import { billBalance } from '../core/finance.js';
import { financialsFor } from './common.js';

/** Round initials for people, a building tile for companies. */
export function contactAvatar(c, size = 'sm') {
  if (c?.type === 'company') return h(`span.avatar.company${size ? '.' + size : ''}`, { 'aria-hidden': 'true' }, icon('building', size === 'lg' || size === 'xl' ? 22 : 15));
  return avatar(contactName(c), { color: colorFor(c?.id || contactName(c)), size });
}

/** The company a person works for: a linked company contact, or free text. */
export function companyLabel(c) {
  if (!c || c.type === 'company') return '';
  const co = c.companyId ? app.store.get('contacts', c.companyId) : null;
  return co ? contactName(co) : c.companyName || '';
}

/** Distinct matters a contact is party to: [{ matter, relationships: [] }]. */
export function contactMatters(contactId) {
  const byMatter = new Map();
  for (const { matter, relationship } of mattersForContact(app.store, contactId)) {
    const cur = byMatter.get(matter.id);
    if (cur) cur.relationships.push(relationship);
    else byMatter.set(matter.id, { matter, relationships: [relationship] });
  }
  return [...byMatter.values()];
}

/** Whether a contact is the client on any matter (and so must not be deleted). */
export function isMatterClient(contactId) {
  return where(app.store, 'matters', 'clientId', contactId).length > 0;
}

/** Whether bills, payments, or account transactions name the contact (and so it must not be deleted). */
export function hasMoneyRecords(contactId) {
  const s = app.store;
  return where(s, 'bills', 'clientId', contactId).length > 0 || where(s, 'payments', 'contactId', contactId).length > 0 || where(s, 'transactions', 'contactId', contactId).length > 0;
}

/**
 * Money for a client: outstanding on their bills, trust held across their
 * matters, unbilled work, and what they paid in a given year.
 */
export function clientMoney(contactId, year = app.today().slice(0, 4)) {
  const s = app.store;
  let outstanding = 0;
  for (const b of where(s, 'bills', 'clientId', contactId)) outstanding += billBalance(b, where(s, 'payments', 'billId', b.id));
  let trust = 0;
  let wip = 0;
  for (const m of where(s, 'matters', 'clientId', contactId)) {
    const f = financialsFor(m);
    trust += f.trust;
    wip += f.wip;
  }
  let paidYear = 0;
  for (const p of where(s, 'payments', 'contactId', contactId)) if (String(p.date).startsWith(year)) paidYear += Number(p.amountCents) || 0;
  return { outstanding, trust, wip, paidYear };
}

/** Every tag used on any contact, sorted. */
export function allContactTags() {
  const set = new Set();
  for (const c of app.store.all('contacts')) for (const t of c.tags || []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}
