// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let view;
const path = (name) => `Documents/Templates/${name}.docx`;
const deleteButton = (name) => document.querySelector(`[aria-label="Delete template ${name}"]`);
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  vi.spyOn(P, 'listFolder').mockResolvedValue(['A', 'B', 'C'].map((name) => ({ name: `${name}.docx`, path: path(name) })));
  vi.spyOn(P, 'deleteFile').mockResolvedValue();
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  [...view.el.querySelectorAll('button')].find((button) => button.textContent === 'Templates').click();
  await vi.advanceTimersByTimeAsync(0);
  [...document.querySelectorAll('[role="menuitem"]')].find((button) => button.textContent === 'Manage my templates').click();
});
afterEach(() => {
  view.destroy(); closeMenu(); closeAllModals();
  vi.runAllTimers(); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function confirmDelete(name) {
  deleteButton(name).click();
  document.querySelector('.modal-root:last-child .btn-danger').click();
  await vi.advanceTimersByTimeAsync(200);
}

it.each([['A', 'B'], ['B', 'A']])('keeps both templates removed when deletions finish in order %s, %s', async (first, second) => {
  const requests = { A: pending(), B: pending() };
  P.deleteFile.mockImplementation((target) => requests[target === path('A') ? 'A' : 'B'].promise);
  await confirmDelete('A');
  await confirmDelete('B');
  requests[first].resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(deleteButton(first)).toBeNull();
  requests[second].resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(deleteButton('A')).toBeNull();
  expect(deleteButton('B')).toBeNull();
  expect(deleteButton('C')).not.toBeNull();
});

it('keeps a failed deletion available for retry without restoring a deleted template', async () => {
  const requests = { A: pending(), B: pending() };
  P.deleteFile.mockImplementation((target) => requests[target === path('A') ? 'A' : 'B'].promise);
  await confirmDelete('A');
  await confirmDelete('B');
  requests.A.resolve(); requests.B.reject(new Error('Offline'));
  await vi.advanceTimersByTimeAsync(0);
  expect(deleteButton('A')).toBeNull();
  expect(deleteButton('B').disabled).toBe(false);
  P.deleteFile.mockResolvedValue();
  await confirmDelete('B');
  expect(deleteButton('A')).toBeNull();
  expect(deleteButton('B')).toBeNull();
});

it('prevents another deletion of a template while its confirmed request is pending', async () => {
  const request = pending();
  P.deleteFile.mockReturnValue(request.promise);
  await confirmDelete('A');
  expect(deleteButton('A').disabled).toBe(true);
  deleteButton('A').click();
  expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(1);
  expect(P.deleteFile).toHaveBeenCalledOnce();
  request.resolve();
  await vi.advanceTimersByTimeAsync(0);
});

it('keeps the original control focused and usable after cancelling confirmation', async () => {
  const button = deleteButton('A');
  button.focus(); button.click();
  document.querySelector('.modal-root:last-child .btn-ghost').click();
  await vi.advanceTimersByTimeAsync(200);
  expect(P.deleteFile).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
  expect(button.disabled).toBe(false);
  await confirmDelete('A');
  expect(deleteButton('A')).toBeNull();
});

it('shows the empty state after all template deletions finish', async () => {
  for (const name of ['A', 'B', 'C']) await confirmDelete(name);
  expect(document.querySelector('[role="list"][aria-label="My templates"]').textContent).toBe('No templates of your own yet.');
});

it('moves the keyboard to the next template, then to Close, as templates are deleted', async () => {
  deleteButton('A').focus();
  await confirmDelete('A');
  expect(document.activeElement).toBe(deleteButton('B'));
  await confirmDelete('B');
  expect(document.activeElement).toBe(deleteButton('C'));
  await confirmDelete('C');
  expect(document.activeElement.getAttribute('aria-label')).toBe('Close');
  expect(document.activeElement.closest('.modal-panel')).not.toBeNull();
});
