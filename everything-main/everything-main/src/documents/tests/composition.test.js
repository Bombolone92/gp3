// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindbar } from '../src/ui/findbar.js';
import { openModal, closeAllModals } from '../src/ui/modal.js';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { createCommentsPanel } from '../src/ui/comments.js';
import { el } from '../src/ui/dom.js';
import { fakeUi } from './helpers/fake-ui.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.replaceChildren(el('div', { id: 'app' }));
});
afterEach(() => {
  closeMenu(); closeAllModals(); vi.runAllTimers();
  document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
});

const key = (node, name, composition) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...composition });
  node.dispatchEvent(event);
  return event;
};

it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME confirmation and cancellation to the find inputs (%j)', (composition) => {
  const ui = fakeUi(), bar = createFindbar();
  document.querySelector('#app').append(bar.el); bar.bind(ui); bar.open('한글');
  const query = bar.el.querySelector('input[type="search"]');
  const replacement = bar.el.querySelector('input[type="text"]');
  replacement.value = '수정';
  for (const input of [query, replacement]) {
    for (const name of ['Enter', 'Escape']) expect(key(input, name, composition).defaultPrevented).toBe(false);
  }
  expect(bar.isOpen).toBe(true);
  expect(ui.searchCalls.map(([kind]) => kind)).toEqual(['open', 'search']);
  expect(key(replacement, 'Enter', {}).defaultPrevented).toBe(true);
  expect(ui.searchCalls.at(-1)).toEqual(['replace', '수정']);
  bar.unbind();
});

it.each([{ isComposing: true }, { keyCode: 229 }])('does not dismiss a dialog or its menu while cancelling IME composition (%j)', (composition) => {
  const input = el('input', { value: 'Draft' });
  const anchor = el('button', {}, 'Options'), onClose = vi.fn();
  const modal = openModal({ title: 'Edit', content: el('div', {}, input, anchor), onClose });
  expect(key(input, 'Escape', composition).defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  const menuInput = el('input');
  const popup = openMenu({ anchor, items: [{ custom: menuInput }] });
  menuInput.focus();
  expect(key(menuInput, 'Escape', composition).defaultPrevented).toBe(false);
  expect(popup.menu.isConnected).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  key(menuInput, 'Escape', {});
  expect(popup.menu.isConnected).toBe(false);
  key(input, 'Escape', {});
  expect(onClose).toHaveBeenCalledOnce();
  modal.close();
});

it.each([{ isComposing: true }, { keyCode: 229 }])('keeps a comment draft when IME receives Enter or Escape (%j)', (composition) => {
  const onAction = vi.fn(), panel = createCommentsPanel({ onAction });
  document.querySelector('#app').append(panel.el); panel.open();
  panel.update({ items: [{ commentId: 'root', text: 'A comment' }] });
  [...panel.el.querySelectorAll('button')].find((button) => button.textContent === 'Reply').click();
  const input = panel.el.querySelector('textarea'); input.value = '작성 중';
  key(input, 'Enter', composition); key(input, 'Escape', composition);
  expect(onAction).not.toHaveBeenCalled();
  expect(panel.el.querySelector('textarea')).toBe(input);
  expect(input.value).toBe('작성 중');
});
