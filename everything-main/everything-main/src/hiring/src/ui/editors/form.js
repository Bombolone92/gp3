/** Shared bits for editor modals. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { safeHttpUrl } from '../../lib/url.js';
import { browserTimeZone, knownTimeZones, zoneAbbreviation, zoneLabel } from '../../lib/zones.js';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'INR', 'JPY'];

export function errorRegion() {
  const node = el('div', { class: 'error-region', 'aria-live': 'polite' });
  return {
    node,
    show(message) {
      node.replaceChildren(el('div', { class: 'form-error' }, icon('circle-alert', 15), message));
      // The region sits at the end of the form, and Save sits in the
      // dialog's fixed footer — so on any body long enough to scroll
      // (every editor on a phone, the job editor on a laptop) the reason
      // a save was refused rendered below the fold. The button came back
      // to life and nothing else happened. Bring it into view; `nearest`
      // scrolls the dialog body the minimum needed and does nothing when
      // the message is already on screen.
      node.scrollIntoView({ block: 'nearest' });
    },
    clear() {
      node.replaceChildren();
    },
  };
}

export function optionSelect(options, selected) {
  const entries = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  // A stored value outside the list (an older or hand-edited record)
  // would match no option, so the browser shows the first one and Save
  // silently rewrites the field. Keep the real value selectable instead.
  if (selected != null && selected !== '' && !entries.some((o) => o.value === selected)) {
    entries.push({ value: selected, label: String(selected) });
  }
  return el(
    'select',
    { class: 'select' },
    entries.map((o) => el('option', { value: o.value, selected: o.value === selected }, o.label))
  );
}

/**
 * A number/date input reports '' both when left blank and when the typed
 * text couldn't be parsed (a pasted "$5,000", a date missing its year).
 * Blank is a legitimate "not stated"; unparseable input must fail the
 * save — the field still shows the user's text, so a success toast that
 * silently stored null would be a lie.
 */
export function parsedValue(input, label) {
  if (input.validity?.badInput) {
    const kind = input.type === 'date' ? 'complete date' : 'number';
    throw new Error(`${label} isn’t a ${kind}. Fix it or clear the field.`);
  }
  return input.value;
}

/**
 * A link field's value, checked against the same safeHttpUrl every
 * renderer guards hrefs with. A value it rejects (a pasted email, a
 * dotless "zoom") would save fine and then never display anywhere —
 * no chip on the profile, no Join button — with nothing telling the
 * user their link is inert. Blank stays a legitimate "no link".
 */
export function linkValue(input, label) {
  const value = input.value.trim();
  if (value && !safeHttpUrl(value)) {
    throw new Error(`${label} doesn’t look like a web address. Use a full link like https://example.com/….`);
  }
  return value;
}

/** Disable the button, run the async action, surface errors in `errors`. */
export async function runSave(button, errors, action) {
  errors.clear();
  button.disabled = true;
  try {
    await action();
    return true;
  } catch (err) {
    button.disabled = false;
    errors.show(err.message ?? 'Something went wrong.');
    return false;
  }
}

/**
 * A time-zone picker over what the browser's own zone database lists —
 * the app ships no zone data. This device's zone is offered first because
 * it is the answer almost every time; `emptyLabel` adds an explicit
 * "not set" option for the fields where not knowing is legitimate.
 */
export function timeZoneSelect(selected, { emptyLabel = null } = {}) {
  const current = String(selected ?? '');
  const own = browserTimeZone();
  const option = (value, label) => el('option', { value, selected: value === current }, label);
  const select = el('select', { class: 'select' });
  if (emptyLabel) select.appendChild(option('', emptyLabel));
  if (own) {
    const abbr = zoneAbbreviation(own);
    select.appendChild(
      el('optgroup', { label: 'This device' }, option(own, `${zoneLabel(own)}${abbr ? ` · ${abbr}` : ''}`))
    );
  }
  const rest = knownTimeZones().filter((zone) => zone !== own);
  // A stored zone this browser does not list stays selectable, the way
  // optionSelect keeps an unknown value: saving must not silently move an
  // interview to another zone.
  if (current && current !== own && !rest.includes(current)) rest.unshift(current);
  select.appendChild(el('optgroup', { label: 'All time zones' }, rest.map((zone) => option(zone, zoneLabel(zone)))));
  return select;
}
