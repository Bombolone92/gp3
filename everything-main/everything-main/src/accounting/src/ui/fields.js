/** Form controls: labelled fields, money and date inputs, selects. */
import { el, nextId } from './dom.js';
import { icon } from './icons.js';
import { parseMoney, centsToInput, formatMoney } from '../lib/money.js';
import { formatDate, parseDateInput, dateShortcut, today, getDateStyle } from '../lib/dates.js';

/** <label class="field"> with a visible label, the control, and an optional hint. */
export function field(label, control, { hint, error, className = '', required = false } = {}) {
  const node = control.root || control;
  const input = control.input || (node.matches?.('input, select, textarea') ? node : node.querySelector?.('input, select, textarea'));
  const id = input?.id || nextId('f');
  if (input && !input.id) input.id = id;
  const hintId = hint ? nextId('hint') : null;
  if (hintId && input) input.setAttribute('aria-describedby', hintId);
  if (required && input) input.setAttribute('aria-required', 'true');
  return el(`div.field${className ? `.${className}` : ''}`, {},
    el('label.field-label', { htmlFor: id }, label, required ? el('span', { 'aria-hidden': 'true' }, ' *') : null),
    node,
    hint && el('span.field-hint', { id: hintId }, hint),
    error && el('span.field-error', { role: 'alert' }, error));
}

