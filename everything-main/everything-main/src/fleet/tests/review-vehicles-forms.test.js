// @vitest-environment jsdom
/** Vehicle, contact, and vendor forms. */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { polyfill, freshStore, viewCtx, settle } from './review-vehicles-setup.js';
import { app } from '../src/app.js';

beforeAll(polyfill);

async function openForm(mod, id) {
  const { render } = await import(`../src/views/${mod}.js`);
  const ctx = viewCtx({ params: { id }, query: {} });
  const out = render(ctx);
  const node = out.node || out;
  document.querySelector('main').replaceChildren(node);
  return { node, out, save: () => node.querySelector('.form-foot .btn.primary').click() };
}

describe('saving an edit form keeps changes made elsewhere meanwhile', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  it('vehicle: keeps a newer meter, operator, and files', async () => {
    const id = 'v101';
    const f = await openForm('vehicle-form', id);
    // While the form is open: a fuel entry syncs in, an assignment starts, a file is added.
    app.store.patch('vehicles', id, { meter: 99999, meterDate: '2026-10-12', operatorId: 'c8', attachments: [{ id: 'a1', name: 'x.pdf', path: 'files/x.pdf', type: 'application/pdf', size: 1 }] });
    f.save();
    await settle();
    const v = app.store.get('vehicles', id);
    expect(v.meter).toBe(99999);
    expect(v.operatorId).toBe('c8');
    expect(v.attachments.map((a) => a.id)).toEqual(['a1']);
  });

  it('contact: keeps files added meanwhile', async () => {
    const f = await openForm('contact-form', 'c1');
    app.store.patch('contacts', 'c1', { attachments: [{ id: 'a1', name: 'x.pdf', path: 'files/x.pdf', type: 'application/pdf', size: 1 }] });
    f.save();
    await settle();
    expect(app.store.get('contacts', 'c1').attachments.map((a) => a.id)).toEqual(['a1']);
  });

  it('vendor: keeps files added meanwhile', async () => {
    const f = await openForm('vendor-form', 'vd1');
    app.store.patch('vendors', 'vd1', { attachments: [{ id: 'a1', name: 'x.pdf', path: 'files/x.pdf', type: 'application/pdf', size: 1 }] });
    f.save();
    await settle();
    expect(app.store.get('vendors', 'vd1').attachments.map((a) => a.id)).toEqual(['a1']);
  });
});

describe('saving an edit form after the record was deleted', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  for (const [mod, coll, id] of [
    ['vehicle-form', 'vehicles', 'v101'],
    ['contact-form', 'contacts', 'c1'],
    ['vendor-form', 'vendors', 'vd1'],
  ]) {
    it(`${coll}: does not bring the deleted record back`, async () => {
      const f = await openForm(mod, id);
      app.store.remove(coll, id);
      f.save();
      await settle();
      expect(app.store.get(coll, id)).toBeNull();
      expect(document.body.textContent).toMatch(/deleted/i);
    });
  }
});

describe('vehicle form', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  it('refuses a VIN that another vehicle already has', async () => {
    const other = app.store.get('vehicles', 'v101');
    app.store.patch('vehicles', 'v101', { vin: '1FTBW2CM5HKA12345' });
    const f = await openForm('vehicle-form');
    const field = (label) => document.getElementById([...f.node.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === label).getAttribute('for'));
    field('Vehicle name').value = 'New van';
    field('VIN or serial number').value = '1ftbw2cm5hka12345';
    const before = app.store.all('vehicles').length;
    f.save();
    await settle();
    expect(app.store.all('vehicles').length).toBe(before);
    expect(f.node.textContent).toMatch(new RegExp(`already used by ${other.name}`));
  });

  it('lets a vehicle keep its own VIN when edited', async () => {
    app.store.patch('vehicles', 'v101', { vin: '1FTBW2CM5HKA12345' });
    const f = await openForm('vehicle-form', 'v101');
    f.save();
    await settle();
    expect(f.node.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it('updates the photo buttons after adding or removing a photo', async () => {
    const f = await openForm('vehicle-form');
    const pick = f.node.querySelector('.photo-pick');
    const input = pick.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(10)], 'van.png', { type: 'image/png' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(30);
    expect(pick.textContent).toMatch(/Change photo/);
    const remove = [...pick.querySelectorAll('button')].find((b) => b.textContent === 'Remove');
    expect(remove).toBeTruthy();
    remove.click();
    expect(pick.textContent).toMatch(/Add photo/);
    expect([...pick.querySelectorAll('button')].some((b) => b.textContent === 'Remove')).toBe(false);
  });
});

describe('contact form', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  it('refuses a leave date before the start date', async () => {
    const f = await openForm('contact-form', 'c1');
    const field = (label) => document.getElementById([...f.node.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === label).getAttribute('for'));
    field('Start date').value = '2026-05-01';
    field('Leave date').value = '2026-04-01';
    f.save();
    await settle();
    expect(app.store.get('contacts', 'c1').leaveDate).not.toBe('2026-04-01');
    expect(f.node.textContent).toMatch(/on or after the start date/);
  });
});

describe('vehicle lifecycle dates', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
  });

  it('refuses an out-of-service date before the in-service date', async () => {
    const f = await openForm('vehicle-form', 'v101');
    const field = (label) => document.getElementById([...f.node.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === label).getAttribute('for'));
    field('In-service date').value = '2024-05-01';
    field('Out-of-service date').value = '2023-01-01';
    f.save();
    await settle();
    expect(app.store.get('vehicles', 'v101').outOfServiceDate).not.toBe('2023-01-01');
    expect(f.node.textContent).toMatch(/on or after the in-service date/);
  });
});

describe('drivers in a shared fleet', () => {
  beforeEach(async () => {
    await freshStore();
    app.team = { role: 'driver', url: null };
  });
  afterEach(() => {
    app.team = null;
  });

  for (const mod of ['vehicle-form', 'contact-form', 'vendor-form']) {
    it(`${mod}: says they cannot add one instead of showing a form the server will reject`, async () => {
      const f = await openForm(mod);
      expect(f.node.querySelector('form')).toBeNull();
      expect(f.node.textContent).toMatch(/permission/i);
    });
  }

  for (const mod of ['vehicles', 'contacts', 'vendors']) {
    it(`${mod}: the empty list does not offer an Add button`, async () => {
      const { render } = await import(`../src/views/${mod}.js`);
      const out = render(viewCtx());
      expect(out.node.querySelector('.empty a.btn, .empty button.btn')).toBeNull();
    });
  }
});
