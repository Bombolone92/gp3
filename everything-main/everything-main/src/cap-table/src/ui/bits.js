/** Small shared view pieces. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { stakeholderKindInfo, exerciseCutoff, authorizedOverrun } from '../lib/captable.js';
import { dateLong, shares, pct } from '../lib/format.js';
import { daysBetween, todayISO } from '../lib/util.js';

/** Instruments start warning about their expiry a quarter out. */
const EXPIRY_WARN_DAYS = 90;

/**
 * Deadline line for instruments that lapse or come due (warrants, option
 * grants, note maturities). Quiet while the date is far off, warned inside
 * the last quarter, and past tense once it's gone - the status is always in
 * the words, never color alone.
 */
export function expiryNote(iso, today, { verb = 'Expires', past = 'Expired' } = {}) {
  if (!iso) return null;
  const days = daysBetween(today, iso);
  if (days < 0) return el('div.small.neg', {}, `${past} ${dateLong(iso)}`);
  if (days === 0) return el('div.small.warn', {}, `${verb} today`);
  if (days <= EXPIRY_WARN_DAYS) {
    return el('div.small.warn', {}, `${verb} in ${days} day${days === 1 ? '' : 's'}`);
  }
  return el('div.small.muted', {}, `${verb} ${dateLong(iso)}`);
}

/**
 * The deadline line for an option grant: its term's expiration, or the
 * post-termination window when that is what closes first - named as such.
 * Both went through expiryNote as "Expires", so a leaver's grant read as
 * running out its ten-year term when it was the ninety-day window closing,
 * a distinction the needs-attention list already draws.
 */
export function grantWindowNote(grant, today) {
  const cutoff = exerciseCutoff(grant);
  const window = !!grant?.exerciseBy && cutoff === grant.exerciseBy;
  return expiryNote(cutoff, today, window ? { verb: 'Window closes', past: 'Window closed' } : {});
}

/**
 * Mark a field invalid - until the user edits it, at which point the flag
 * clears itself. A stale marker would keep the field styled (and announced)
 * as wrong after the correction was already typed.
 */
export function flagInvalid(input, message = '') {
  // A button can stand in for the missing field when focus is handed over,
  // but aria-invalid is not a state a button has, and nothing would ever
  // clear it: no input event fires on a button.
  if (!input || !input.matches('input, select, textarea')) return;
  input.setAttribute('aria-invalid', 'true');
  /* The reason, tied to the field. It was said in the toast alone - a polite
     live region that the focus move onto the field can pre-empt - so a screen
     reader landed on a field marked invalid with nothing to say what was
     wrong with it. A second refusal replaces the first's note. */
  const stale = input.getAttribute('aria-errormessage');
  if (stale) document.getElementById(stale)?.remove();
  let note = null;
  if (message) {
    if (!input.id) input.id = `field-${(fieldSeq += 1)}`;
    note = el('span.visually-hidden', { id: `${input.id}-error` }, message);
    input.insertAdjacentElement('afterend', note);
    input.setAttribute('aria-errormessage', note.id);
  }
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
    note?.remove();
  }, { once: true });
}

/* Field ids are handed out from a counter rather than derived from the label:
   the same words label different controls across sheets ("Name" appears on
   three forms), and a document can hold two open dialogs at once. */
let fieldSeq = 0;

/**
 * A labelled form field: label, control, optional hint, wrapped in `.field`.
 *
 * The label is wired to its control with for/id. That is what makes the words
 * clickable - tapping "Number of shares" puts the caret in the box, which is
 * the one thing a label is for and the reason it isn't a `<div>`. It also
 * makes the accessible name the text on screen, so voice control can ask for
 * a control by the name the user can read (WCAG 2.5.3).
 *
 * Where the control carried an aria-label, that label is dropped once the
 * visible one is attached: aria-label outranks a `<label>`, so keeping both
 * would announce something other than what is written above the box -
 * "Pool size in shares" under a label reading "Reserved shares".
 *
 * Controls that can't take a label - a segmented control, a checkbox already
 * wrapped in its own `<label>` - are left exactly as they came in, with the
 * aria-label they carry, and their caption renders as a `<span>`: a `<label>`
 * with nothing to label is markup that promises a relationship it doesn't
 * have, and screen readers do announce it as a label for whatever follows.
 *
 * `hint` is usually a string, and becomes the `<p>` under the control. A hint
 * that is already a node - a block with its own button in it, like the round
 * model's pool target - is appended as it stands, since wrapping one in a `<p>`
 * is markup no parser would accept. Without that, a field carrying a built
 * hint had to be assembled by hand, and the one that was lost the `<label>`
 * with it: its caption was a `<span>`, so clicking the words did nothing on
 * the single field in the app where that was true.
 */
