import { describe, it, expect, afterEach } from 'vitest';
import { openModal, confirmDialog } from '../src/ui/modal.js';
import { el } from '../src/ui/dom.js';

/** The dialog every sheet and the compose window are built on. */

const tab = (shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
};

afterEach(() => {
  for (const node of document.querySelectorAll('.modal-root, #app')) node.remove();
});

describe('openModal', () => {
  it('suspends without closing, frees the app, and restores focus', () => {
    const opener = el('button', {}, 'Inbox');
    const app = el('div', { id: 'app' }, opener);
    document.body.append(app);
    opener.focus();
    const input = el('input');
    let closed = false;
    const modal = openModal({ title: 'Draft', content: input, onClose: () => { closed = true; } });
    input.focus();
    modal.suspend();
    expect(modal.panel.closest('.modal-root').hidden).toBe(true);
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(false);
    modal.resume();
    expect(app.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(input);
    modal.close(true);
  });

  it('closing a second dialog does not reactivate a minimized one', () => {
    const app = el('div', { id: 'app' });
    document.body.append(app);
    const first = openModal({ title: 'Draft', content: el('input') });
    first.suspend();
    const second = openModal({ title: 'Settings', content: el('input') });
    expect(app.hasAttribute('inert')).toBe(true);
    second.close();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(first.panel.closest('.modal-root').hidden).toBe(true);
    first.close(true);
  });

  it('wraps Tab from the last reachable control to the first, and back', () => {
    const one = el('button', { type: 'button' }, 'One');
    const two = el('button', { type: 'button' }, 'Two');
    const modal = openModal({ title: 'Test', content: el('div', {}, one, two) });
    const closeBtn = modal.panel.querySelector('.modal-head .icon-btn');

    two.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(two);
    modal.close(true);
  });

  it('skips controls the keyboard cannot reach when deciding where the edges are', () => {
    const one = el('button', { type: 'button' }, 'One');
    const hidden = el('input', { type: 'file', hidden: true, tabindex: -1 });
    const more = el('button', { type: 'button', hidden: true }, '+3 more');
    const off = el('button', { type: 'button', disabled: true }, 'Discard');
    const modal = openModal({ title: 'Test', content: el('div', {}, one, hidden, more, off) });
    const closeBtn = modal.panel.querySelector('.modal-head .icon-btn');

    // `one` is the last thing Tab can land on, so Tab from it wraps.
    one.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
    modal.close(true);
  });

  it('leaves a Tab in the middle of the panel to the browser', () => {
    const one = el('button', { type: 'button' }, 'One');
    const two = el('button', { type: 'button' }, 'Two');
    const modal = openModal({ title: 'Test', content: el('div', {}, one, two) });
    one.focus();
    expect(tab().defaultPrevented).toBe(false);
    modal.close(true);
  });

  it('inerts the app behind it and gives focus back to the opener on close', () => {
    const app = el('div', { id: 'app' }, el('button', { type: 'button' }, 'Opener'));
    document.body.append(app);
    const opener = app.querySelector('button');
    opener.focus();
    const modal = openModal({ title: 'Test', content: el('div', {}, el('button', { type: 'button' }, 'In')) });
    expect(app.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).not.toBe(opener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal-root')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    modal.close(true);
  });

  it('lets beforeClose veto Escape, the scrim and the close button, but not close(true)', () => {
    let veto = true;
    const modal = openModal({ title: 'Test', content: el('div'), beforeClose: () => !veto });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    modal.panel.querySelector('.modal-head .icon-btn').click();
    document.querySelector('.modal-scrim').click();
    expect(document.querySelector('.modal-root')).not.toBeNull();
    modal.close(true);
    expect(document.querySelector('.modal-root')).toBeNull();
    veto = false;
  });
});

describe('confirmDialog', () => {
  it('answers yes only to the confirming button', async () => {
    const asked = confirmDialog({ title: 'Delete?', message: 'Sure?', confirmLabel: 'Delete', danger: true });
    const buttons = [...document.querySelectorAll('.confirm-actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);
    // Focus starts on the way out rather than on the destructive button.
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1].click();
    expect(await asked).toBe(true);

    const declined = confirmDialog({ title: 'Delete?', message: 'Sure?' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await declined).toBe(false);
  });
});
