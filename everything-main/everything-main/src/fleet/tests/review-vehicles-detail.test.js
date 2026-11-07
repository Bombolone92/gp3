// @vitest-environment jsdom
/** Vehicle, contact, and vendor detail pages. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, viewCtx, settle } from './review-vehicles-setup.js';
import { app } from '../src/app.js';

beforeAll(polyfill);

async function openPage(mod, id, query = {}) {
  const { render } = await import(`../src/views/${mod}.js`);
  const ctx = viewCtx({ params: { id }, query });
  const out = render(ctx);
  const node = out.node || out;
  document.querySelector('main').replaceChildren(node);
  return { node, ctx };
}

describe('a record deleted while its page is open', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  for (const [mod, coll, id, back] of [
    ['vehicle-detail', 'vehicles', 'v101', '#/vehicles'],
    ['contact-detail', 'contacts', 'c1', '#/contacts'],
    ['vendor-detail', 'vendors', 'vd1', '#/vendors'],
  ]) {
    it(`${coll}: says it was deleted instead of showing stale or empty content`, async () => {
      const { node } = await openPage(mod, id);
      app.store.remove(coll, id);
      await settle(80);
      expect(node.querySelector('h1')?.textContent).toMatch(/deleted/i);
      expect(node.querySelector(`a[href="${back}"]`)).not.toBeNull();
      // Nothing else of the old record is left on the page.
      const left = [...node.querySelectorAll('[role="tablist"], [role="tabpanel"]:not(:empty), .card')].filter((el) => !el.closest('[hidden]'));
      expect(left).toEqual([]);
    });
  }
});

describe('deleting a contact that is still referenced', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  const deleteFromPage = async (mod, id) => {
    const { node } = await openPage(mod, id);
    node.querySelector('[aria-label="More actions"]').click();
    await settle();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Delete/.test(b.textContent)).click();
    await settle();
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    const message = dlg.textContent;
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
    await settle();
    return message;
  };

  it("unassigns the contact's vehicles and removes their assignments and renewals, with Undo", async () => {
    const id = app.store.all('vehicles').find((v) => v.operatorId)?.operatorId;
    const vehicles = app.store.all('vehicles').filter((v) => v.operatorId === id).map((v) => v.id);
    const nAssign = app.store.all('assignments').filter((a) => a.contactId === id).length;
    const nRen = app.store.all('renewals').filter((r) => r.kind === 'contact' && r.contactId === id).length;
    expect(vehicles.length && nAssign && nRen).toBeTruthy();
    // A handover reading recorded by one of the assignments.
    const asg = app.store.all('assignments').find((a) => a.contactId === id);
    app.store.put('meters', { vehicleId: asg.vehicleId, value: 1, date: '2020-01-01', source: { type: 'assignment', id: `${asg.id}-start` }, note: '', void: false });
    const fromAssignment = () => app.store.all('meters').filter((m) => m.source?.type === 'assignment');
    const message = await deleteFromPage('contact-detail', id);
    expect(message).toMatch(/assign/i);
    expect(message).toMatch(/Archive/);
    expect(app.store.get('contacts', id)).toBeNull();
    for (const vid of vehicles) expect(app.store.get('vehicles', vid).operatorId).toBeNull();
    expect(app.store.all('assignments').filter((a) => a.contactId === id)).toEqual([]);
    expect(app.store.all('renewals').filter((r) => r.contactId === id)).toEqual([]);
    expect(fromAssignment()).toEqual([]);

    [...document.querySelectorAll('.toast-action')].find((b) => b.textContent === 'Undo').click();
    await settle();
    expect(app.store.get('contacts', id)).not.toBeNull();
    for (const vid of vehicles) expect(app.store.get('vehicles', vid).operatorId).toBe(id);
    expect(app.store.all('assignments').filter((a) => a.contactId === id).length).toBe(nAssign);
    expect(app.store.all('renewals').filter((r) => r.contactId === id).length).toBe(nRen);
    expect(fromAssignment().length).toBe(1);
  });

  it('warns before deleting a vendor that fuel, service, or expenses still name', async () => {
    const message = await deleteFromPage('vendor-detail', 'vd1');
    expect(message).toMatch(/\d+ (fuel|service|record)/i);
    expect(message).toMatch(/Archive/);
  });
});

describe('deleting a vehicle', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  it('takes it out of service programs and removes its comments', async () => {
    const id = 'v101';
    const prog = app.store.all('servicePrograms').find((p) => p.vehicleIds.includes(id));
    expect(prog).toBeTruthy();
    app.store.put('comments', { parentType: 'vehicles', parentId: id, text: 'Hi', author: 'Me' });
    const { node } = await openPage('vehicle-detail', id);
    node.querySelector('[aria-label="More actions"]').click();
    await settle();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Delete vehicle/.test(b.textContent)).click();
    await settle();
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Delete permanently').click();
    await settle();
    expect(app.store.get('vehicles', id)).toBeNull();
    expect(app.store.get('servicePrograms', prog.id).vehicleIds).not.toContain(id);
    expect(app.store.all('comments').filter((c) => c.parentId === id)).toEqual([]);
  });
});

describe('vehicle tabs', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('shows a dash, not a bare unit, for a fuel entry with no volume', async () => {
    const v = app.store.put('vehicles', { name: 'Van 1', archived: false });
    // An imported row with only a total.
    app.store.put('fuel', { vehicleId: v.id, date: '2026-10-01', volume: null, total: 4000, kind: 'fuel' });
    const { node } = await openPage('vehicle-detail', v.id, { tab: 'fuel' });
    const cells = [...node.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells).not.toContain(' gal');
    expect(cells).toContain('-');
  });
});

describe('contact page assignments', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('does not call an assignment that has not started yet current', async () => {
    const v = app.store.put('vehicles', { name: 'Van 1', archived: false });
    const c = app.store.put('contacts', { firstName: 'Ana', archived: false });
    app.store.put('assignments', { vehicleId: v.id, contactId: c.id, start: '2026-11-01', end: null });
    const { node } = await openPage('contact-detail', c.id);
    const row = node.querySelector('tbody tr');
    expect(row.textContent).not.toMatch(/Current/);
  });
});
