/** Shared UI building blocks. */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { stageLabel, stagesFrom } from '../core/pipeline.js';
import { MAX_TAG_LENGTH, MAX_TAGS, tagCounts } from '../core/tags.js';
import { OFFER_STATUS_LABELS } from '../core/offers.js';
import { recommendationInfo } from '../core/scorecards.js';
import { toast } from './toast.js';

/** The app icon as an inline brand mark (its rounded corners are baked in). */
export function brandMark(size = 30) {
  return el('img', {
    class: 'brand-img',
    src: './icons/icon-192.png',
    alt: '',
    width: size,
    height: size,
    draggable: false,
  });
}

export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    // [...p][0] keeps a whole code point; p[0] would split a surrogate
    // pair and render "�" for names outside the basic plane.
    .map((p) => [...p][0].toUpperCase())
    .join('');
}

const AVATAR_COLORS = [
  '#2563eb', '#0e7490', '#15803d', '#b45309', '#be185d',
  '#7c3aed', '#0f766e', '#c2410c', '#4d7c0f', '#a21caf',
];

/** Stable per-person color, derived from the name. */
export function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name ?? '')) hash = (hash * 31 + ch.codePointAt(0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatar(name, size = '') {
  const known = Boolean(name);
  return el(
    'span',
    {
      class: `avatar${size ? ` ${size}` : ''}`,
      style: { '--person': known ? avatarColor(name) : 'var(--text-3)' },
      // Decorative either way — the name, or the "Unknown candidate" the
      // placeholder stands in for, is always rendered right beside it.
      // Only the initials branch said so, so the Offers list announced a
      // deleted candidate's row as "question mark, Unknown candidate".
      'aria-hidden': 'true',
    },
    known ? initials(name) : '?'
  );
}

export function badge(text, variant = '') {
  return el('span', { class: `badge${variant ? ` badge-${variant}` : ''}` }, text);
}

const STAGE_VARIANTS = {
  applied: '',
  screen: 'info',
  interview: 'accent',
  offer: 'warning',
  hired: 'success',
};

export function stageBadge(stage, settings = null) {
  return badge(stageLabel(stage, settings), STAGE_VARIANTS[stage] ?? '');
}

export function statusBadge(candidate, settings = null) {
  if (candidate.status === 'rejected') return badge('Rejected', 'danger');
  if (candidate.status === 'withdrawn') return badge('Withdrawn', '');
  return stageBadge(candidate.stage, settings);
}

const OFFER_VARIANTS = {
  draft: '',
  sent: 'warning',
  signed: 'success',
  declined: 'danger',
  withdrawn: '',
};

export function offerStatusBadge(status) {
  return badge(OFFER_STATUS_LABELS[status] ?? status, OFFER_VARIANTS[status] ?? '');
}

const REC_VARIANTS = {
  strong_yes: 'success',
  yes: 'success',
  no: 'danger',
  strong_no: 'danger',
};

export function recommendationBadge(value) {
  const rec = recommendationInfo(value);
  return badge(rec?.label ?? value, REC_VARIANTS[value] ?? '');
}

export function emptyState({ iconName = 'briefcase', title, message, actions = [] }) {
  return el(
    'div',
    { class: 'empty-state' },
    icon(iconName, 30),
    el('h3', {}, title),
    message ? el('p', {}, message) : null,
    actions.length ? el('div', { class: 'empty-actions' }, actions) : null
  );
}

/** Keydown handler giving a role="button" element native-like activation. */
export function buttonKeydown(onClick) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e);
    }
  };
}

export function statCard({ label, value, sub, iconName, onClick }) {
  return el(
    'div',
    {
      class: 'card stat-card',
      role: onClick ? 'button' : null,
      tabindex: onClick ? 0 : null,
      onClick,
      onKeydown: onClick ? buttonKeydown(onClick) : null,
    },
    el('div', { class: 'stat-top' }, el('span', { class: 'stat-label' }, label), icon(iconName, 17)),
    el('div', { class: 'stat-value tnum' }, value),
    sub ? el('div', { class: 'stat-sub' }, sub) : null
  );
}

export function segmented(options, value, onChange, ariaLabel = 'Filter') {
  const group = el('div', { class: 'segmented', role: 'group', 'aria-label': ariaLabel });
  for (const opt of options) {
    group.appendChild(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(opt.value === value),
          // Choosing an option re-renders the view; keep focus on the
          // pressed segment so keyboard users can keep going from it.
          dataset: { focusKey: `segment-${ariaLabel}-${opt.value}` },
          onClick: () => onChange(opt.value),
        },
        opt.label
      )
    );
  }
  return group;
}

export function field(labelText, control, id) {
  if (id) control.id = id;
  return el('div', { class: 'field' }, el('label', { for: id ?? null }, labelText), control);
}

export function progressBar(pct, label) {
  return el(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-valuenow': String(pct),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': label ?? 'Progress',
    },
    el('div', { class: 'progress-fill', style: { width: `${pct}%` } })
  );
}

/** <select> of jobs. Include `allLabel` to allow an "every job" option. */
export function jobSelect(jobs, selectedId, { allLabel = null } = {}) {
  const select = el('select', { class: 'select' });
  if (allLabel) select.appendChild(el('option', { value: '' }, allLabel));
  for (const job of jobs) {
    select.appendChild(el('option', { value: job.id, selected: job.id === selectedId }, job.title));
  }
  return select;
}