/**
 * The warning a sheet shows when the shares it is about to issue would take
 * their class past its authorized count - the same sentence the round close
 * review gives, so the four ways shares come onto the table say one thing.
 * `sync(db, classId, quantity, { excluding })` reads the table it is handed
 * and shows or hides the line; a status region, since it appears under a
 * field that keeps focus as the user types. Nothing is refused: the classes
 * table will say "over authorized" afterwards, and the charter amendment is
 * the cure.
 */
export function authorizedWarning() {
  // Spaced like the sheets' other standalone hints, so the next field's label does not sit on it.
  const node = el('p.field-hint.warn', { role: 'status', style: { display: 'none', margin: '-4px 0 12px' } });
  const sync = (db, classId, quantity, { excluding = null } = {}) => {
    const hit = authorizedOverrun(db, classId, quantity, { excluding });
    const next = hit && hit.over > 0
      ? `${hit.name} would hold ${shares(hit.over)} more ${hit.over === 1 ? 'share' : 'shares'} than its authorized count of ${shares(hit.authorized)}. `
        + 'That is what a charter amendment is for; raise the authorized shares under Share classes once it is signed.'
      : '';
    node.style.display = next ? '' : 'none';
    // Set only when the words change, or a live region re-reads the sentence on every digit typed.
    if (node.textContent !== next) node.textContent = next;
    return !!next;
  };
  return { node, sync };
}

export function field(label, control, hint) {
  const target = control instanceof HTMLElement
    ? (control.matches('input, select, textarea')
      ? control
      : control.querySelector('input, select, textarea'))
    : null;
  const labelable = !!target && !target.id && !target.closest('label');
  const labelEl = el(`${labelable ? 'label' : 'span'}.field-label`, {}, label);
  if (labelable) {
    target.id = `field-${++fieldSeq}`;
    labelEl.htmlFor = target.id;
    target.removeAttribute('aria-label');
  }
  const hintEl = hint instanceof Node ? hint : (hint ? el('p.field-hint', {}, hint) : null);
  /* The hint describes the control (aria-describedby), so "Standard is 48"
     is read with the field rather than being text a screen reader in forms
     mode never reaches. Only a plain hint: a built block with a button in it
     is not a description. */
  if (target && hintEl && !(hint instanceof Node)) {
    if (!target.id) target.id = `field-${++fieldSeq}`;
    hintEl.id = `${target.id}-hint`;
    target.setAttribute('aria-describedby', hintEl.id);
  }
  return el('div.field', {}, labelEl, control, hintEl);
}

/**
 * Segmented control: a row of buttons where exactly one is pressed.
 *
 * The buttons are built once and only their `aria-pressed` state changes when
 * a new one is chosen. Rebuilding the row - the obvious way to re-render the
 * new state - destroys the very button the user just activated: keyboard focus
 * falls back to the top of the document mid-interaction, and a screen reader
 * is left with no element to announce the state change on.
 *
 * `options`: [{ value, label, html?, title? }]. `onSelect(value)` runs only
 * when the pressed value actually changes. The returned element carries
 * `select(value)` for callers that move the selection from elsewhere - the
 * cap table's date field also drives its own strip of chips.
 */
export function segmented(options, {
  label = null, value = null, onSelect = null, extraClass = '', wide = false,
} = {}) {
  let current = value;
  // An option carrying an icon says so in its class: a button is not a flex
  // container by default, so the glyph and its label need one to sit on the
  // same line. See .seg-btn.has-icon in components.css.
  const buttons = options.map((o) => el(`button.seg-btn${o.html ? '.has-icon' : ''}`, {
    type: 'button',
    'aria-pressed': String(o.value === current),
    title: o.title || null,
    html: o.html || null,
    // Lets the shell hand focus back to this button when a store write
    // re-renders the whole view out from under it (the theme switcher).
    dataset: { focusKey: `${label || 'seg'}:${o.value}` },
    onclick: () => {
      if (o.value === current) return;
      seg.select(o.value);
      onSelect?.(o.value);
    },
  }, o.label));
  /* A class rather than inline styles, so the stylesheet can also let a long
     option give up its tail - see .seg-wide in components.css. */
  const seg = el(`div.seg${wide ? '.seg-wide' : ''}${extraClass ? `.${extraClass}` : ''}`, {
    role: 'group',
    'aria-label': label,
  }, buttons);
  seg.select = (next) => {
    current = next;
    for (const [i, b] of buttons.entries()) {
      b.setAttribute('aria-pressed', String(options[i].value === current));
    }
  };
  return seg;
}

/** Desktop view header: title + optional subtitle + action buttons. */
export function viewHead(title, sub, ...actions) {
  return el('div.view-head', {},
    el('div', {},
      el('h1.view-title', {}, title),
      sub ? el('p.view-sub', {}, sub) : null
    ),
    actions.length ? el('div.row', {}, actions) : null
  );
}

