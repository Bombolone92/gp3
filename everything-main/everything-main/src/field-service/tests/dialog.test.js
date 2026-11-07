// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { confirmDialog, openDialog } from '../src/ui/dialog.js';
import { h } from '../src/ui/dom.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});

const answer = async (label) => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === label).click();

describe('confirm dialogs', () => {
  it('start on Cancel when confirming deletes something, so a held or repeated Enter cannot confirm it', async () => {
    const done = confirmDialog({ title: 'Delete client?', message: 'Gone for good.', confirmLabel: 'Delete', danger: true });
    expect(document.activeElement.textContent).toBe('Cancel');
    answer('Cancel');
    expect(await done).toBe(false);
  });

  it('start on the confirm button otherwise', async () => {
    const done = confirmDialog({ title: 'Send quote?', message: 'It goes to the client.', confirmLabel: 'Send' });
    expect(document.activeElement.textContent).toBe('Send');
    answer('Send');
    expect(await done).toBe(true);
  });
});

describe('closing a dialog', () => {
  const page = () => {
    const main = h('main', { tabindex: '-1' }, h('h1', 'Invoice #12'), h('button', { type: 'button' }, 'Edit'), h('button', { type: 'button' }, 'Collect payment'));
    document.body.replaceChildren(main);
    return main;
  };

  it('returns focus to the same button when the page was redrawn while it was open', () => {
    const main = page();
    main.querySelectorAll('button')[1].focus();
    const dlg = openDialog({ title: 'Record payment', body: h('input') });
    // Saving redraws the page: the button that opened the dialog is replaced.
    main.replaceChildren(h('h1', 'Invoice #12'), h('button', { type: 'button' }, 'Edit'), h('button', { type: 'button' }, 'Collect payment'));
    dlg.close();
    expect(document.activeElement).toBe(main.querySelectorAll('button')[1]);
  });

  it('falls back to the page when nothing like the button is left', () => {
    const main = page();
    main.querySelectorAll('button')[1].focus();
    const dlg = openDialog({ title: 'Record payment', body: h('input') });
    main.replaceChildren(h('h1', 'Invoice #12'), h('p', 'Paid'));
    dlg.close();
    expect(document.activeElement).toBe(main);
  });
});


describe('clicking outside a dialog', () => {
  const backdropClick = (dlg) => dlg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5000, clientY: 5000 }));

  it('closes one where nothing was typed', () => {
    const dlg = openDialog({ title: 'Keyboard shortcuts', body: h('p', 'List') });
    backdropClick(dlg.dialog);
    expect(dlg.dialog.isConnected).toBe(false);
  });

  it('keeps one open once something was typed into it, so the input is not lost', () => {
    const input = h('input');
    const dlg = openDialog({ title: 'Record payment', body: input });
    input.value = '120';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    backdropClick(dlg.dialog);
    expect(dlg.dialog.isConnected).toBe(true);
    dlg.close();
  });

  it('still closes the search palette after typing a search', () => {
    const input = h('input', { type: 'search' });
    const dlg = openDialog({ label: 'Search', body: input });
    input.value = 'acme';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    backdropClick(dlg.dialog);
    expect(dlg.dialog.isConnected).toBe(false);
  });
});
