// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../src/ui/toast.js';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';
import { openModal, closeAllModals } from '../src/ui/modal.js';
import { stylesheet, declared } from './helpers/css.js';

// Toasts could not be dismissed: Escape left them in place and one with an action held the space above the
// tabs for six seconds. Escape now takes the newest toast away when no menu, dialog or palette has the
// key and the sheet has not used it, and a toast with an action carries a close button.
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => {
  closeMenu();
  closeAllModals();
  vi.advanceTimersByTime(500);
  // The toast root is created once at import: clear the toasts, not the body.
  document.querySelectorAll('.toast, .modal-root, .palette-root, input').forEach((n) => n.remove());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const escape = (target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const leaving = (node) => node.classList.contains('leaving');
const show = (message, options) => { toast(message, options); return [...document.querySelectorAll('.toast')].at(-1); };

describe('Escape', () => {
  it('dismisses the newest toast first, then the one before it', () => {
    const first = show('Saved');
    const second = show('Renamed');
    escape();
    expect(leaving(second)).toBe(true);
    expect(leaving(first)).toBe(false);
    escape();
    expect(leaving(first)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('leaves the toast alone while a menu, a dialog or the palette has the key', () => {
    const node = show('Saved');
    openMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    escape(document.activeElement);
    expect(isMenuOpen()).toBe(false);
    expect(leaving(node)).toBe(false);
    openModal({ title: 'Dialog', content: document.createElement('div') });
    escape(document.activeElement);
    expect(document.querySelector('.modal-root:not(.closing)')).toBeNull();
    expect(leaving(node)).toBe(false);
    const palette = document.createElement('div');
    palette.className = 'palette-root';
    document.body.append(palette);
    escape();
    expect(leaving(node)).toBe(false);
    palette.remove();
    vi.advanceTimersByTime(500); // the closed dialog's root is gone by now
    escape();
    expect(leaving(node)).toBe(true);
  });

  it('leaves the toast alone when the key was already used, as when the sheet cancels an edit with it', () => {
    const node = show('Saved');
    const field = document.createElement('input');
    document.body.append(field);
    field.addEventListener('keydown', (e) => e.preventDefault());
    escape(field);
    expect(leaving(node)).toBe(false);
    field.remove();
    escape();
    expect(leaving(node)).toBe(true);
  });
});

describe('the close button', () => {
  it('sits on a toast with an action and dismisses it without running the action; a plain notice has none', () => {
    const plain = show('Saved');
    expect(plain.querySelector('.toast-close')).toBeNull();
    const onClick = vi.fn();
    const node = show('Deleted 3 rows', { action: { label: 'Undo', onClick } });
    const close = node.querySelector('.toast-close');
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
    expect(node.querySelector('.toast-action').nextElementSibling).toBe(close);
    close.click();
    expect(leaving(node)).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector('.toast-root').getAttribute('role')).toBe('status');
  });

  it('is drawn in the toast’s own colours, with the focus ring that reads on ink', () => {
    const css = stylesheet('components.css');
    expect(declared(css, '.toast-close').color).toBe('inherit');
    expect(declared(css, '.toast-close')['border-radius']).toBe('var(--r-full)');
    expect(declared(css, '.toast-close:focus-visible')['outline-color']).toBe('var(--page)');
  });
});

// Dismiss and Undo take their toast away with the button that had the focus, which fell to the page: the
// arrow keys no longer reached the sheet. And Escape took the newest toast even from inside an older one.
describe('the focus in a toast', () => {
  const sheet = () => { const input = document.createElement('input'); input.setAttribute('aria-label', 'Sheet'); document.body.prepend(input); return input; };

  it('goes back where it came from when Dismiss or Undo takes the toast away', () => {
    const grid = sheet();
    const onClick = vi.fn();
    const node = show('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } });
    grid.focus();
    node.querySelector('.toast-close').focus();
    node.querySelector('.toast-close').click();
    expect(document.activeElement).toBe(grid);
    const again = show('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } });
    grid.focus();
    again.querySelector('.toast-action').focus();
    again.querySelector('.toast-action').click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(grid);
  });

  it('leaves the focus alone when a toast goes while the focus is elsewhere', () => {
    const grid = sheet();
    const node = show('Deleted', { icon: 'trash', action: { label: 'Undo', onClick() {} } });
    grid.focus();
    node.querySelector('.toast-close').focus();
    const other = sheet();
    other.focus();
    node._dismiss();
    expect(document.activeElement).toBe(other);
  });

  it('takes the toast holding the focus on Escape, not the newest', () => {
    const grid = sheet();
    const older = show('Deleted', { icon: 'trash', action: { label: 'Undo', onClick() {} } });
    const newer = show('Saved');
    grid.focus();
    older.querySelector('.toast-close').focus();
    escape(older.querySelector('.toast-close'));
    expect(leaving(older)).toBe(true);
    expect(leaving(newer)).toBe(false);
    expect(document.activeElement).toBe(grid);
  });
});
