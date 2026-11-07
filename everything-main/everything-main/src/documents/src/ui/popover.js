import { el } from './dom.js';
import { iconEl } from './icons.js';
import { openMenu } from './menu.js';

/** An anchored, non-modal form. Shares menu dismissal and viewport placement. */
export function openPopover({ anchor = document.activeElement, label, content, focusFirst = true }) {
  let popup;
  const close = el('button.icon-btn', { type: 'button', 'aria-label': `Close ${label.toLowerCase()}`, onclick: () => popup.close() }, iconEl('x', 16));
  popup = openMenu({ anchor, label, role: 'dialog', className: 'editor-popover', focusFirst: false,
    items: [{ custom: el('div.popover-heading', {}, el('strong', {}, label), close) }, { custom: content }] });
  if (focusFirst) popup.menu?.querySelector('form input:not([disabled]), form select:not([disabled]), form button')?.focus();
  return popup;
}
