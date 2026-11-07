import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { sampleDataset } from '../src/lib/sample.js';
import { puterBackend } from './helpers/puter-kv.js';

/* The screen main.js shows when store.init() fails on a record, driven over
   the real Store and an in-memory backend: the store and the view are
   re-imported for every test so the singleton the view reads starts as a
   fresh page would, with nothing loaded. */
let dom, backend, Store, store, recoveryView;
beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame', 'matchMedia']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  backend = puterBackend();
  backend.install();
  ({ Store, store } = await import('../src/lib/store.js'));
  ({ recoveryView } = await import('../src/views/recovery.js'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom.window.close();
});

const key = (companyId, field) => `captable:${companyId}:${field}:v1`;
/** Damage the current revision's payload, so the next read of the key fails as corruption. */
function corrupt(k) {
  const head = JSON.parse(backend.values.get(k));
  backend.values.set(`${k}:revision:${head.__captableRevision}:value`, '{"broken": ');
}
/** The sample company with one restore point behind it, then a damaged securities record. */
async function damaged() {
  const seed = new Store();
  await seed.init();
  await seed.importAll(sampleDataset(), { label: 'sample', settings: { sampleData: true, onboarded: true } });
  const backup = await seed.exportBackup();
  await seed.importAll(backup, { label: 'Before importing a backup' });
  const id = seed.activeCompanyId;
  corrupt(key(id, 'securities'));
  await expect(store.init()).rejects.toThrow(/could not be read/);
  return { id, backup };
}
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const labels = (root) => [...root.querySelectorAll('button')].map((b) => b.textContent.trim());
const dialog = () => [...document.querySelectorAll('.modal-root:not(.closing)')].at(-1);
function render() {
  const onRecovered = vi.fn(), onRetry = vi.fn();
  const view = recoveryView({ title: 'Couldn’t read your saved data', message: 'One record is unreadable.', onRetry, onRecovered });
  document.getElementById('app').replaceChildren(view);
  return { view, onRecovered, onRetry };
}

describe('recovery from a record that cannot be read at boot', () => {
  it('leaves nothing loaded when the load fails, so a recovery snapshots nothing', async () => {
    await damaged();
    expect(store.hasData).toBe(false);
    expect(store.company.name).toBe('');
    expect(store.securities).toEqual([]);
    expect(store.restorePoints).toEqual([]);
  });

  it('restores a snapshot of the damaged company and hands back to the load', async () => {
    const { id, backup } = await damaged();
    const { view, onRecovered } = render();
    expect(view.textContent).toContain('Try again, or use one of the ways back below.');
    expect(view.textContent).toContain('Ways back');
    await vi.waitFor(() => expect(button(view, 'Restore')).toBeTruthy());
    expect(view.textContent).toContain('Before importing a backup');
    expect(view.textContent).toContain(`${backup.stakeholders.length} holders · ${backup.securities.length} securities`);
    button(view, 'Restore').click();
    await vi.waitFor(() => expect(dialog()?.querySelector('.modal-title')?.textContent).toBe('Restore before importing a backup?'));
    expect(dialog().textContent).toContain('Everything in Acme Robotics, Inc. goes back to that snapshot');
    button(dialog(), 'Restore').click();
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.activeCompanyId).toBe(id);
    expect(fresh.securities).toHaveLength(backup.securities.length);
    expect(fresh.stakeholders).toHaveLength(backup.stakeholders.length);
    // No snapshot of the unloaded, empty state was taken on the way.
    expect(fresh.restorePoints.map((p) => p.label)).toEqual(['Before importing a backup']);
    expect((await fresh.exportAudit()).events[0].operation).toBe('restoreFromPoint');
  });

  it('replaces the damaged company with a backup file after saying what the file holds', async () => {
    const { id, backup } = await damaged();
    const { view, onRecovered } = render();
    let picker = null;
    vi.spyOn(dom.window.HTMLInputElement.prototype, 'click').mockImplementation(function () { picker = this; });
    button(view, 'Choose file').click();
    expect(picker?.type).toBe('file');
    const text = JSON.stringify(backup);
    Object.defineProperty(picker, 'files', { value: [{ size: text.length, text: async () => text }] });
    picker.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(() => expect(dialog()?.querySelector('.modal-title')?.textContent).toBe('Restore from this backup?'));
    expect(dialog().textContent).toContain(`The file holds Acme Robotics, Inc.: ${backup.stakeholders.length} holders · ${backup.securities.length} securities, exported just now. Everything in Acme Robotics, Inc. is replaced with it.`);
    button(dialog(), 'Restore').click();
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.activeCompanyId).toBe(id);
    expect(fresh.securities).toHaveLength(backup.securities.length);
    expect(fresh.settings.sampleData).toBe(false);
    expect(fresh.settings.onboarded).toBe(true);
    // The file's history was this company's own: recorded once already, not copied into the import event.
    const event = (await fresh.exportAudit()).events[0];
    expect(event.operation).toBe('importBackup');
    expect(event.sourceArchive).toBeUndefined();
  });

  it('refuses a file that is not a backup without asking anything', async () => {
    await damaged();
    const { view, onRecovered } = render();
    let picker = null;
    vi.spyOn(dom.window.HTMLInputElement.prototype, 'click').mockImplementation(function () { picker = this; });
    button(view, 'Choose file').click();
    const text = JSON.stringify({ hello: 'world' });
    Object.defineProperty(picker, 'files', { value: [{ size: text.length, text: async () => text }] });
    picker.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(() => expect(document.body.textContent).toContain('That file isn’t a Cap Table export'));
    expect(dialog()).toBeUndefined();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it('opens another company of the account when this one cannot be read', async () => {
    const seed = new Store();
    await seed.init();
    await seed.importAll(sampleDataset(), { label: 'sample', settings: { sampleData: true, onboarded: true } });
    const damagedId = seed.activeCompanyId;
    const other = await seed.createCompany('Beta Labs');
    await seed.switchCompany(damagedId);
    corrupt(key(damagedId, 'securities'));
    await expect(store.init()).rejects.toThrow(/could not be read/);
    const { view, onRecovered } = render();
    expect(view.textContent).toContain('Beta Labs');
    expect(view.textContent).toContain('Acme Robotics, Inc. stays as it is until it can be read or restored.');
    button(view, 'Open').click();
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.activeCompanyId).toBe(other.id);
    expect(fresh.companies.map((c) => c.id).sort()).toEqual([damagedId, other.id].sort());
  });

  it('says when the snapshots cannot be read either', async () => {
    const { id } = await damaged();
    corrupt(key(id, 'restorePoints'));
    const { view } = render();
    await vi.waitFor(() => expect(view.textContent).toContain('The snapshots of this company could not be read either.'));
    expect(labels(view)).toEqual(['Try again', 'Choose file']);
  });

  it('offers only a retry when the list of companies itself is unreadable', async () => {
    const seed = new Store();
    await seed.init();
    await seed.addStakeholder({ name: 'Ada', kind: 'founder' });
    corrupt('captable:companies:v1');
    await expect(store.init()).rejects.toThrow(/could not be read/);
    const { view, onRetry } = render();
    expect(view.textContent).toContain('One record is unreadable. Try again.');
    expect(view.textContent).not.toContain('Ways back');
    expect(labels(view)).toEqual(['Try again']);
    button(view, 'Try again').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
