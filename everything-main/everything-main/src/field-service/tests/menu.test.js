// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { h } from '../src/ui/dom.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});

describe('popovers', () => {
  it('Escape closes a popover opened from a dialog without closing the dialog too', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = h('button', { type: 'button' }, 'Assign team');
    const dlg = openDialog({ title: 'Visit', body: anchor });
    const box = h('input', { type: 'checkbox' });
    const pop = openPopover(anchor, h('label', box, 'Sam'));
    expect(dlg.dialog.contains(pop.el)).toBe(true);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    box.dispatchEvent(esc);
    expect(pop.el.isConnected).toBe(false);
    // The browser closes the dialog as the default action of an Escape
    // keydown that nothing cancelled.
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(anchor);
    dlg.close();
  });

  it('hands focus back to the menu button when an item is chosen, so a dialog it opens can return there', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const anchor = h('button', { type: 'button' }, 'More actions');
    document.body.append(anchor);
    anchor.focus();
    let focusedDuringRun = null;
    openMenu(anchor, [{ label: 'Delete', run: () => (focusedDuringRun = document.activeElement) }]);
    const item = document.querySelector('[role="menuitem"]');
    expect(document.activeElement).toBe(item);
    item.click();
    expect(item.isConnected).toBe(false);
    expect(focusedDuringRun).toBe(anchor);
    anchor.remove();
  });

  it('hands focus back to the button when a popover closes with focus inside it', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = h('button', { type: 'button' }, 'Account');
    document.body.append(anchor);
    anchor.focus();
    const pop = openPopover(anchor, h('button', { type: 'button' }, 'Keyboard shortcuts'));
    expect(pop.el.contains(document.activeElement)).toBe(true);
    pop.close();
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });
});