export function textInput({ value = '', placeholder = '', onInput, type = 'text', ariaLabel, maxLength, autocomplete = 'off', inputMode } = {}) {
  const input = el('input.input', { type, value: value ?? '', placeholder, 'aria-label': ariaLabel || null, maxLength: maxLength || null, autocomplete, inputMode: inputMode || null });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function textArea({ value = '', placeholder = '', onInput, rows = 3, ariaLabel } = {}) {
  const t = el('textarea.input', { rows, placeholder, 'aria-label': ariaLabel || null });
  t.value = value || '';
  if (onInput) t.addEventListener('input', () => onInput(t.value));
  return t;
}

export function selectInput({ options, value, onChange, ariaLabel } = {}) {
  const s = el('select.select', { 'aria-label': ariaLabel || null });
  for (const o of options) {
    if (o.group) {
      const g = el('optgroup', { label: o.group });
      for (const [v, l] of o.options) g.append(el('option', { value: v }, l));
      s.append(g);
    } else {
      const [v, l] = o;
      s.append(el('option', { value: v }, l));
    }
  }
  if (value !== undefined && value !== null) s.value = value;
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}

/**
 * Cents from what was typed in a money field: an amount as parseMoney reads
 * it, or simple arithmetic ("120*3", "100+25.5", "-20+5"), worked left to
 * right. Null for blank text, NaN for arithmetic it cannot follow, which a
 * money field ignores rather than guessing.
 */
export function parseAmount(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  // Currency signs and spaces are noise. A lone sign, leading or trailing as
  // banks print it, and parentheses write a negative; they are not arithmetic.
  const s = t.replace(/[^\d.,()+\-*/]/g, '');
  if (!/[+\-*/]/.test(s.replace(/^-|-$/g, ''))) return parseMoney(t);
  if (!/^-?[\d.,]+([+\-*/]-?[\d.,]+)+$/.test(s)) return NaN;
  const [first, ...rest] = s.match(/^-?[\d.,]+|[+\-*/]-?[\d.,]+/g);
  let acc = parseMoney(first) / 100;
  for (const term of rest) {
    const op = term[0];
    const n = parseMoney(term.slice(1)) / 100;
    acc = op === '+' ? acc + n : op === '-' ? acc - n : op === '*' ? acc * n : n ? acc / n : acc;
  }
  return Math.round(acc * 100);
}

/**
 * Money input. Holds cents; shows "1,234.50" when not focused, a plain
 * number while editing. Arithmetic like "120*3" or "100+25.5" is evaluated.
 */
export function moneyInput({ value = null, onChange, ariaLabel, placeholder = '', allowNegative = false, blankZero = true } = {}) {
  let cents = value;
  const input = el('input.input.num', { type: 'text', inputMode: 'decimal', autocomplete: 'off', 'aria-label': ariaLabel || null, placeholder });
  const show = () => {
    input.value = cents === null || cents === undefined || (blankZero && cents === 0) ? '' : formatMoney(cents, { plain: true });
  };
  const parse = (text) => {
    const c = parseAmount(text);
    if (Number.isNaN(c)) return cents;
    return c === null || allowNegative ? c : Math.abs(c);
  };
  // Leaving the field without typing must not change the value (a rate with
  // fractions of a cent would otherwise be rounded by a mere Tab).
  let shownOnFocus = null;
  show();
  input.addEventListener('focus', () => {
    input.value = cents === null || cents === undefined || (blankZero && cents === 0) ? '' : centsToInput(cents);
    shownOnFocus = input.value;
    input.select();
  });
  input.addEventListener('input', () => {
    if (/[+*/]/.test(input.value)) return;
    cents = parse(input.value);
    onChange?.(cents, false);
  });
  input.addEventListener('blur', () => {
    const changed = input.value !== shownOnFocus;
    shownOnFocus = null;
    if (changed) cents = parse(input.value);
    show();
    if (changed) onChange?.(cents, true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && /[+\-*/]/.test(input.value.slice(1))) {
      cents = parse(input.value);
      input.value = centsToInput(cents);
      onChange?.(cents, false);
    }
  });
  return {
    root: input,
    input,
    get value() { return cents; },
    set value(v) { cents = v; if (document.activeElement !== input) show(); else input.value = centsToInput(v); },
  };
}

/**
 * Date input: type a date in the company style or use the picker. Single
 * keys are shortcuts: + and - a day, T today, W/K week start/end, M/H month
 * start/end, Y/R year start/end.
 */
export function dateInput({ value = null, onChange, ariaLabel, required = false } = {}) {
  let iso = value;
  const input = el('input.input', { type: 'text', autocomplete: 'off', 'aria-label': ariaLabel || null, placeholder: { mdy: 'mm/dd/yyyy', dmy: 'dd/mm/yyyy', ymd: 'yyyy-mm-dd' }[getDateStyle()], inputMode: 'numeric' });
  const picker = el('input', { type: 'date', tabIndex: -1, 'aria-hidden': 'true', style: { position: 'absolute', opacity: 0, width: '1px', height: '1px', pointerEvents: 'none', right: '6px', bottom: 0 } });
  const btn = el('button.input-btn', { type: 'button', 'aria-label': 'Choose date', html: icon('calendar', 16) });
  const root = el('div.input-wrap', {}, input, btn, picker);
  const show = () => { input.value = iso ? formatDate(iso) : ''; };
  const commit = (next, fire = true) => {
    const changed = next !== iso;
    iso = next;
    show();
    if (fire && changed) onChange?.(iso);
  };
  show();
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // A dash is a separator while a new date is being typed ("11-05-2026"),
    // and always in year-month-day style; on the date shown, or all of the
    // text selected, it is "previous day".
    const typing = input.value.trim() !== '' && input.value !== (iso ? formatDate(iso) : '')
      && !(input.selectionStart === 0 && input.selectionEnd === input.value.length);
    if (e.key === '-' && (typing || getDateStyle() === 'ymd')) return;
    // Shortcuts start from the date typed so far, if it is one.
    const next = dateShortcut(parseDateInput(input.value) || iso, e.key, today());
    if (next) {
      e.preventDefault();
      commit(next);
      input.select();
    }
  });
  input.addEventListener('blur', () => {
    const parsed = parseDateInput(input.value);
    if (parsed) commit(parsed);
    else if (!input.value.trim() && !required) commit(null);
    else show();
  });
  btn.addEventListener('click', () => {
    picker.value = iso || today();
    try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
  });
  picker.addEventListener('change', () => {
    if (picker.value) commit(picker.value);
    input.focus();
  });
  return {
    root,
    input,
    get value() { return iso; },
    set value(v) { iso = v; show(); },
  };
}

/** A segmented single-choice control. */
export function segmented({ options, value, onChange, ariaLabel }) {
  const root = el('div.segmented', { role: 'radiogroup', 'aria-label': ariaLabel || null });
  const buttons = options.map(([v, label]) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), tabIndex: v === value ? 0 : -1 }, label);
    b.addEventListener('click', () => select(v, true));
    b.addEventListener('keydown', (e) => {
      const i = options.findIndex((o) => o[0] === value);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(options[(i + 1) % options.length][0], true); buttons[(i + 1) % options.length].focus(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); const j = (i - 1 + options.length) % options.length; select(options[j][0], true); buttons[j].focus(); }
    });
    root.append(b);
    return b;
  });
  function select(v, fire) {
    value = v;
    buttons.forEach((b, i) => {
      const on = options[i][0] === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (fire) onChange?.(v);
  }
  return { root, get value() { return value; }, set value(v) { select(v, false); } };
}

export function checkbox({ checked = false, label, onChange, ariaLabel } = {}) {
  const input = el('input', { type: 'checkbox', checked, 'aria-label': label ? null : ariaLabel || null });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  if (!label) return input;
  return el('label.check', {}, input, el('span', {}, label));
}
