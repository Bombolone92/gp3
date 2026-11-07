/** Small shared view pieces. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { docStatus, STATUS_META } from '../lib/doc.js';
import { docTotals, fmtMoney } from '../lib/money.js';
import { fmtDate, todayISO } from '../lib/dates.js';
import { overdueAmount } from '../lib/aging.js';
import { TAX_NOTE_PRESETS, isTaxNotePreset } from '../lib/taxnote.js';

/** Status as text in a toned pill; color never carries the meaning alone. */
export function statusChip(status, { small = false } = {}) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return el(`span.status-chip.tone-${meta.tone}${small ? '.small' : ''}`, {}, meta.label);
}

/** What a document is for, in one line: its line items, briefly. */
function itemsSummary(doc) {
  const names = (doc.items || []).map((i) => i.name).filter(Boolean);
  if (!names.length) return 'No line items';
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

/**
 * One document row for lists; a real link, so keyboard and middle-click work.
 * On a client's own page the client name is already the heading, so the row
 * says what the document is for instead of repeating it.
 */
export function docRow(doc, { showClient = true } = {}) {
  const client = store.client(doc.clientId);
  const t = docTotals(doc);
  const today = todayISO();
  const status = docStatus(doc, today);
  // On a payment plan only the installment whose date has passed is late;
  // beside an Overdue chip "$1,902.40 due" read as though all of it were,
  // and the Overdue list's footer — which counts the late part, as Home's
  // tile does — then disagreed with the rows above it. Said the way Home's
  // attention row says it: the late part of the whole.
  const late = doc.kind === 'invoice' && status === 'overdue' ? overdueAmount(doc, today) : 0;
  const partLate = late > 0.005 && late < t.balance - 0.005;
  // Whenever some is paid and some is owed, the row must say what is
  // actually due; that includes partly paid invoices that have gone
  // overdue, whose derived status is 'overdue' rather than 'partial'. Not
  // when nothing is owed any more, though: a written-off invoice's balance
  // is the part given up on, and "$1,802.40 due" beside "Written off" said
  // the opposite of what the document's own page says (its Payments card
  // keeps the same list of states quiet).
  const showBalance = doc.kind === 'invoice' && (t.paid > 0.005 || partLate) && t.balance > 0.005
    && !['draft', 'void', 'writtenOff'].includes(status);
  return el('a.doc-row', { href: `#/doc/${doc.id}` },
    el('span.doc-row-ic', { html: icon(doc.kind === 'quote' ? 'quote' : 'invoice', 17, 1.6) }),
    el('span.doc-row-main', {},
      el('span.doc-row-title', {},
        el('span.doc-row-number', {}, doc.number),
        ' ',
        el('span.doc-row-client', {}, showClient
          ? (client ? (client.company || client.name || 'Client') : 'No client')
          : itemsSummary(doc))),
      el('span.doc-row-sub', {}, fmtDate(doc.issueDate))),
    el('span.doc-row-end', {},
      el('span.doc-row-amount', {},
        fmtMoney(t.total, doc.currency),
        showBalance && el('span.doc-row-due', {}, partLate
          ? `${fmtMoney(late, doc.currency)} of ${fmtMoney(t.balance, doc.currency)} due`
          : `${fmtMoney(t.balance, doc.currency)} due`)),
      statusChip(status, { small: true }))
  );
}

/**
 * A search box that filters on a pause rather than on every keystroke. The
 * delay is short enough to feel immediate and long enough that a burst of
 * typing costs one render instead of one per character.
 */
export function debounceInput(fn, ms = 120) {
  let timer;
  const run = (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(value), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

/**
 * Give a button back the focus it took from itself.
 *
 * Setting the `disabled` property blurs the pressed control, so a keyboard
 * user is standing on <body> by the time the write settles. On the failure
 * path that matters: the button is live again and "try again" is the obvious
 * next move, but reaching it means tabbing in from the top of the page.
 * A no-op unless focus really was dropped, so a handler that placed it
 * somewhere deliberate wins.
 */
export function refocus(button) {
  if (document.activeElement !== document.body) return;
  if (button?.isConnected && !button.disabled && !button.hidden) button.focus();
}

/**
 * Focus, carried across a re-render that rebuilds a whole view.
 *
 * Every list here repaints on any store change, and a change lands without
 * the user asking for it: a recurring invoice drafted at boot, a slow save
 * settling. The rebuild destroys whatever control held focus and drops a
 * keyboard user at the top of the page. Call before clearing, call the
 * returned function after refilling: the replacement is found by the
 * accessible name it shares with the control it stands in for.
 *
 *   const restore = keepFocus(root);
 *   clear(root); ...; restore();
 */
export function keepFocus(root) {
  const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  // Only what a keyboard could land on: a hidden file picker or a disabled
  // button matches the selector but cannot take focus, and an heir that
  // cannot take it leaves the user on <body>.
  const candidates = () => [...root.querySelectorAll(FOCUSABLE)]
    .filter((c) => !c.disabled && !c.hidden && !c.closest('[hidden]'));
  const had = document.activeElement;
  if (!root.contains(had) || !had.matches(FOCUSABLE)) return () => {};
  // An input's type is part of its identity: a bare checkbox and the file
  // picker beside it both have no text and no label of their own.
  const name = (c) => `${c.tagName}${c.type ? `[${c.type}]` : ''}:${(c.getAttribute('aria-label') || c.textContent || '').trim()}`;
  const key = name(had);
  const at = candidates().indexOf(had);
  return () => {
    // A handler that already placed focus somewhere deliberate wins.
    if (root.contains(document.activeElement)) return;
    const next = candidates();
    // Position is the fallback, because plenty of these controls carry a live
    // figure in their name — a stat tile reading "Outstanding $5,272.40" is a
    // different string the moment a payment lands, which is precisely when
    // the repaint happens. The control standing where the old one stood is
    // the one that replaced it.
    const heir = next.find((c) => name(c) === key) || next[Math.min(at, next.length - 1)];
    if (heir) {
      heir.focus();
      if (document.activeElement === heir) return;
    }
    // Nothing left to stand on: the last row was filtered away, or the last
    // receipt deleted, and what replaced the list is an empty state with no
    // control in it. Park on the main region rather than <body>, so the next
    // Tab carries on from the content instead of restarting at the top of the
    // navigation — the same landing the toasts and dialogs use.
    const main = document.getElementById('main');
    main?.setAttribute('tabindex', '-1');
    main?.focus({ preventScroll: true });
  };
}

export function emptyState(iconName, title, sub, action = null) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(iconName, 22, 1.6) }),
    el('h3', {}, title),
    sub && el('p', {}, sub),
    action
  );
}

