/** Small shared view pieces: avatars, chips, badges, progress, empty states. */

import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { initials, readableInk, fieldId } from '../lib/util.js';
import { fmtShort, dueStatus } from '../lib/dates.js';
import { PRIORITIES } from '../lib/store.js';

/**
 * The app's own icon, wherever the app needs to show itself. Served from
 * public/ rather than bundled so the service worker can precache it under a
 * name it knows; one file at 192 covers every place it appears.
 */
export function appIcon(size, className = 'app-icon') {
  return el(`img.${className}`, {
    src: './icon-192.png',
    width: size,
    height: size,
    alt: '',
    'aria-hidden': 'true',
  });
}

export function avatar(member, size = 26) {
  return el('span.avatar', {
    style: {
      width: `${size}px`,
      height: `${size}px`,
      background: member.color,
      // Half the member palette is too light to hold white initials.
      color: readableInk(member.color),
      fontSize: `${Math.round(size * 0.4)}px`,
    },
    title: member.name,
    role: 'img',
    'aria-label': member.name,
  }, initials(member.name));
}

/**
 * The stand-in avatar for people who are not project members: the signed-in
 * user, and comment authors. It is the accent colour, so its ink has to be
 * `--accent-ink` rather than a fixed white — the dark theme's accent is a
 * pale purple that white initials disappear into.
 *
 * `decorative` is for the rows that already say the name out loud beside it.
 */
export function accentAvatar(name, size = 26, { decorative = false } = {}) {
  return el('span.avatar.avatar-accent', {
    style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` },
    title: decorative ? null : name,
    role: decorative ? null : 'img',
    'aria-label': decorative ? null : name,
    'aria-hidden': decorative ? 'true' : null,
  }, initials(name));
}

/** Overlapping avatar row; collapses to "+N" beyond `max`. */
export function avatarStack(members, { max = 3, size = 26 } = {}) {
  if (!members.length) return null;
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return el('span.avatar-stack', {},
    shown.map((m) => avatar(m, size)),
    extra > 0 && el('span.avatar.avatar-extra', {
      style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` },
      title: members.slice(max).map((m) => m.name).join(', '),
    }, `+${extra}`)
  );
}

/**
 * The small variant drops the text and keeps only the colour, which is what
 * makes a card scannable — but a bar with no name is unreadable on its own,
 * so it carries the label's name as a tooltip. (Screen readers get it from
 * the card's own label; a span inside a role="button" is not announced.)
 */
export function labelChip(label, { small = false } = {}) {
  if (!small) {
    return el('span.label-chip', { style: { '--chip': label.color } }, label.name);
  }
  return el('span.label-chip.small', {
    style: { '--chip': label.color },
    title: label.name,
  });
}

export function priorityBadge(priority) {
  if (!priority) return null;
  const info = PRIORITIES.find((p) => p.value === priority);
  if (!info) return null;
  return el(`span.prio.prio-${priority}`, {
    html: icon(priority, 13, 2.2),
    title: `${info.label} priority`,
    role: 'img',
    'aria-label': `${info.label} priority`,
  });
}

/** Due-date badge, colored by urgency; done tasks show a plain date. */
export function dueBadge(task, isDone) {
  if (!task.dueDate) return null;
  const status = dueStatus(task.dueDate, isDone);
  const cls = status === 'overdue' ? '.due-overdue' : status === 'today' || status === 'soon' ? '.due-soon' : '';
  return el(`span.due${cls}`, {
    html: icon(status === 'overdue' ? 'clock' : 'calendar', 12, 2),
    title: status === 'overdue' ? 'Overdue' : 'Due date',
  }, ` ${fmtShort(task.dueDate)}`);
}

export function progressBar(done, total, { label } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return el('div.progress', {
    role: 'progressbar',
    'aria-valuenow': pct,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-label': label || `${done} of ${total} tasks done`,
  }, el('div.progress-fill', { style: { width: `${pct}%` } }));
}

export function emptyState({ icon: name, title, sub, action }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(name, 28) }),
    el('h3', {}, title),
    sub && el('p', {}, sub),
    action || null
  );
}

/**
 * WAI-ARIA radio-group keyboard behavior for a container of role="radio"
 * buttons: arrows move selection (wrapping), Home/End jump. Callers give
 * the checked item tabindex 0 and the rest -1; a click may rebuild the
 * group's children, so focus lands on the fresh node at the same slot.
 */
export function radioGroupKeys(group, selector) {
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const items = [...group.querySelectorAll(selector)];
    if (!items.length) return;
    e.preventDefault();
    const focused = items.indexOf(document.activeElement);
    const checked = items.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const from = focused >= 0 ? focused : Math.max(0, checked);
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + items.length) % items.length;
    else next = (from + 1) % items.length;
    items[next].click();
    const fresh = [...group.querySelectorAll(selector)];
    (fresh[next] || items[next])?.focus();
  });
}

/** Native date input wrapped so it can be cleared. */
export function dateField({ label, value, onchange }) {
  const id = fieldId('date');
  const input = el('input.input', {
    id,
    type: 'date', value: value || '',
    onchange: () => onchange(input.value || null),
  });
  return el('div.field', {}, el('label.label', { htmlFor: id }, label), input);
}
