import { el, isComposing } from './dom.js';

/** Exclusive dialog choices: one tab stop, with arrow keys selecting adjacent options. */
export function segmented(options, value, onPick, label) {
  const selected = options.findIndex(([v]) => v === value);
  const buttons = options.map(([v, text], i) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(value === v),
    tabindex: i === Math.max(0, selected) ? 0 : -1,
    onclick: () => {
      for (const button of buttons) {
        button.setAttribute('aria-checked', String(button === buttons[i]));
        button.tabIndex = button === buttons[i] ? 0 : -1;
      }
      onPick(v);
    },
  }, text));
  const group = el('div.segmented', {
    role: 'radiogroup', 'aria-label': label,
    onkeydown: (e) => {
      // A menu around the group has already moved focus for Up and Down; stepping again would pick an option.
      if (isComposing(e) || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      const enabled = buttons.filter((button) => !button.matches(':disabled') && !button.hidden);
      const at = enabled.indexOf(document.activeElement);
      if (at < 0) return;
      e.preventDefault();
      e.stopPropagation();
      const next = enabled[(at + step + enabled.length) % enabled.length];
      next.click();
      next.focus();
    },
  }, buttons);
  /** Show `v` as the choice without reporting a pick (the dialog derived it from another field). */
  group.select = (v) => {
    const i = options.findIndex(([x]) => x === v);
    if (i < 0) return;
    for (const button of buttons) {
      button.setAttribute('aria-checked', String(button === buttons[i]));
      button.tabIndex = button === buttons[i] ? 0 : -1;
    }
  };
  return group;
}