export function pageHead(title, sub, ...actions) {
  return el('div.page-head', {},
    el('div', {},
      el('h1.page-title', {}, title),
      sub && el('p.page-sub', {}, sub)),
    actions.length ? el('div.page-actions', {}, actions) : null
  );
}

/**
 * Labeled form field. The id lands on the actual form control (which may be
 * nested inside a wrapper like .select-wrap), never on the wrapper itself,
 * so the label association always points at a labelable element and ids
 * stay unique.
 */
let fieldSeq = 0;
export function field(label, control, { hint = null, group = false } = {}) {
  // A control that is really a set of controls (the tax rows with their add
  // button) is labelled as a group: a for-association would single out one
  // input — chosen at creation, when the set may still be empty, and
  // destroyed by the set's next re-render.
  if (group) {
    const labelEl = el('span.field-label', { id: `f-${++fieldSeq}` }, label,
      hint && el('span.field-hint', {}, ` ${hint}`));
    return el('div.field', { role: 'group', 'aria-labelledby': labelEl.id },
      labelEl, control);
  }
  const target = control.matches?.('input, select, textarea')
    ? control
    : control.querySelector?.('input, select, textarea');
  if (target && !target.id) target.id = `f-${++fieldSeq}`;
  return el('div.field', {},
    el('label.field-label', target ? { for: target.id } : {}, label,
      hint && el('span.field-hint', {}, ` ${hint}`)),
    control
  );
}

export function selectWrap(select) {
  return el('div.select-wrap', {}, select);
}

/** Trigger a client-side file download. */
export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, { icon: 'copy' });
    return true;
  } catch {
    toast('Could not copy. Long-press or select the text instead', { icon: 'alert' });
    return false;
  }
}

/** Per-currency totals, rendered as stacked lines (most users see one). */
export function moneyLines(byCurrency, { zero = '0' } = {}) {
  const entries = Object.entries(byCurrency).filter(([, v]) => Math.abs(v) > 0.005);
  if (!entries.length) return el('span.stat-zero', {}, zero);
  return el('span.money-lines', {}, entries.map(([cur, amount]) =>
    el('span', {}, fmtMoney(amount, cur))));
}

/**
 * The picker for the sentence a zero-tax document prints: the shipped
 * wordings, "none", and free text. Shared by Settings, the client form, and
 * the editor so the three can never offer different answers.
 *
 * `inheritLabel` names the '' option where inheriting means something (a
 * client inherits Settings, a document inherits its client); Settings itself
 * is the base, so there '' simply means no note.
 *
 * read() returns { value } or { error, focus } — a chosen "Custom wording"
 * with an empty box is a state Save would silently drop, so it refuses.
 */
export function taxNoteControl(stored, { inheritLabel = null } = {}) {
  const value = String(stored || '');
  const isCustom = !!value && value !== 'none' && !isTaxNotePreset(value);
  const custom = el('input.input.tax-note-custom', {
    value: isCustom ? value : '',
    placeholder: 'e.g. Reverse charge: VAT to be accounted for by the recipient.',
    maxlength: '200',
    'aria-label': 'Tax note wording',
  });
  const select = el('select.select', {
    'aria-label': 'Tax note',
    onchange: () => sync(),
  },
    inheritLabel ? el('option', { value: '', selected: !value }, inheritLabel) : null,
    el('option', {
      value: 'none',
      selected: inheritLabel ? value === 'none' : (!value || value === 'none'),
    }, 'No note'),
    TAX_NOTE_PRESETS.map((p) => el('option', { value: p.id, selected: value === p.id }, p.label)),
    el('option', { value: 'custom', selected: isCustom }, 'Custom wording…'));

  function sync() {
    custom.hidden = select.value !== 'custom';
  }
  sync();

  const node = el('div.tax-note-control', {}, selectWrap(select), custom);
  return {
    node,
    select,
    custom,
    onChange: (fn) => {
      select.addEventListener('change', fn);
      custom.addEventListener('input', fn);
    },
    read: () => {
      if (select.value !== 'custom') {
        // Settings has no "inherit", so its "No note" is simply an empty value.
        return { value: !inheritLabel && select.value === 'none' ? '' : select.value };
      }
      const text = custom.value.trim();
      if (!text) return { error: 'Enter the wording to print, or choose a preset', focus: custom };
      return { value: text };
    },
  };
}
