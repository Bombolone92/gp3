// @vitest-environment jsdom
/** Second adversarial review: router and shared UI pieces outside a view. */
import { describe, it, expect } from 'vitest';
import { route, parse } from '../src/ui/router.js';

route('/children/:id', 'child');

describe('router', () => {
  it('a link with a broken percent escape still routes instead of throwing', () => {
    expect(() => parse('#/children/%E0%A4')).not.toThrow();
    expect(parse('#/children/%E0%A4').name).toBe('child');
    expect(parse('#/children/ab%20c').params.id).toBe('ab c');
  });
});

describe('Escape inside a dialog', () => {
  // A keydown Escape that is not default-prevented becomes the dialog's close
  // request, so a search box or menu inside a dialog closed the whole dialog.
  const esc = (el) => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it('clearing a search box does not also close the dialog', async () => {
    const { searchBox } = await import('../src/ui/components.js');
    const box = searchBox({ onInput: () => {} });
    document.body.append(box);
    const input = box.querySelector('input');
    input.value = 'ab';
    expect(esc(input).defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    // With nothing to clear, Escape is left for the dialog.
    expect(esc(input).defaultPrevented).toBe(false);
    box.remove();
  });

  it('closing a combobox list does not also close the dialog', async () => {
    const { combobox } = await import('../src/ui/components.js');
    HTMLElement.prototype.scrollIntoView ||= function () {};
    const cb = combobox({ items: () => ['Ava', 'Ben'], itemLabel: (x) => x, onSelect: () => {} });
    document.body.append(cb);
    cb.input.value = 'a';
    cb.input.dispatchEvent(new Event('input'));
    expect(esc(cb.input).defaultPrevented).toBe(true);
    cb.remove();
  });

  it('closing a menu does not also close the dialog', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const anchor = document.createElement('button');
    document.body.append(anchor);
    openMenu(anchor, [{ label: 'Edit', run: () => {} }]);
    expect(esc(document.activeElement).defaultPrevented).toBe(true);
    expect(document.querySelector('.popover')).toBeNull();
    anchor.remove();
  });
});

describe('menus', () => {
  it('choosing a menu item returns focus to the menu button', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const anchor = document.createElement('button');
    document.body.append(anchor);
    let ran = 0;
    openMenu(anchor, [{ label: 'Edit', run: () => ran++ }]);
    document.activeElement.click();
    expect(ran).toBe(1);
    expect(document.activeElement).toBe(anchor);
    openMenu(anchor, [{ label: 'Edit', run: () => ran++ }]);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });
});

describe('toasts', () => {
  it('a toast shown while a dialog is open appears in the dialog, and outlives it', async () => {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
      };
    }
    const { openDialog } = await import('../src/ui/dialog.js');
    const { toast } = await import('../src/ui/toast.js');
    const { dialog, close } = openDialog({ title: 'Edit', body: document.createElement('p') });
    toast('A change could not be saved.', { type: 'error' });
    // Outside the modal dialog the toast would be inert, under the backdrop.
    expect(dialog.contains(document.querySelector('.toast'))).toBe(true);
    close();
    expect(document.body.contains(document.querySelector('.toast'))).toBe(true);
    expect(document.querySelector('.toast-region').parentNode).toBe(document.body);
  });
});
