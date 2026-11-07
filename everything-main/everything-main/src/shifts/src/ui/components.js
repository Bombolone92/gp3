/** Shared UI building blocks. */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';

/**
 * The single viewport breakpoint the layout switches on (kept in step
 * with styles/main.css). Views that render a different structure below
 * it read `isMobileViewport()`; the shell re-renders when it flips.
 */
export const MOBILE_QUERY = '(max-width: 767px)';

export function isMobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Props that make a non-button element act like one for keyboards and
 * assistive tech. Only for elements with no interactive descendants.
 */
export function buttonize(onClick) {
  return {
    role: 'button',
    tabindex: 0,
    onClick,
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    },
  };
}

export function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    // Take the first code point, not the first UTF-16 unit: indexing
    // would cut characters like emoji in half and render broken glyphs.
    .map((p) => [...p][0].toUpperCase())
    .join('');
}

export function avatar(employee, size = '') {
  if (!employee) {
    return el('span', { class: `avatar ${size}`, style: { '--emp': 'var(--text-3)' } }, '?');
  }
  return el(
    'span',
    { class: `avatar ${size}`, style: { '--emp': employee.color }, title: employee.name },
    initials(employee.name)
  );
}

export function badge(text, variant = '') {
  return el('span', { class: `badge${variant ? ` badge-${variant}` : ''}` }, text);
}

/**
 * Plain-English name for a palette color, for swatch labels and
 * tooltips. A hex code is what the value is, not what it looks like:
 * read aloud it is ten characters of noise, and hovered it tells a
 * sighted user nothing the dot itself doesn't. Colors that came from an
 * imported record aren't in the palette, so they keep the raw value.
 */
const COLOR_NAMES = {
  '#6366f1': 'Indigo',
  '#0ea5e9': 'Sky',
  '#10b981': 'Emerald',
  '#f59e0b': 'Amber',
  '#ef4444': 'Red',
  '#8b5cf6': 'Violet',
  '#14b8a6': 'Teal',
  '#f97316': 'Orange',
  '#ec4899': 'Pink',
  '#84cc16': 'Lime',
};

export function colorName(hex) {
  return COLOR_NAMES[String(hex ?? '').toLowerCase()] ?? hex;
}

/**
 * Color swatches as a proper ARIA radiogroup: one tab stop for the whole
 * set, with arrows (plus Home and End) moving between the options.
 *
 * They already announced themselves as radios, which is a promise that
 * the arrow keys work, and they did nothing. Ten separately tabbable
 * swatches also made Color the longest stretch of the employee dialog:
 * half of its tab stops were colored dots.
 *
 * `onPick` receives the chosen color, or null for the "No color" option
 * that `allowNone` puts at the front.
 */
export function colorSwatches(colors, selected, onPick, { ariaLabel, allowNone = false } = {}) {
  const values = allowNone ? [null, ...colors] : colors;
  const group = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': ariaLabel });
  const swatchValues = new WeakMap();

  /** Exactly one swatch is tabbable: the checked one, or else the first. */
  function syncTabStops() {
    const buttons = [...group.children];
    const target = buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0];
    for (const b of buttons) b.tabIndex = b === target ? 0 : -1;
  }

  function select(button, { focus = false } = {}) {
    for (const b of group.children) b.setAttribute('aria-checked', String(b === button));
    syncTabStops();
    if (focus) button.focus();
    onPick(swatchValues.get(button) ?? null);
  }

  for (const value of values) {
    const label = value ? colorName(value) : 'No color';
    const button = el('button', {
      type: 'button',
      class: `swatch${value ? '' : ' swatch-none'}`,
      role: 'radio',
      'aria-checked': String(value === selected),
      'aria-label': label,
      title: label,
      style: value ? { '--emp': value } : {},
      onClick: (e) => select(e.currentTarget),
      onKeydown: (e) => {
        const buttons = [...group.children];
        const index = buttons.indexOf(e.currentTarget);
        // Both axes walk the same list: the swatches wrap onto a second
        // row, so there is no separate column to move down through.
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (step) {
          e.preventDefault();
          select(buttons[(index + step + buttons.length) % buttons.length], { focus: true });
        } else if (e.key === 'Home') {
          e.preventDefault();
          select(buttons[0], { focus: true });
        } else if (e.key === 'End') {
          e.preventDefault();
          select(buttons[buttons.length - 1], { focus: true });
        }
      },
    });
    swatchValues.set(button, value);
    group.appendChild(button);
  }
  syncTabStops();
  return group;
}

const SWAP_BADGES = {
  pending: ['Pending', 'warning'],
  approved: ['Approved', 'success'],
  declined: ['Declined', 'danger'],
  cancelled: ['Cancelled', ''],
};

export function swapStatusBadge(status) {
  const [label, variant] = SWAP_BADGES[status] ?? [status, ''];
  return badge(label, variant);
}

