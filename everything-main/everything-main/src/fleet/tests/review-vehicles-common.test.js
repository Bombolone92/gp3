// @vitest-environment jsdom
/** Building blocks shared by the screens (views/common.js). */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, fakeFile, chooseFile } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { simpleTable, attachmentsPanel } from '../src/views/common.js';
import { importVehicles } from '../src/views/importers.js';

beforeAll(polyfill);
beforeEach(async () => {
  await freshStore();
});

describe('no stray "null" text', () => {
  it('in a short table', () => {
    const t = simpleTable({ rows: [{ id: 1, name: 'A' }], columns: [{ id: 'name', label: 'Name', render: (r) => r.name }] });
    expect(t.textContent).not.toMatch(/null/);
  });

  it('in a files panel with documents but no photos', async () => {
    const v = app.store.put('vehicles', { name: 'Van', attachments: [{ id: 'a', name: 'title.pdf', type: 'application/pdf', size: 5, path: 'files/a' }] });
    const panel = attachmentsPanel('vehicles', v.id);
    expect(panel.textContent).not.toMatch(/null/);
  });

  it('in an import preview with nothing skipped', async () => {
    importVehicles();
    const dlg = await chooseFile(fakeFile('Name\nVan 1\n'));
    expect(dlg.querySelector('.import-preview').textContent).not.toMatch(/null/);
  });
});

describe('detail page tabs', () => {
  it('move to the first and last tab with Home and End', async () => {
    const { viewTabs } = await import('../src/views/common.js');
    let selected = 'b';
    const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    const bar = viewTabs(items, selected, (id) => (selected = id), 'Sections');
    document.body.append(bar);
    bar.querySelector('#tab-b').focus();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(selected).toBe('c');
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(selected).toBe('a');
    bar.remove();
  });
});
