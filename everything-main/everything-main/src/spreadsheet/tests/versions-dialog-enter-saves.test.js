// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openVersionHistory } from '../src/ui/versions.js';
import { closeAllModals } from '../src/ui/modal.js';
import { listVersions } from '../src/lib/versions.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/lib/versions.js', () => ({ listVersions: vi.fn(), deleteVersion: vi.fn(), AUTO_VERSION_MS: 600000 }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

const tick = () => vi.advanceTimersByTimeAsync(1);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.clearAllMocks();
  listVersions.mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The label field and its button sat in a plain div, so Enter in the field did nothing, unlike
// every other dialog's text field; the row is a form, which Enter submits.
it('saves a version with the typed label when Enter submits the label field', async () => {
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn().mockResolvedValue({}) };
  const { panel } = openVersionHistory(doc);
  await tick();
  const label = panel.querySelector('[aria-label="Version label"]');
  const save = [...panel.querySelectorAll('button')].find((node) => node.textContent === 'Save a version now');
  expect(label.form).not.toBeNull();
  expect(save.form).toBe(label.form);
  expect(save.type).toBe('submit');
  label.value = 'Before Q3 changes';
  label.form.requestSubmit();
  await tick();
  expect(doc.saveVersion).toHaveBeenCalledWith('Before Q3 changes');
  expect(toast).toHaveBeenCalledWith('Version saved', expect.any(Object));
  expect(label.value).toBe('');
  expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(1);
});

it('saves once while a save is still pending, and still saves from the button', async () => {
  let finish;
  const doc = { path: 'Plan.xlsx', saveVersion: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
  const { panel } = openVersionHistory(doc);
  await tick();
  const label = panel.querySelector('[aria-label="Version label"]');
  const save = [...panel.querySelectorAll('button')].find((node) => node.textContent === 'Save a version now');
  label.form.requestSubmit();
  await tick();
  expect(save.disabled).toBe(true);
  label.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  expect(doc.saveVersion).toHaveBeenCalledTimes(1);
  finish({});
  await tick();
  expect(save.disabled).toBe(false);
  save.click();
  await tick();
  expect(doc.saveVersion).toHaveBeenCalledTimes(2);
});
