// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openShareDialog } from '../src/ui/share.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

const tick = () => vi.advanceTimersByTimeAsync(1);
const field = (panel) => panel.querySelector('[aria-label="Username or email address"]');
const submit = (panel) => panel.querySelector('form.share-add').dispatchEvent(new Event('submit', { cancelable: true }));
const labels = (panel) => [...panel.querySelectorAll('.share-row .version-when')].map((n) => n.textContent);

let rows;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  rows = [{ who: 'user', label: 'bo', recipient: 'bo', mode: 'read', pending: false, inheritedFrom: null }];
  vi.spyOn(P, 'shareAccess').mockImplementation(async () => rows);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('lists who has access, and adds a person at the level chosen', async () => {
  vi.spyOn(P, 'shareFile').mockImplementation(async (path, who, mode) => {
    rows = [...rows, { who: 'user', label: who, recipient: who, mode, pending: false, inheritedFrom: null }];
    return { ...rows.at(-1), isNew: true };
  });
  const onChange = vi.fn();
  const { panel } = openShareDialog({ path: 'Spreadsheets/Plan.xlsx', name: 'Plan', onChange });
  await tick();
  expect(panel.classList.contains('share-panel')).toBe(true); // sized for an address beside the level and the button
  expect(labels(panel)).toEqual(['bo']);
  field(panel).value = 'ana';
  panel.querySelector('select.share-mode').value = 'write';
  submit(panel);
  await tick();
  expect(P.shareFile).toHaveBeenCalledWith('Spreadsheets/Plan.xlsx', 'ana', 'write');
  expect(onChange).toHaveBeenCalledOnce();
  expect(labels(panel)).toEqual(['bo', 'ana']);
  expect(field(panel).value).toBe('');
  expect(toast).toHaveBeenCalledWith('Shared with ana', expect.anything());
});

it('shows a refusal on the field and keeps what was typed', async () => {
  vi.spyOn(P, 'shareFile').mockRejectedValue(Object.assign(new Error('No Puter account has that username.'), { code: 'user_does_not_exist' }));
  const { panel } = openShareDialog({ path: 'a.xlsx', name: 'a' });
  await tick();
  field(panel).value = 'ghost';
  submit(panel);
  await tick();
  expect(panel.querySelector('.field-error').textContent).toMatch(/No Puter account/);
  expect(field(panel).getAttribute('aria-invalid')).toBe('true');
  expect(field(panel).value).toBe('ghost');
  expect(field(panel).disabled).toBe(false);
});

it('asks for a name before sharing', async () => {
  vi.spyOn(P, 'shareFile');
  const { panel } = openShareDialog({ path: 'a.xlsx', name: 'a' });
  await tick();
  submit(panel);
  await tick();
  expect(P.shareFile).not.toHaveBeenCalled();
  expect(panel.querySelector('.field-error').hidden).toBe(false);
});

it('changes and withdraws a person’s access, but offers no control over a link or a folder’s access', async () => {
  rows = [
    { who: 'user', label: 'bo', recipient: 'bo', mode: 'read', pending: false, inheritedFrom: null },
    { who: 'user', label: 'zoe', recipient: null, mode: 'read', pending: false, inheritedFrom: '/me/Work' },
    { who: 'anyone', label: 'Anyone with the link', recipient: null, mode: 'read', pending: false, inheritedFrom: null },
  ];
  vi.spyOn(P, 'shareFile').mockResolvedValue({});
  vi.spyOn(P, 'unshareFile').mockImplementation(async () => { rows = rows.slice(1); return 1; });
  const { panel } = openShareDialog({ path: 'a.xlsx', name: 'a' });
  await tick();
  const [bo, zoe, link] = panel.querySelectorAll('.share-row');
  expect(zoe.querySelector('select, button')).toBeNull();
  expect(link.querySelector('select, button')).toBeNull();
  const pick = bo.querySelector('select');
  pick.value = 'write';
  pick.dispatchEvent(new Event('change'));
  await tick();
  expect(P.shareFile).toHaveBeenCalledWith('a.xlsx', 'bo', 'write');
  expect(toast).toHaveBeenCalledWith('bo can now edit', expect.anything());
  panel.querySelector('[aria-label="Remove bo"]').click();
  await tick();
  expect(P.unshareFile).toHaveBeenCalledWith('a.xlsx', 'bo');
  expect(labels(panel)).toEqual(['zoe', 'Anyone with the link']);
});

it('copies a link that names the file by its id on the web', async () => {
  const writeText = vi.fn().mockResolvedValue();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.spyOn(P, 'puterShareLink').mockResolvedValue(null);
  const { panel } = openShareDialog({ path: 'a.xlsx', name: 'a', uid: 'u-1' });
  await tick();
  [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Copy link').click();
  await tick();
  expect(writeText).toHaveBeenCalledWith(`${location.origin}${location.pathname}#/file/u-1`);
  expect(toast).toHaveBeenCalledWith('Link copied. Only people with access can open it', expect.anything());
});

it('says when the file is not the user’s to share', async () => {
  P.shareAccess.mockRejectedValue(Object.assign(new Error('Only files you own, or may manage, can be shared.'), { code: 'forbidden' }));
  const { panel } = openShareDialog({ path: '/ana/u/a.xlsx', name: 'a' });
  await tick();
  expect(panel.querySelector('.version-empty').textContent).toMatch(/Only files you own/);
  expect(panel.querySelector('.version-empty button')).toBeNull();
  // The form that could only be refused is gone, and the focus it had with it.
  expect(panel.querySelector('form.share-add').hidden).toBe(true);
  expect(panel.querySelector('.field-hint').hidden).toBe(true);
  expect(document.activeElement.textContent).toBe('Done');
});

it('keeps the rows in place while it reads them again after a change', async () => {
  vi.spyOn(P, 'shareFile').mockResolvedValue({});
  const { panel } = openShareDialog({ path: 'a.xlsx', name: 'a' });
  await tick();
  let release;
  P.shareAccess.mockImplementation(() => new Promise((resolve) => { release = () => resolve(rows); }));
  const pick = panel.querySelector('.share-row select');
  pick.value = 'write';
  pick.dispatchEvent(new Event('change'));
  await tick();
  // Mid re-read: the list still shows who has access, not a notice in their place.
  expect(labels(panel)).toEqual(['bo']);
  expect(panel.querySelector('.version-empty')).toBeNull();
  release();
  await tick();
  expect(labels(panel)).toEqual(['bo']);
  expect(panel.querySelector('.share-row select').disabled).toBe(false);
});