/** Small icon-only action button with an accessible label. */
export function iconButton({ name, label, onClick, danger = false, size = 15 }) {
  return el(
    'button',
    {
      class: `btn btn-ghost btn-icon btn-sm${danger ? ' btn-icon-danger' : ''}`,
      'aria-label': label,
      title: label,
      onClick,
    },
    icon(name, size)
  );
}

/**
 * Submit one of the inline "type something, press Add" fields — a
 * timeline note, an onboarding task.
 *
 * Any store change re-renders the whole view, and a rejected save is a
 * store change: persist() reloads the collection and notifies before it
 * throws. So by the time the error reaches this catch, the field the
 * text was typed into has already been replaced by an empty one, and the
 * user is left with a toast where their sentence used to be. Put the
 * text back on the replacement — found by focus key, the same handle
 * render() uses to hand focus back — and let them retry from there.
 */
export async function addFromInput(input, submit) {
  const text = input.value;
  if (!text.trim()) return false;
  try {
    await submit(text);
    return true;
  } catch (err) {
    const key = input.dataset.focusKey;
    const replacement = key ? document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) : null;
    const field = replacement instanceof HTMLElement ? replacement : input;
    field.value = text;
    field.focus();
    toast(err.message ?? 'Couldn’t save that.', 'error');
    return false;
  }
}

/**
 * Where focus goes after a row was removed from a rebuilt list: the
 * control now standing in the removed row's place, else the last
 * remaining one, else `fallback` (the list's own Add button).
 *
 * The button that removes a row is inside that row, so re-rendering the
 * list destroys it — and a destroyed focus owner leaves focus on <body>.
 * Inside a dialog that means outside the dialog: the next Tab starts at
 * the top of the page behind the scrim, so removing three rows in a row
 * by keyboard meant tabbing back in three times.
 */
export function focusAfterRemoval(container, selector, index, fallback = null) {
  const controls = [...container.querySelectorAll(selector)];
  const next = controls[index] ?? controls.at(-1) ?? fallback;
  if (next instanceof HTMLElement) next.focus();
}

/** Trigger a client-side file download. */
export function downloadFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Resolves true when the text made it to the clipboard. */
export async function copyText(text, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    return true;
  } catch {
    toast('Couldn’t access the clipboard.', 'error');
    return false;
  }
}

/** 1–5 rating shown as filled/empty stars (display only). */
export function ratingStars(value, size = 13) {
  // Averages arrive as raw floats; announce them the way they are shown.
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const wrap = el('span', { class: 'stars', role: 'img', 'aria-label': `${shown} out of 5` });
  for (let i = 1; i <= 5; i++) {
    const star = icon('star', size);
    if (i <= Math.round(value)) star.classList.add('is-filled');
    wrap.appendChild(star);
  }
  return wrap;
}

/** Per-stage mini distribution: labelled counts in stage order. */
export function stageDots(counts, settings = null) {
  const stages = stagesFrom(settings);
  return el(
    'div',
    {
      class: 'stage-dots',
      // One accessible name for the whole strip, like ratingStars: the
      // per-dot title only surfaces on hover, so without this a screen
      // reader hears "3 1 0 2 0" with no way to learn which number is
      // which stage (and touch users can never hover at all).
      role: 'img',
      'aria-label': stages.map((s) => `${s.label} ${counts[s.key]}`).join(', '),
    },
    stages.map((s) =>
      el(
        'span',
        { class: `stage-dot${counts[s.key] ? '' : ' is-zero'}`, title: `${s.label}: ${counts[s.key]}` },
        el('span', { class: 'tnum' }, String(counts[s.key]))
      )
    )
  );
}

/** A tag as a chip; `onRemove` adds the × that takes it off. */
export function tagChip(tag, onRemove = null) {
  return el(
    'span',
    { class: `tag-chip${onRemove ? ' is-editable' : ''}` },
    el('span', { class: 'tag-chip-text' }, tag),
    onRemove
      ? el(
          'button',
          { class: 'tag-chip-x', 'aria-label': `Remove tag ${tag}`, title: `Remove ${tag}`, onClick: onRemove },
          icon('x', 11)
        )
      : null
  );
}

/**
 * A tag entry box with typeahead over the tags already in use, so the
 * vocabulary converges instead of sprouting near-duplicates. Native
 * <datalist>: it suggests, filters, and stays keyboard-friendly without a
 * custom popup that would have to re-implement all three.
 *
 * Pass `label: null` where the caller renders a visible <label for>: an
 * aria-label overrides it, and the two saying different things leaves a
 * voice-control user asking for the words on the screen and matching
 * nothing.
 */
export function tagInput(candidates, { label = 'New tag', focusKey = null, placeholder = 'Add a tag…' } = {}) {
  const listId = `tags-${Math.random().toString(36).slice(2, 8)}`;
  const input = el('input', {
    class: 'input',
    type: 'text',
    // The box takes a comma-separated list — both callers parse one — so
    // a per-tag cap here quietly ate the end of a legal entry: "needs
    // sponsorship, senior, referred by Ada" stopped typing at 30
    // characters and saved a tag called "ref". Cap the whole list;
    // normalizeTags still holds each tag to MAX_TAG_LENGTH.
    maxlength: String(MAX_TAGS * (MAX_TAG_LENGTH + 2)),
    placeholder,
    'aria-label': label,
    list: listId,
    ...(focusKey ? { dataset: { focusKey } } : {}),
  });
  const datalist = el(
    'datalist',
    { id: listId },
    tagCounts(candidates).map(({ tag, count }) => el('option', { value: tag }, `${tag} · ${count}`))
  );
  return { input, datalist };
}
