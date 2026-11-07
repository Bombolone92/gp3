import { el } from './dom.js';
import { icon } from './icons.js';
import {
  formatDate, relativeDays, todayISO, isValidISO, daysBetween, dateToISO, DECISION_LABELS,
  ENDING_DECISIONS,
} from '../lib/dates.js';
import { DOT } from '../lib/util.js';
import { typeInfo, repeatLabel, endedOn } from '../lib/store.js';

/**
 * One badge that says where a contract stands. Color is never the only
 * signal: every phase has its own label (and the urgent ones an icon).
 */
export function phaseBadge(contract, info) {
  if (contract.status === 'draft') return el('span.badge.badge-muted', {}, 'Draft');
  if (contract.status === 'terminated') return el('span.badge.badge-muted', {}, 'Terminated');
  // A decision on the record replaces the alarm: "Notice given" is not urgent.
  if (info.handled) {
    const { kind } = info.decision;
    const tone = kind === 'renewing' ? 'badge-ok' : 'badge-muted';
    return el(`span.badge.${tone}`,
      kind === 'snoozed' ? { html: icon('clock', 12, 2.4) } : {},
      DECISION_LABELS[kind]);
  }
  switch (info.phase) {
    case 'expired':
      return el('span.badge.badge-danger', { html: icon('warning', 12, 2.4) }, 'Expired');
    case 'notice':
      return el('span.badge.badge-danger', { html: icon('alert', 12, 2.4) }, 'Notice due');
    case 'soon':
      return el('span.badge.badge-warn', { html: icon('clock', 12, 2.4) }, 'Renews soon');
    case 'evergreen':
      return el('span.badge.badge-ok', {}, 'Evergreen');
    default:
      return el('span.badge.badge-ok', {}, 'Active');
  }
}

/**
 * Why a contract is in the attention list: the deadline it is waiting on.
 *
 * Once the notice deadline has passed the term still ends or renews on its
 * date, and what is left to do is record what happened. Saying "cancel or
 * renegotiate by <a date twelve days ago>" there was an instruction nobody
 * could follow, on the first list the app opens with.
 */
export function attentionLine(contract, info) {
  if (info.phase === 'expired') {
    return `Term ended ${formatDate(info.date)} (${relativeDays(info.daysLeft)})`;
  }
  if (info.noticeDaysLeft >= 0) {
    return `Cancel or renegotiate by ${formatDate(info.noticeDate)} (${relativeDays(info.noticeDaysLeft)})`;
  }
  return `Notice deadline passed ${formatDate(info.noticeDate)}${DOT}`
    + `${contract.autoRenew ? 'renews' : 'ends'} ${formatDate(info.date)} (${relativeDays(info.daysLeft)})`;
}

/**
 * "Renews 12 Sep 2026 (in 18 days)" / "Expires ..." one-liner.
 *
 * A recorded "notice given" or "not renewing" makes this term the last one,
 * so the contract ends on that date whatever it would otherwise have done.
 * Saying "Renews" beside a "Notice given" badge contradicted the badge on
 * every list the row appears in.
 */
export function renewalLine(contract, info) {
  if (!info.date) return null;
  const past = info.phase === 'expired';
  const ending = !!info.decision && ENDING_DECISIONS.includes(info.decision.kind);
  const verb = ending
    ? (past ? 'Ended' : 'Ends')
    : past
      ? (contract.autoRenew ? 'Lapsed' : 'Expired')
      : (contract.autoRenew ? 'Renews' : 'Expires');
  return `${verb} ${formatDate(info.date)} (${relativeDays(info.daysLeft)})`;
}

/** Square type glyph used in contract lists. */
export function typeGlyph(contract, size = 20) {
  const t = typeInfo(contract.type);
  return el('span.type-glyph', { html: icon(t.icon, size, 1.8), title: t.label });
}

export function ownerBadge(owner) {
  const label = owner === 'them' ? 'Theirs' : owner === 'mutual' ? 'Mutual' : 'Ours';
  return el(`span.badge.badge-owner.owner-${owner || 'us'}`, {}, label);
}

/**
 * One obligation row, shared by the contract detail and the Obligations view
 * so the same duty looks and behaves the same in both places. The row is
 * dumb: the callbacks own the store calls.
 *
 * `withContract` adds a link to the contract the obligation belongs to —
 * meaningless on the contract's own page, essential in the global list.
 */
