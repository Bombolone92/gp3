// @vitest-environment jsdom
/** The vehicle list: tabs, bulk changes, and CSV export. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, viewCtx, clickButton } from './review-vehicles-setup.js';
import { app } from '../src/app.js';

beforeAll(polyfill);

async function openList(query = {}) {
  const { render } = await import('../src/views/vehicles.js');
  const ctx = viewCtx({ query });
  const out = render(ctx);
  document.querySelector('main').replaceChildren(out.node);
  await settle();
  return { node: out.node, ctx };
}

function selectAll(node) {
  const cb = node.querySelector('thead input[type="checkbox"]');
  cb.checked = true;
  cb.dispatchEvent(new Event('change'));
}

describe('bulk status and group changes', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
    localStorage.clear();
  });

  it('opens the status menu at the button that was clicked', async () => {
    const { node } = await openList();
    selectAll(node);
    const btn = clickButton(node.querySelector('.bulk-bar'), 'Change status');
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('applies the chosen status to every selected vehicle', async () => {
    const { node } = await openList();
    selectAll(node);
    const ids = [...node.querySelectorAll('tbody tr')].length;
    clickButton(node.querySelector('.bulk-bar'), 'Change status');
    await settle();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'In shop').click();
    await settle(60);
    expect(app.store.all('vehicles').filter((v) => !v.archived && v.status === 'in_shop').length).toBeGreaterThanOrEqual(ids);
    expect(node.querySelector('.bulk-bar').hidden).toBe(true);
  });
});

describe('CSV export', () => {
  beforeEach(async () => {
    await freshStore();
    localStorage.clear();
  });

  async function exportCsv() {
    let saved = null;
    const orig = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => ((saved = blob), 'blob:x');
    URL.revokeObjectURL ??= () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      const { node } = await openList();
      node.querySelector('[aria-label="More actions"]').click();
      await settle();
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Export to CSV').click();
    } finally {
      URL.createObjectURL = orig;
      HTMLAnchorElement.prototype.click = click;
    }
    const text = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(saved);
    });
    const [head, ...rows] = text.trim().split('\r\n').map((l) => l.split(','));
    return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
  }

  it('writes ownership as shown in the list, not its internal id', async () => {
    app.store.put('vehicles', { name: 'Van 1', ownership: 'leased', archived: false });
    const [row] = await exportCsv();
    expect(row.Ownership).toBe('Leased');
  });
});

describe('operators as days pass', () => {
  beforeEach(async () => {
    await freshStore();
    localStorage.clear();
  });

  it('shows the operator of an assignment that started since it was saved, and drops one that ended', async () => {
    const { assignVehicle } = await import('../src/core/actions.js');
    const a = app.store.put('contacts', { firstName: 'Ana', lastName: 'A', archived: false });
    const b = app.store.put('contacts', { firstName: 'Ben', lastName: 'B', archived: false });
    const v1 = app.store.put('vehicles', { name: 'Van 1', archived: false, operatorId: null });
    const v2 = app.store.put('vehicles', { name: 'Van 2', archived: false, operatorId: null });
    // Saved on Oct 12: Ana takes Van 1 from tomorrow; Ben has Van 2 until today.
    assignVehicle(app.store, { vehicleId: v1.id, contactId: a.id, start: '2026-10-13', end: null }, '2026-10-12');
    assignVehicle(app.store, { vehicleId: v2.id, contactId: b.id, start: '2026-10-01', end: '2026-10-12' }, '2026-10-12');
    await settle();
    app.today = () => '2026-10-14';
    const assigned = await openList({ tab: 'assigned' });
    expect([...assigned.node.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([expect.stringMatching(/Van 1.*Ana A/)]);
    const unassigned = await openList({ tab: 'unassigned' });
    expect([...unassigned.node.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([expect.stringMatching(/Van 2/)]);
  });
});