const ATTENDANCE_BADGES = {
  present: ['Present', 'success'],
  late: ['Late', 'warning'],
  absent: ['Absent', 'danger'],
};

export function attendanceBadge(status) {
  const [label, variant] = ATTENDANCE_BADGES[status] ?? ['Not recorded', ''];
  return badge(label, variant);
}

export function emptyState({ iconName = 'calendar', title, message, actions = [] }) {
  return el(
    'div',
    { class: 'empty-state' },
    icon(iconName, 30),
    el('h3', {}, title),
    message ? el('p', {}, message) : null,
    actions.length ? el('div', { class: 'empty-actions' }, actions) : null
  );
}

export function statCard({ label, value, sub, iconName, onClick }) {
  return el(
    'div',
    { ...(onClick ? buttonize(onClick) : {}), class: 'card stat-card' },
    el('div', { class: 'stat-top' }, el('span', { class: 'stat-label' }, label), icon(iconName, 17)),
    el('div', { class: 'stat-value' }, value),
    sub ? el('div', { class: 'stat-sub' }, sub) : null
  );
}

/**
 * Segmented control. `focusKeyPrefix` tags each button so focus survives
 * the re-render its own click triggers (see render() in app.js).
 */
export function segmented(options, value, onChange, { focusKeyPrefix = null } = {}) {
  const group = el('div', { class: 'segmented', role: 'group' });
  for (const opt of options) {
    group.appendChild(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(opt.value === value),
          dataset: focusKeyPrefix ? { focusKey: `${focusKeyPrefix}:${opt.value}` } : null,
          onClick: () => onChange(opt.value),
        },
        opt.label
      )
    );
  }
  return group;
}

export function field(labelText, control, id) {
  control.id = id ?? (control.id || uid('fld'));
  return el('div', { class: 'field' }, el('label', { for: control.id }, labelText), control);
}

/** <select> of employees. Include `emptyLabel` to allow an unassigned option. */
export function employeeSelect(employees, selectedId, { emptyLabel = null, describe } = {}) {
  const select = el('select', { class: 'select' });
  if (emptyLabel) {
    select.appendChild(el('option', { value: '' }, emptyLabel));
  }
  for (const emp of employees) {
    const extra = describe ? describe(emp) : '';
    select.appendChild(
      el('option', { value: emp.id, selected: emp.id === selectedId }, `${emp.name}${extra}`)
    );
  }
  if (!emptyLabel && selectedId == null && employees.length > 0) select.selectedIndex = 0;
  return select;
}

/**
 * Ranked staffing suggestions (see suggestAssignees) with a one-tap
 * assign button per candidate.
 */
export function suggestionList(suggestions, onAssign) {
  return el(
    'div',
    { class: 'suggest-list' },
    suggestions.map((s) =>
      el(
        'div',
        { class: 'suggest-row' },
        avatar(s.employee, 'avatar-sm'),
        el(
          'div',
          { class: 'suggest-main' },
          el('div', { class: 'suggest-name' }, s.employee.name),
          el('div', { class: 'suggest-why' }, s.reasons.join(' · '))
        ),
        el(
          'button',
          { class: 'btn btn-sm', type: 'button', onClick: (e) => onAssign(s, e.currentTarget) },
          'Assign'
        )
      )
    )
  );
}

/**
 * Puts a validation message into a form's error slot and brings it into
 * view. Those slots sit at the end of the dialog content, so in a modal
 * whose body is scrolled up an appended message lands out of sight and
 * pressing the save button just looks like it did nothing.
 *
 * Scrolling only helps someone who can see the message. role="alert"
 * is the same fix for a screen reader: focus stays on the save button
 * the user just pressed, and the reason it did nothing is spoken
 * instead of sitting silently at the bottom of the dialog.
 */
export function showFormError(box, message) {
  const note = el('div', { class: 'form-error', role: 'alert' }, icon('circle-alert', 15), message);
  box.replaceChildren(note);
  note.scrollIntoView({ block: 'nearest' });
}

/**
 * A node that keeps its own text up to date, for a shift that is
 * running: nothing writes to the store while somebody is on the clock,
 * so no re-render would come to move the number along. The timer stops
 * itself once a later render takes the node out of the document.
 */
export function liveText(compute, { className = null, intervalMs = 30000 } = {}) {
  const node = el('span', { class: className }, compute());
  const timer = setInterval(() => {
    if (!node.isConnected) {
      clearInterval(timer);
      return;
    }
    node.textContent = compute();
  }, intervalMs);
  return node;
}

/** `focusKey`: see segmented() and render() in app.js. */
export function switchControl(checked, onChange, ariaLabel, { focusKey = null } = {}) {
  return el(
    'label',
    { class: 'switch' },
    el('input', {
      type: 'checkbox',
      checked,
      'aria-label': ariaLabel,
      dataset: focusKey ? { focusKey } : null,
      onChange: (e) => onChange(e.target.checked),
    }),
    el('span', { class: 'track' })
  );
}
