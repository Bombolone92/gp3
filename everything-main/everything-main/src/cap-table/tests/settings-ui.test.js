import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let settingsView;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/settings', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame', 'matchMedia']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  // After the globals: theme.js subscribes to matchMedia as it loads.
  ({ settingsView } = await import('../src/views/settings.js'));
  puterBackend().install();
  await store.init();
  await store.updateCompany({ name: 'Acme' });
  await store.addStakeholder({ name: 'Ada', kind: 'founder' });
});
afterEach(async () => {
  for (const sheet of [...document.querySelectorAll('.modal-root:not(.closing)')].reverse()) {
    sheet.querySelector('button[aria-label="Close"]')?.click();
  }
  await vi.waitFor(() => expect(document.querySelectorAll('.modal-root')).toHaveLength(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom.window.close();
});

const dialog = () => [...document.querySelectorAll('.modal-root:not(.closing)')].at(-1);
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

/** Press Import in Settings and hand the picker it opens a file holding `data`. */
async function pickBackup(data) {
  document.getElementById('app').replaceChildren(settingsView());
  let picker = null;
  vi.spyOn(dom.window.HTMLInputElement.prototype, 'click').mockImplementation(function () { picker = this; });
  button(document, 'Import').click();
  expect(picker?.type).toBe('file');
  const text = JSON.stringify(data);
  Object.defineProperty(picker, 'files', { value: [{ size: text.length, text: async () => text }] });
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(dialog()?.querySelector('.modal-title')?.textContent).toBe('Import backup'));
  return dialog();
}

describe('restoring a point', () => {
  const openRestorePoints = () => {
    document.getElementById('app').replaceChildren(settingsView());
    button(document, 'Restore points').click();
    return dialog();
  };
  const confirmMessage = async (sheet) => {
    [...sheet.querySelectorAll('button')].find((b) => /^Restore the point from/.test(b.getAttribute('aria-label') || '')).click();
    await vi.waitFor(() => expect(dialog()?.querySelector('.modal-title')?.textContent).toMatch(/^Restore /));
    return dialog().querySelector('.confirm-message').textContent;
  };

  it('promises a restore point of the current state only when one will be taken', async () => {
    await store.wipeAll();
    expect(store.hasData).toBe(false);
    // Asked from an empty company, the usual moment: right after a wipe.
    expect(await confirmMessage(openRestorePoints())).not.toContain('taken first');
    dialog().querySelector('button[aria-label="Close"]').click();
    await vi.waitFor(() => expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(1));
    await store.addStakeholder({ name: 'Bo', kind: 'employee' });
    expect(await confirmMessage(openRestorePoints())).toContain('A restore point of the current state is taken first, so this is itself reversible.');
  });
});

describe('importing a backup into a new company', () => {
  it('judges the file before a company is created for it', async () => {
    const bad = { app: 'captable', company: { name: 'Beta' }, classes: [], stakeholders: [],
      securities: [{ id: 'x', kind: 'option', stakeholderId: 'nobody', quantity: 10, strike: 1, date: '2024-01-01', label: 'OPT-9' }] };
    const sheet = await pickBackup(bad);
    button(sheet, 'A new company').click();
    button(sheet, 'Import').click();
    await vi.waitFor(() => expect([...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '))
      .toMatch(/OPT-9 names a stakeholder or share class the file does not include/));
    // Nothing was made for the file: one company, still the one on screen, still holding its data.
    expect(store.companies.map((c) => c.label)).toEqual(['Acme']);
    expect(store.company.name).toBe('Acme');
    expect(store.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    // The dialog still offers both destinations, so a corrected file can go either way.
    expect(button(sheet, 'A new company').closest('.field').hidden).toBe(false);
    const note = [...sheet.querySelectorAll('.field-hint')].find((p) => p.textContent.includes('The new company is ready but still empty'));
    expect(note.hidden).toBe(true);
  });

  it('creates the new company once the file is sound', async () => {
    const good = { app: 'captable', company: { name: 'Beta' }, classes: [], stakeholders: [{ id: 'h', name: 'Bo', kind: 'founder' }], securities: [] };
    const sheet = await pickBackup(good);
    button(sheet, 'A new company').click();
    button(sheet, 'Import').click();
    await vi.waitFor(() => expect(store.companies.map((c) => c.label)).toEqual(['Acme', 'Beta']));
    await vi.waitFor(() => expect(store.stakeholders.map((h) => h.name)).toEqual(['Bo']));
    expect(store.activeCompany.label).toBe('Beta');
  });
});