export function obligationRow(contract, ob, {
  withContract = false, onToggle = null, onEdit = null, onDelete = null, today = todayISO(),
} = {}) {
  const id = `ob-${ob.id}`;
  const daysLeft = isValidISO(ob.due) ? daysBetween(today, ob.due) : null;
  const overdue = !ob.done && daysLeft !== null && daysLeft < 0;

  const meta = el('div.ob-meta', {});
  if (withContract) {
    meta.append(el('a.ob-contract', { href: `#/contracts/${contract.id}` }, contract.title));
  }
  if (ob.due) {
    if (meta.childNodes.length) meta.append(document.createTextNode(DOT));
    meta.append(el(`span${overdue ? '.overdue' : ''}`, {},
      overdue
        ? `overdue, was due ${formatDate(ob.due)}`
        : `${ob.done ? 'was due' : 'due'} ${formatDate(ob.due)}${ob.done ? '' : ` (${relativeDays(daysLeft)})`}`));
  }
  // Cadence on the row, so a monthly duty is never mistaken for a one-off.
  if (ob.repeat) {
    if (meta.childNodes.length) meta.append(document.createTextNode(DOT));
    meta.append(el('span.ob-cadence', { html: icon('renew', 12, 2.2) }, ` ${repeatLabel(ob.repeat.every)}`));
  }

  return el('div.ob-row', {},
    el('input', {
      type: 'checkbox', className: 'ob-check', checked: !!ob.done, id,
      'aria-label': `Done: ${ob.text}`,
      onchange: (e) => onToggle?.(e.target.checked),
    }),
    el('div.grow.min0', {},
      el(`label.ob-text${ob.done ? '.done' : ''}`, { htmlFor: id }, ob.text),
      meta.childNodes.length ? meta : null,
      occurrenceHistory(ob)
    ),
    ownerBadge(ob.owner),
    onEdit && el('button.icon-btn.subtle', {
      html: icon('pencil', 15, 2), 'aria-label': `Edit obligation: ${ob.text}`,
      title: 'Edit obligation',
      onclick: () => onEdit(),
    }),
    onDelete && el('button.icon-btn.subtle', {
      html: icon('x', 16, 2), 'aria-label': `Delete obligation: ${ob.text}`,
      title: 'Delete obligation',
      onclick: () => onDelete(),
    })
  );
}

/**
 * Completed occurrences of a repeating obligation, folded away until asked
 * for. This is what makes "did we pay in March?" answerable.
 */
function occurrenceHistory(ob) {
  const done = ob.history || [];
  if (!done.length) return null;
  return el('details.ob-history', {},
    el('summary', {}, `${done.length} completed`),
    el('ul', {}, [...done].reverse().map((h) =>
      el('li', {}, h.due ? formatDate(h.due) : `marked done ${formatDate(dateToISO(new Date(h.doneAt)))}`)))
  );
}

/** Initials avatar for contacts. */
export function avatar(name) {
  const initials = String(name || '?').trim().split(/\s+/)
    .map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return el('span.avatar', { 'aria-hidden': 'true' }, initials);
}

export function emptyState({ icon: name, title, sub, action = null }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(name, 28) }),
    el('h3', {}, title),
    sub && el('p', {}, sub),
    action
  );
}

/** Default context line under a contract row title. */
export function rowSubtitle(contract, info) {
  if (contract.status === 'terminated') {
    const ended = endedOn(contract);
    return ended ? `Ended ${formatDate(ended)}` : 'Closed out';
  }
  if (contract.status === 'draft') return 'Not yet in force';
  return renewalLine(contract, info) ?? 'No end date';
}

/**
 * Standard contract list row: glyph, title, context line, status badge.
 * The whole row is a link to the contract's detail page.
 */
export function contractRow(contract, info, { sub = null } = {}) {
  return el('a.list-row.contract-row', { href: `#/contracts/${contract.id}` },
    typeGlyph(contract),
    el('div.grow.min0', {},
      el('div.row-title', {}, contract.title),
      el('div.row-sub', {}, sub ?? rowSubtitle(contract, info))
    ),
    phaseBadge(contract, info),
    el('span.row-chev', { html: icon('chevR', 18) })
  );
}

/* --- form field helpers --- */

/**
 * Serialized state of every field under `root`. Compare a snapshot taken at
 * open time with one at dismiss time to detect unsaved edits.
 */
export function formSnapshot(root) {
  return JSON.stringify(
    [...root.querySelectorAll('input, select, textarea, [role="switch"]')].map((n) =>
      n.getAttribute('role') === 'switch' ? n.getAttribute('aria-checked')
        : n.type === 'checkbox' ? n.checked : n.value));
}

let fieldSeq = 0;

/**
 * The hint is where this app writes down the rules a label has no room for:
 * what a notice period is counted from, that an empty reporting currency
 * leaves every currency separate, that a repeat's count has to be more than
 * the occurrences already done. Sitting loose under the control it was read
 * by nobody on a screen reader, who hears the label and the value and then
 * moves on. Tied to the control, it is read with it — and the tie is dropped
 * again when a re-render leaves the field without a hint.
 */
export function field(labelText, control, { hint = null, grow = false } = {}) {
  const id = `f-${++fieldSeq}`;
  control.id = id;
  const hintNode = hint ? el('p.field-hint', { id: `${id}-hint` }, hint) : null;
  if (hintNode) control.setAttribute('aria-describedby', hintNode.id);
  else control.removeAttribute('aria-describedby');
  return el(`div.field${grow ? '.grow' : ''}`, {},
    el('label.field-label', { htmlFor: id }, labelText),
    control.tagName === 'SELECT' ? el('div.select-wrap', {}, control) : control,
    hintNode
  );
}

export function textInput(attrs = {}) {
  return el('input.input', { type: 'text', ...attrs });
}

export function select(options, value, attrs = {}) {
  return el('select.select', attrs,
    options.map((o) => el('option', { value: o.value, selected: o.value === value }, o.label)));
}

/** Accessible switch (role=switch button) bound to a mutable getter/setter. */
export function switchControl(checked, onChange, label) {
  const btn = el('button.switch', {
    type: 'button', role: 'switch',
    'aria-checked': String(!!checked), 'aria-label': label,
    onclick: () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    },
  }, el('span.switch-knob'));
  return btn;
}
