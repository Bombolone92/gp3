// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openVersionHistory } from '../src/ui/versions.js';
import { closeAllModals } from '../src/ui/modal.js';
import { listVersions, deleteVersion } from '../src/lib/versions.js';

vi.mock('../src/lib/versions.js', () => ({ listVersions: vi.fn(), deleteVersion: vi.fn(), AUTO_VERSION_MS: 600000 }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// Saving or deleting disables every control while it runs, which blurs the one pressed, and the rows are
// rebuilt after: the focus fell to the page, and a keyboard user had to find the dialog again from the top.
const entry = (name, day) => ({ path: `versions/${name}.xlsx`, name: `${name}.xlsx`, label: name, at: Date.UTC(2026, 8, day), size: 10 });
const tick = () => vi.advanceTimersByTimeAsync(1);
async function confirm(label) {
  const panel = [...document.querySelectorAll('.modal-root:not(.closing) .modal-panel')].at(-1);
  [...panel.querySelectorAll('button')].find((node) => node.textContent === label).click();
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.clearAllMocks();
  deleteVersion.mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('puts the focus on the row that took a deleted version’s place, else on the label field', async () => {
  listVersions.mockResolvedValueOnce([entry('A', 3), entry('B', 2)]).mockResolvedValueOnce([entry('B', 2)]).mockResolvedValueOnce([]);
  const { panel } = openVersionHistory({ path: 'Plan.xlsx' });
  await tick();
  const trash = () => [...panel.querySelectorAll('.version-list [title="Delete"]')];
  trash()[0].focus();
  trash()[0].click();
  await confirm('Delete');
  await tick();
  expect(trash()).toHaveLength(1);
  expect(document.activeElement).toBe(trash()[0]);
  trash()[0].click();
  await confirm('Delete');
  await tick();
  expect(trash()).toHaveLength(0);
  expect(document.activeElement).toBe(panel.querySelector('[aria-label="Version label"]'));
});

it('keeps the focus in the label field after Enter saves a version', async () => {
  listVersions.mockResolvedValue([entry('A', 3)]);
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn().mockResolvedValue({}) };
  const { panel } = openVersionHistory(doc);
  await tick();
  const label = panel.querySelector('[aria-label="Version label"]');
  label.focus();
  label.value = 'Before Q3';
  panel.querySelector('form.version-save').requestSubmit();
  await tick();
  await tick();
  expect(doc.saveVersion).toHaveBeenCalledWith('Before Q3');
  expect(label.disabled).toBe(false);
  expect(document.activeElement).toBe(label);
});

// A failure to read the versions left a line of grey text and no way to read them again but closing the
// dialog, and neither the wait nor the failure was said to a screen reader.
it('offers Try again when the versions cannot be read, says so aloud, and moves on to what the retry brings', async () => {
  listVersions.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([entry('A', 3)]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { panel } = openVersionHistory({ path: 'Plan.xlsx' });
  const status = panel.querySelector('[role="status"]');
  expect(status.textContent).toBe('Loading…');
  await tick();
  expect(status.textContent).toBe('Could not read the versions');
  const retry = () => [...panel.querySelectorAll('.version-list button')].find((b) => b.textContent === 'Try again');
  retry().focus();
  retry().click();
  await tick();
  expect(document.activeElement).toBe(retry());
  retry().click();
  await tick();
  expect(status.textContent).toBe('1 version');
  expect(retry()).toBeUndefined();
  expect(document.activeElement.textContent).toBe('Restore');
});
