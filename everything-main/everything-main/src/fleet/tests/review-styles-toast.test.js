// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { openDialog } from '../src/ui/dialog.js';
import { toast } from '../src/ui/toast.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  // Like browsers, fire "close" in a later task.
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
    setTimeout(() => this.dispatchEvent(new Event('close')));
  };
});

describe('toasts and modal dialogs', () => {
  it('shows a toast raised while a modal dialog is open inside that dialog', () => {
    // A modal dialog sits in the top layer and makes the rest of the page
    // inert, so a toast in <body> would be drawn under its backdrop.
    const { dialog, close } = openDialog({ title: 'Import vehicles', body: document.createElement('div') });
    toast('Choose a CSV file with data first.', { type: 'error' });
    const node = [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('CSV'));
    expect(node.closest('dialog')).toBe(dialog);

    close();
    toast('Imported 3 records');
    const after = [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Imported'));
    expect(after.isConnected).toBe(true);
    expect(after.closest('dialog')).toBe(null);
    expect(document.querySelectorAll('.toast-region').length).toBe(1);
  });

  it('keeps a toast raised just before its dialog closes, such as an Undo', async () => {
    // Deleting from a form dialog shows "Expense deleted, Undo" and then
    // closes the dialog; the Undo must outlive it.
    const { close } = openDialog({ title: 'Edit expense', body: document.createElement('div') });
    toast('Expense deleted', { action: { label: 'Undo', run() {} } });
    close();
    await new Promise((r) => setTimeout(r, 5));
    const node = [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Expense deleted'));
    expect(node?.isConnected).toBe(true);
    expect(node.closest('dialog')).toBe(null);
  });

  it('moves toasts to the dialog underneath when a stacked dialog closes', async () => {
    const outer = openDialog({ title: 'Edit renewal', body: document.createElement('div') });
    const inner = openDialog({ title: 'Delete renewal?', body: document.createElement('div') });
    toast('Working');
    expect(document.querySelector('.toast-region').closest('dialog')).toBe(inner.dialog);
    inner.close();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.querySelector('.toast-region').closest('dialog')).toBe(outer.dialog);
    outer.close();
    await new Promise((r) => setTimeout(r, 5));
  });

  it('keeps toasts in the page when no dialog is open', () => {
    toast('Saved');
    const region = document.querySelector('.toast-region');
    expect(region.parentNode).toBe(document.body);
  });
});
