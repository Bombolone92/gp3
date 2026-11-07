/**
 * A month field that speaks 'YYYY-MM' (empty for "no month") in every browser.
 *
 * `<input type="month">` has a picker in Chrome, Edge, and on every phone,
 * but Firefox and desktop Safari have never shipped one: there the control
 * falls back to a bare text box holding "2026-09", with nothing to say what
 * shape it wants, and a hiring plan's start month became a field to be typed
 * by hand in the right format. Where the native control is missing, a month
 * and a year select stand in - the same value either way, so callers read
 * one thing.
 */

import { el } from './dom.js';

/* Short names, the way monthLabel writes a month everywhere else in the app
   ("Sep 2026") - and the fallback often sits in half a form row, where the
   long ones are clipped by the select's own chevron. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* How far the year select reaches around the current year. A hiring plan
   looks a year or two ahead; a row from a saved plan can already sit further
   out, and it is always kept in range so editing it never silently moves it. */
const YEARS_BACK = 1;
const YEARS_AHEAD = 5;

/** Whether this browser renders type="month" as a real month control. */
export function supportsMonthInput() {
  const probe = document.createElement('input');
  probe.setAttribute('type', 'month');
  // An unsupported type reads back as 'text'.
  return probe.type === 'month';
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Build the field. Returns { node, value, focus }: `node` goes in the form,
 * `value` reads 'YYYY-MM' or '' live, `focus()` puts the caret in it.
 *
 * `allowEmpty` offers "Not scheduled" on the fallback, matching the native
 * control's own clearable state. `native` forces one rendering or the other
 * (tests and previews); left null, the browser decides.
 */
export function monthField({
  value = '', label = 'Month', allowEmpty = true, native = null,
} = {}) {
  const useNative = native === null ? supportsMonthInput() : native;
  const initial = /^\d{4}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';

  if (useNative) {
    const input = el('input.input', { type: 'month', value: initial, 'aria-label': label });
    return {
      node: input,
      get value() { return input.value; },
      focus: () => input.focus(),
    };
  }

  const now = new Date();
  const [pickedYear, pickedMonth] = initial ? initial.split('-').map(Number) : [null, null];
  const anchorYear = pickedYear ?? now.getFullYear();
  const first = Math.min(now.getFullYear() - YEARS_BACK, anchorYear);
  const last = Math.max(now.getFullYear() + YEARS_AHEAD, anchorYear);
  const years = [];
  for (let y = first; y <= last; y++) years.push(y);

  /* The month select is what `field()` attaches the visible caption to (the
     first control it finds), so it carries the plain label; the year select
     keeps a name of its own. */
  const monthSelect = el('select.select', { 'aria-label': label },
    allowEmpty ? el('option', { value: '', selected: pickedMonth === null }, 'Not scheduled') : null,
    MONTHS.map((name, i) => el('option', {
      value: pad(i + 1), selected: pickedMonth === i + 1,
    }, name)));
  const yearSelect = el('select.select', { 'aria-label': `${label} year` },
    years.map((y) => el('option', { value: String(y), selected: y === anchorYear }, String(y))));
  if (!allowEmpty && pickedMonth === null) monthSelect.value = pad(now.getMonth() + 1);

  const node = el('div.month-pair', {},
    el('div.select-wrap', {}, monthSelect),
    el('div.select-wrap', {}, yearSelect));
  return {
    node,
    get value() {
      return monthSelect.value ? `${yearSelect.value}-${monthSelect.value}` : '';
    },
    focus: () => monthSelect.focus(),
  };
}