/** KPI stat tile: label · value · optional sub line. */
export function statTile({ label, value, sub, icon: ic }) {
  return el('div.stat-tile', {},
    el('div.stat-label', { html: ic ? icon(ic, 13, 2) : '' }, el('span', {}, label)),
    el('div.stat-value', { title: typeof value === 'string' ? value : undefined }, value),
    sub ? el('div.stat-sub', {}, sub) : null
  );
}

/* Titles that come before a name rather than being part of one. */
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'rev', 'sir']);

/**
 * Avatar initials for a holder name: first and last word, or the first two
 * letters of a single word.
 *
 * A leading title is skipped. It is not part of the name it introduces, and
 * initialling it put "DW" beside the words "Dr. Lin Wu" - close enough to
 * look deliberate, and wrong. Only while a word is left to initial, so a
 * holder recorded as "Dr. Wu" still gets their own name's letters.
 */
export function initials(name) {
  const words = String(name || '?').trim().split(/\s+/);
  if (words.length > 1 && HONORIFICS.has(words[0].replace(/\.$/, '').toLowerCase())) {
    words.shift();
  }
  /* By code point, not by UTF-16 unit: a name that opens with a character
     outside the basic plane - an emoji in a fund's display name - split its
     surrogate pair and put a replacement glyph in the avatar. */
  const first = (w) => [...w][0];
  return words.length > 1
    ? first(words[0]) + first(words[words.length - 1])
    : [...words[0]].slice(0, 2).join('');
}

/**
 * A holder's name as a picker option. A departed holder says so, since
 * inside a `<select>` the words are the only thing that can: the security,
 * transfer, and round-close pickers listed everyone alike, so a grant meant
 * for a current employee could land on the namesake who left last year with
 * nothing in the list to tell the two apart.
 */
export function holderOptionLabel(holder, today = todayISO()) {
  const name = holder?.name || 'Unknown holder';
  if (!holder?.departed) return name;
  return `${name} (${holder.departed > today ? 'departing' : 'departed'})`;
}

/**
 * "Departed Jul 1, 2026", or "Departs Jan 1, 2027" while the termination is
 * still ahead. The departure flow takes a future date - a notice period - and
 * the holder page, the list and the search read it in the past tense beside
 * a tile saying the same holder's shares were still being earned.
 */
export function departureNote(holder, today = todayISO()) {
  if (!holder?.departed) return null;
  return `${holder.departed > today ? 'Departs' : 'Departed'} ${dateLong(holder.departed)}`;
}

/**
 * The stakeholder already on the cap table under the name being typed for a
 * new one, or null. The inline "+ New stakeholder" paths - the issue sheet,
 * the transfer sheet, the round close - sit beside a picker that lists
 * everyone, so a name already in that list is a slip, and it minted a twin:
 * two "Nova Ventures", indistinguishable in every table and every export,
 * and refused by the next CSV import as ambiguous. The Stakeholders page
 * stays the place a genuine namesake is added on purpose. Case and
 * surrounding space are not a difference, as they are not on import.
 */
export function holderNamed(name, stakeholders) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  return stakeholders.find((h) => h.name.trim().toLowerCase() === key) || null;
}

/** Holder cell: avatar + name + kind, used across tables and lists. */
export function holderCell(holder, subText = null, { href = null } = {}) {
  const kind = stakeholderKindInfo(holder?.kind);
  const name = holder?.name || 'Unknown holder';
  return el('div.holder-cell', {},
    el('span.avatar', { 'aria-hidden': 'true' }, initials(holder?.name)),
    el('div.grow', {},
      // The name cell clips with an ellipsis; a long name is still readable on hover.
      el('div.t', { title: name }, href ? el('a', { href }, name) : name),
      el('div.s', {}, subText ?? kind.label)
    )
  );
}

/**
 * Vested-progress cell: the count and percentage in words, plus a meter.
 * Shared by option grants and vesting share certificates so both read the
 * same way in every table. Takes counts rather than a security because a
 * cancelled grant vests against what survived, not what was granted.
 */
export function vestingMeter(vested, total, caption = null) {
  const frac = total > 0 ? vested / total : 0;
  return el('div.vest-cell', {},
    caption ? el('div.small.muted', {}, caption) : null,
    el('span.small', {}, `${shares(vested)} vested (${pct(frac, 0)})`),
    el('div.meter', { role: 'img', 'aria-label': `Vested ${pct(frac, 0)}` },
      el('div.meter-fill', { style: { width: `${Math.min(100, frac * 100)}%` } }))
  );
}

/* h2, not h3. An empty state is the first heading inside its card, and the
   card sits directly under the view's h1 - the in-view title on a desktop
   width, the top bar's on a phone - so h3 stepped over a level that was
   never there, and a screen reader listing the page's headings reported a
   missing section around every empty view in the app. */
export function emptyState({ icon: ic, title, text, cta, onCta }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(ic, 26) }),
    el('h2', {}, title),
    el('p', {}, text),
    cta ? el('button.btn.btn-primary', { onclick: onCta, html: icon('plus', 15, 2.2) }, ` ${cta}`) : null
  );
}
