// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openVersionHistory } from '../src/ui/versions.js';
import { closeAllModals } from '../src/ui/modal.js';
import { listVersions, deleteVersion } from '../src/lib/versions.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/lib/versions.js', () => ({ listVersions: vi.fn(), deleteVersion: vi.fn(), AUTO_VERSION_MS: 600000 }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

const entries = [{ path: 'versions/old.xlsx', name: 'old.xlsx', label: 'Old', at: Date.UTC(2026, 8, 1), size: 10 }];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => vi.advanceTimersByTimeAsync(1);
const buttons = (panel) => [...panel.querySelectorAll('.version-list button, .version-save button')];
const button = (panel, action) => action === 'delete' ? panel.querySelector('.version-list [title="Delete"]')
  : buttons(panel).find((node) => node.textContent === (action === 'save' ? 'Save a version now' : 'Restore'));
async function confirm(label) {
  const panel = [...document.querySelectorAll('.modal-root:not(.closing) .modal-panel')].at(-1);
  [...panel.querySelectorAll('button')].find((node) => node.textContent === label).click();
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.clearAllMocks();
  listVersions.mockResolvedValue(entries);
  deleteVersion.mockResolvedValue(undefined);
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

it.each(['save', 'restore', 'delete'])('prevents competing version actions during %s', async (action) => {
  const pending = deferred();
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn().mockResolvedValue({}), restoreVersion: vi.fn().mockResolvedValue(true) };
  const operation = action === 'save' ? doc.saveVersion : action === 'restore' ? doc.restoreVersion : deleteVersion;
  operation.mockReturnValueOnce(pending.promise);
  const onRestored = vi.fn();
  const { panel } = openVersionHistory(doc, { onRestored });
  await tick();
  button(panel, action).click();
  if (action !== 'save') await confirm(action === 'restore' ? 'Restore' : 'Delete');
  await tick();
  expect(operation).toHaveBeenCalledOnce();
  expect(buttons(panel).every((node) => node.disabled)).toBe(true);
  expect(panel.querySelector('[aria-label="Version label"]').disabled).toBe(true);
  for (const node of buttons(panel)) node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
  expect(operation).toHaveBeenCalledOnce();
  expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(1);
  pending.resolve(true);
  await tick();
  if (action === 'restore') expect(onRestored).toHaveBeenCalledOnce();
  else expect(buttons(panel).every((node) => !node.disabled)).toBe(true);
});

it('unlocks the controls after cancelling or failing a restore', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn(), restoreVersion: vi.fn().mockRejectedValue(new Error('Your edits are intact; try restoring again.')) };
  const { panel } = openVersionHistory(doc);
  await tick();
  button(panel, 'restore').click();
  await confirm('Cancel');
  expect(doc.restoreVersion).not.toHaveBeenCalled();
  expect(buttons(panel).every((node) => !node.disabled)).toBe(true);
  button(panel, 'restore').click();
  await confirm('Restore');
  expect(doc.restoreVersion).toHaveBeenCalledOnce();
  expect(buttons(panel).every((node) => !node.disabled)).toBe(true);
  expect(toast).toHaveBeenCalledWith('Your edits are intact; try restoring again.', expect.any(Object));
});

// A screen reader read the loading, empty and error notices as the one item of a list of versions.
it('is a list only while it holds rows of versions', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn() };
  const role = (panel) => panel.querySelector('.version-list').getAttribute('role');
  const pending = deferred();
  listVersions.mockReturnValueOnce(pending.promise);
  const { panel } = openVersionHistory(doc);
  await tick();
  expect(panel.querySelector('.version-empty').textContent).toBe('Loading…');
  expect(role(panel)).toBeNull();
  pending.resolve([]);
  await tick();
  expect(panel.querySelector('.version-empty').textContent).toContain('No versions yet');
  expect(role(panel)).toBeNull();
  // The rows are a list again, and each row an item of it.
  listVersions.mockResolvedValue(entries);
  button(panel, 'save').click();
  await tick();
  expect(role(panel)).toBe('list');
  expect(panel.querySelectorAll('.version-row[role="listitem"]')).toHaveLength(1);
  // And an error notice is no list either.
  listVersions.mockRejectedValue(new Error('offline'));
  button(panel, 'save').click();
  await tick();
  expect(panel.querySelector('.version-empty p').textContent).toBe('Could not read the versions');
  expect(role(panel)).toBeNull();
});

it.each(['success', 'failure'])('ignores an older history request that finishes with %s after a refresh', async (result) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const old = deferred();
  const latest = [{ ...entries[0], path: 'versions/new.xlsx', label: 'New checkpoint' }, ...entries];
  listVersions.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest);
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn().mockResolvedValue({}) };
  const { panel } = openVersionHistory(doc);
  button(panel, 'save').click();
  await tick();
  expect(panel.querySelector('.version-list').textContent).toContain('New checkpoint');
  if (result === 'success') old.resolve(entries);
  else old.reject(new Error('Late request failed'));
  await tick();
  expect(panel.querySelector('.version-list').textContent).toContain('New checkpoint');
  expect(panel.querySelectorAll('.version-row')).toHaveLength(2);
});
