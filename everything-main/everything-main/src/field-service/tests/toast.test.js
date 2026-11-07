// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toast } from '../src/ui/toast.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('toasts', () => {
  it('stays while keyboard focus is on its Undo button, then goes after focus leaves', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    toast('Client deleted', { action: { label: 'Undo', run } });
    const undo = [...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Undo');
    undo.focus();
    vi.advanceTimersByTime(20000);
    expect(undo.isConnected).toBe(true);
    undo.blur();
    vi.advanceTimersByTime(20000);
    expect(undo.isConnected).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not restart its timer on mouse leave while focus is still inside', () => {
    vi.useFakeTimers();
    toast('Saved', { action: { label: 'Undo', run() {} } });
    const node = document.querySelector('.toast');
    node.querySelector('.toast-action').focus();
    node.dispatchEvent(new MouseEvent('mouseenter'));
    node.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(20000);
    expect(node.isConnected).toBe(true);
  });

  it('goes away on its own when left alone', () => {
    vi.useFakeTimers();
    toast('Saved');
    vi.advanceTimersByTime(4000);
    expect(document.querySelector('.toast')).toBeNull();
  });
});

describe('toast regions', () => {
  it('are on the page before the first toast, so screen readers announce it', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute('open');
    };
    const dlg = openDialog({ title: 'Visit', body: 'x' });
    const region = dlg.dialog.querySelector(':scope > .toast-region[aria-live]');
    expect(region).not.toBeNull();
    // The body stays the last child (it pads itself clear of the home indicator).
    expect(dlg.dialog.lastElementChild.className).toBe('dialog-body');
    expect(region.children).toHaveLength(0);
    toast('Saved');
    expect(region.textContent).toContain('Saved');
    dlg.close();
  });
});
