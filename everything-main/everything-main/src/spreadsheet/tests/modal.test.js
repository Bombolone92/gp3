// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';
import { openModal, closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"><button id="opener">Open</button></div>';
  document.querySelector('#opener').focus();
});
afterEach(() => {
  closeMenu();
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function dialog() {
  const content = document.createElement('div');
  content.innerHTML = '<input aria-label="Name"><button disabled>Disabled</button><div hidden><button>Hidden</button></div><button class="last">Save</button>';
  return openModal({ title: 'Test', content });
}

function tab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  return event;
}

describe('modal keyboard focus', () => {
  it('wraps Tab from the last available control to the first', () => {
    const { panel } = dialog();
    panel.querySelector('.last').focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('.icon-btn'));
  });

  it('wraps Shift+Tab to the last control, skipping hidden and disabled controls', () => {
    const { panel } = dialog();
    panel.querySelector('.last').hidden = true;
    panel.querySelector('.icon-btn').focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('input'));
  });

  it('enters the controls when focus is on the dialog panel', () => {
    const { panel } = dialog();
    panel.focus();
    tab(true);
    expect(document.activeElement).toBe(panel.querySelector('.last'));
  });

  it('keeps native Tab behavior between controls inside the dialog', () => {
    const { panel } = dialog();
    panel.querySelector('input').focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it('wraps only inside the top dialog and restores its opener on close', () => {
    const parent = dialog();
    const opener = parent.panel.querySelector('input');
    opener.focus();
    const child = dialog();
    child.panel.querySelector('.last').focus();
    tab();
    expect(document.activeElement).toBe(child.panel.querySelector('.icon-btn'));
    child.close();
    vi.advanceTimersByTime(200);
    expect(document.activeElement).toBe(opener);
    expect(parent.panel.closest('[inert]')).toBeNull();
    parent.close();
    vi.advanceTimersByTime(200);
    expect(document.activeElement.id).toBe('opener');
    expect(document.querySelector('#app').hasAttribute('inert')).toBe(false);
  });

  it('does not move focus out of a replacement dialog after a closing animation', () => {
    const first = dialog();
    first.close();
    const next = dialog();
    const input = next.panel.querySelector('input');
    input.focus();
    vi.advanceTimersByTime(200);
    expect(document.activeElement).toBe(input);
    next.close();
    vi.advanceTimersByTime(200);
    expect(document.activeElement.id).toBe('opener');
  });

  it('keeps a closing dialog inert while its animation finishes', () => {
    const modal = dialog();
    modal.close();
    expect(modal.panel.closest('.modal-root').hasAttribute('inert')).toBe(true);
  });
});


it('does not dismiss a dialog on composition Escape', () => {
  const { panel } = dialog();
  panel.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
});


it('dismisses a menu inside a dialog before dismissing its dialog', () => {
  const { panel } = dialog();
  const opener = panel.querySelector('.last');
  opener.focus();
  openMenu({ anchor: opener, items: [{ label: 'Choice' }] });
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(isMenuOpen()).toBe(false);
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(document.activeElement).toBe(opener);
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(true);
});

// The trap's list of controls left out <summary>, so a Tab from a section heading such as Sparkline
// settings' Axes was taken for a Tab from outside and sent back to the Close button: the fields after it,
// Cancel and Save, were out of reach of the keyboard. The same befell a scrolling area Chrome lets Tab reach.
describe('modal keyboard focus past section headings and scrollers', () => {
  function sections() {
    const content = document.createElement('div');
    content.innerHTML = '<input aria-label="Name"><details><summary>Axes</summary><input aria-label="Minimum"></details>'
      + '<div class="scroller" tabindex="-1"><p>Long text</p></div><button class="last">Save</button>';
    return openModal({ title: 'Sections', content });
  }

  it('lets Tab move on from a section heading instead of sending it back to the start', () => {
    const { panel } = sections();
    const summary = panel.querySelector('summary');
    summary.focus();
    expect(document.activeElement).toBe(summary);
    expect(tab().defaultPrevented).toBe(false);
    expect(tab(true).defaultPrevented).toBe(false);
  });

  it('wraps from the last control over the fields of a closed section', () => {
    const { panel } = sections();
    panel.querySelector('.last').focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('.icon-btn'));
    panel.querySelector('.icon-btn').focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('.last'));
  });

  it('lets Tab move on from a focused scroller the list does not name, and wraps when nothing follows it', () => {
    const { panel } = sections();
    const scroller = panel.querySelector('.scroller');
    scroller.focus();
    expect(document.activeElement).toBe(scroller);
    expect(tab().defaultPrevented).toBe(false);
    panel.querySelector('.last').after(scroller);
    scroller.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('.icon-btn'));
  });
});

// A confirmation was named by its title alone: a screen reader said "Delete Sheet1?, dialog, Cancel button"
// and never read what the deletion would do.
describe('modal description', () => {
  it('describes a dialog by the message it opens with', async () => {
    const { confirmDialog } = await import('../src/ui/modal.js');
    confirmDialog({ title: 'Delete "Budget"?', message: 'It moves to the Trash in Puter.' });
    const panel = document.querySelector('.modal-panel');
    const id = panel.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id).textContent).toBe('It moves to the Trash in Puter.');
  });

  it('leaves a dialog without an opening message undescribed', () => {
    const { panel } = dialog();
    expect(panel.hasAttribute('aria-describedby')).toBe(false);
  });
});

it('closes a menu left open when a dialog opens by itself, and returns to the menu’s opener after', () => {
  const opener = document.querySelector('#opener');
  openMenu({ anchor: opener, items: [{ label: 'Choice' }] });
  expect(isMenuOpen()).toBe(true);
  const { panel, close } = dialog();
  expect(isMenuOpen()).toBe(false);
  expect(document.querySelector('.menu')?.isConnected ?? false).toBe(false);
  panel.querySelector('.last').focus();
  expect(tab().defaultPrevented).toBe(true);
  close();
  expect(document.activeElement).toBe(opener);
});
