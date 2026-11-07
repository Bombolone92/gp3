// @vitest-environment jsdom
/**
 * Rentals: property, unit, tenant and owner screens render on the demo
 * portfolio, plus the pure helpers behind them.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const TODAY = '2026-10-12';
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('generateUnitNames', () => {
  it('counts up numbers and keeps their width', async () => {
    const { generateUnitNames } = await import('../src/views/properties/shared.js');
    expect(generateUnitNames('101', 3)).toEqual(['101', '102', '103']);
    expect(generateUnitNames('09', 3)).toEqual(['09', '10', '11']);
    expect(generateUnitNames('Suite 1', 2)).toEqual(['Suite 1', 'Suite 2']);
  });

  it('counts up letters and stops at Z', async () => {
    const { generateUnitNames } = await import('../src/views/properties/shared.js');
    expect(generateUnitNames('2A', 3)).toEqual(['2A', '2B', '2C']);
    expect(generateUnitNames('Y', 5)).toEqual(['Y', 'Z']);
  });

  it('handles odd input safely', async () => {
    const { generateUnitNames } = await import('../src/views/properties/shared.js');
    expect(generateUnitNames('', 2)).toEqual(['1', '2']);
    expect(generateUnitNames('Loft', 2)).toEqual(['Loft 1', 'Loft 2']);
    expect(generateUnitNames('1', -4)).toEqual([]);
    expect(generateUnitNames('1', 1000)).toHaveLength(200);
  });
});

describe('form helpers', () => {
  it('drops blank repeatable rows and trims values', async () => {
    const { cleanRows } = await import('../src/views/people/form-parts.js');
    expect(cleanRows([{ make: ' Honda ', plate: '' }, { make: '', plate: ' ' }])).toEqual([{ make: 'Honda', plate: '' }]);
  });

  it('only follows in-app next links', async () => {
    const { safeNext } = await import('../src/views/people/form-parts.js');
    expect(safeNext('/leases/abc')).toBe('/leases/abc');
    expect(safeNext('//evil.example')).toBe(null);
    expect(safeNext('https://evil.example')).toBe(null);
    expect(safeNext('')).toBe(null);
  });
});

describe('rental screens on the demo portfolio', () => {
  let app;
  let main;

  beforeAll(async () => {
    ({ app } = await import('../src/app.js'));
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { buildSampleData } = await import('../src/core/sample.js');
    const { buildShell } = await import('../src/ui/shell.js');
    const { startViews } = await import('../src/ui/viewhost.js');
    app.demo = true;
    app.today = () => TODAY;
    app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)) });
    await app.store.init();
    document.body.innerHTML = '<div id="app"></div>';
    const shell = buildShell({});
    document.getElementById('app').append(shell.root);
    startViews(shell.main);
    main = shell.main;
  });

  const go = async (hash) => {
    const before = main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = main.firstElementChild;
      if (now && now !== before && main.querySelector('h1')) break;
    }
    await settle();
  };

  const first = (coll, pred = () => true) => app.store.all(coll).find(pred);

  it('renders the properties list with every property and portfolio figures', async () => {
    await go('#/properties');
    expect(main.querySelector('h1').textContent).toBe('Properties');
    expect(main.textContent).toContain('Maple Court Apartments');
    expect(main.textContent).toContain('Occupancy');
    expect(main.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('renders the property form, new and edit', async () => {
    await go('#/properties/new');
    expect(main.querySelector('h1').textContent).toBe('New property');
    expect(main.querySelector('.rn-unit-row')).toBeTruthy();
    await go('#/properties/pr-maple/edit');
    expect(main.querySelector('h1').textContent).toMatch(/^Edit Maple Court/);
  });

  it('renders every tab of a property', async () => {
    for (const tab of ['', 'units', 'financials', 'leases', 'maintenance', 'notes', 'files']) {
      await go(`#/properties/pr-maple${tab ? `?tab=${tab}` : ''}`);
      expect(main.querySelector('h1').textContent).toContain('Maple Court Apartments');
      expect(main.querySelector('[role=tabpanel]')).toBeTruthy();
    }
    await go('#/properties/pr-maple?tab=units');
    expect(main.querySelectorAll('.tab-panel tbody tr').length).toBe(8);
    await go('#/properties/pr-maple?tab=financials');
    expect(main.textContent).toContain('Net operating income');
  });

  it('renders a unit page, occupied and vacant', async () => {
    const occupied = app.store.all('leases').find((l) => l.start <= TODAY && !l.moveOut && l.propertyId === 'pr-maple');
    await go(`#/units/${occupied.unitId}`);
    expect(main.querySelector('h1')).toBeTruthy();
    expect(main.textContent).toContain('Current lease');
    const vacant = first('units', (u) => u.listing?.listed);
    await go(`#/units/${vacant.id}`);
    expect(main.textContent).toContain('Listing');
  });

  it('renders tenants: list, form, detail', async () => {
    await go('#/tenants');
    expect(main.querySelector('h1').textContent).toBe('Tenants');
    expect(main.querySelectorAll('tbody tr').length).toBeGreaterThan(5);
    await go('#/tenants/new');
    expect(main.querySelector('h1').textContent).toBe('New tenant');
    const t = first('tenants');
    await go(`#/tenants/${t.id}`);
    expect(main.querySelector('h1').textContent).toContain(t.firstName);
    await go(`#/tenants/${t.id}/edit`);
    expect(main.querySelector('h1').textContent).toMatch(/^Edit/);
  });

  it('renders owners: list, form, detail', async () => {
    await go('#/owners');
    expect(main.querySelector('h1').textContent).toBe('Rental owners');
    expect(main.textContent).toContain('Northgate Holdings LLC');
    await go('#/owners/new');
    expect(main.querySelector('h1').textContent).toBe('New rental owner');
    await go('#/owners/ow-2');
    expect(main.querySelector('h1').textContent).toContain('Northgate Holdings LLC');
    expect(main.textContent).toContain('Year to date');
    await go('#/owners/ow-2/edit');
    expect(main.querySelector('h1').textContent).toMatch(/^Edit/);
  });

  it('shows a not found state for missing records', async () => {
    for (const hash of ['#/properties/nope', '#/units/nope', '#/tenants/nope', '#/owners/nope']) {
      await go(hash);
      expect(main.querySelector('h1').textContent).toMatch(/not found/);
    }
  });

  it('creates a property with units from the form', async () => {
    await go('#/properties/new');
    const form = main.querySelector('form');
    form.querySelector('[name=name]').value = 'Test Lofts';
    form.querySelector('[name=street]').value = '1 Test Way';
    const rows = form.querySelectorAll('.rn-unit-row');
    rows[0].querySelector('input').value = 'L1';
    rows[0].querySelector('input').dispatchEvent(new Event('input'));
    rows[1].querySelector('input').value = 'L2';
    rows[1].querySelector('input').dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const p = app.store.all('properties').find((x) => x.name === 'Test Lofts');
    expect(p).toBeTruthy();
    expect(app.store.all('units').filter((u) => u.propertyId === p.id).map((u) => u.name).sort()).toEqual(['L1', 'L2']);
  });

  it('refuses two units with the same name in the new property form', async () => {
    await go('#/properties/new');
    const form = main.querySelector('form');
    form.querySelector('[name=name]').value = 'Twin Lofts';
    form.querySelector('[name=street]').value = '2 Test Way';
    const rows = form.querySelectorAll('.rn-unit-row');
    for (const [i, n] of [[0, '101'], [1, '101 ']]) {
      rows[i].querySelector('input').value = n;
      rows[i].querySelector('input').dispatchEvent(new Event('input'));
    }
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(app.store.all('properties').some((x) => x.name === 'Twin Lofts')).toBe(false);
    // Fixed, it saves (and leaves no unsaved form behind).
    rows[1].querySelector('input').value = '102';
    rows[1].querySelector('input').dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const p = app.store.all('properties').find((x) => x.name === 'Twin Lofts');
    expect(app.store.all('units').filter((u) => u.propertyId === p.id).map((u) => u.name).sort()).toEqual(['101', '102']);
  });

  it('a single-family property with a second unit labels each unit', async () => {
    const { unitDialog } = await import('../src/views/properties/shared.js');
    const { unitLabel } = await import('../src/core/leases.js');
    const store = app.store;
    const house = store.put('properties', { name: 'Solo House', type: 'single-family', singleUnit: true, active: true });
    const home = store.put('units', { propertyId: house.id, name: 'Home' });
    const p = unitDialog(house.id);
    await settle();
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    dlg.querySelector('[name=name]').value = 'ADU';
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    const adu = await p;
    const h = store.get('properties', house.id);
    expect(unitLabel(h, home)).not.toBe(unitLabel(h, adu));
  });

  it("a property or unit that other records point at can't be deleted", async () => {
    const store = app.store;
    const prop = store.put('properties', { name: 'Spare Lot', type: 'multi-family', active: true });
    const unit = store.put('units', { propertyId: prop.id, name: 'S1' });
    store.put('workOrders', { number: 901, title: 'Mow', propertyId: prop.id, unitId: unit.id, status: 'new' });
    const deleteItem = async (hash) => {
      await go(hash);
      main.querySelector('button[aria-label="More actions"]').click();
      await settle();
      const item = [...document.querySelectorAll('[role=menuitem]')].find((x) => /Delete (property|unit)/.test(x.textContent));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return item;
    };
    let item = await deleteItem(`#/properties/${prop.id}`);
    expect(item.disabled || item.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(item.textContent).toMatch(/work orders/);
    item = await deleteItem(`#/units/${unit.id}`);
    expect(item.disabled || item.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(item.textContent).toMatch(/work orders/);
  });

  it("an owner with contributions or distributions in the books can't be deleted", async () => {
    const { buildOwnerTransaction } = await import('../src/core/ledger.js');
    const store = app.store;
    const owner = store.put('owners', { kind: 'person', firstName: 'Former', lastName: 'Partner' });
    store.put('transactions', buildOwnerTransaction({ kind: 'distribution', ownerId: owner.id, propertyId: store.all('properties')[0].id, date: TODAY, amount: 1000 }));
    await go(`#/owners/${owner.id}`);
    main.querySelector('button[aria-label="More actions"]').click();
    await settle();
    const item = [...document.querySelectorAll('[role=menuitem]')].find((x) => /Delete owner/.test(x.textContent));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(item.disabled || item.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(item.textContent).toMatch(/in the books/);
  });

  it("a property's deposits held leave out deposits charged but not paid", async () => {
    const { buildCharge } = await import('../src/core/ledger.js');
    const { ACC } = await import('../src/core/accounts.js');
    const store = app.store;
    const prop = store.put('properties', { name: 'Deposit Court', type: 'multi-family', active: true });
    const unit = store.put('units', { propertyId: prop.id, name: '1' });
    const lease = store.put('leases', { propertyId: prop.id, unitId: unit.id, type: 'at-will', start: TODAY, tenantIds: [], recurring: [] });
    store.put('transactions', buildCharge({ lease, date: TODAY, items: [{ accountId: ACC.depositsHeld, amount: 200000 }] }));
    await go(`#/properties/${prop.id}`);
    const row = [...main.querySelectorAll('dt, .kv-label, th')].find((x) => x.textContent.trim() === 'Deposits held');
    expect(row.nextElementSibling.textContent).toMatch(/\$0\.00/);
  });

  it('tables never put a link inside a link', async () => {
    for (const hash of [`#/properties/${first('properties', (p) => !p.singleUnit).id}?tab=units`, '#/properties', '#/tenants', '#/owners']) {
      await go(hash);
      expect(main.querySelectorAll('a a').length, hash).toBe(0);
    }
  });

  it('listing a unit again starts its listed date afresh', async () => {
    const { listingDialog } = await import('../src/views/properties/shared.js');
    const store = app.store;
    const prop = store.put('properties', { name: 'Relist Court', type: 'multi-family', active: true });
    const unit = store.put('units', { propertyId: prop.id, name: 'RL1', marketRent: 120000, listing: { listed: false, listedOn: '2025-03-01' } });
    const p = listingDialog(unit);
    await settle();
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await p;
    expect(store.get('units', unit.id).listing).toMatchObject({ listed: true, listedOn: TODAY });
  });

  it('after "Keep editing", the next navigation still works', async () => {
    const { navigate } = await import('../src/ui/router.js');
    await go('#/tenants/new');
    const first = main.querySelector('input[name=firstName]');
    first.value = 'Draft';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    const dialogs = () => [...document.querySelectorAll('dialog[open]')];
    // Asking for the page that is already open (as the New menu can).
    navigate('/tenants/new');
    for (let i = 0; i < 20 && !dialogs().length; i++) await settle();
    [...dialogs().pop().querySelectorAll('button')].find((b) => b.textContent === 'Keep editing').click();
    await settle();
    location.hash = '#/properties'; // the browser fires one hashchange
    for (let i = 0; i < 20 && !dialogs().length; i++) await settle();
    const prompt = dialogs().pop();
    expect(prompt?.textContent).toMatch(/Discard unsaved changes/);
    [...prompt.querySelectorAll('button')].find((b) => b.textContent === 'Discard changes').click();
    for (let i = 0; i < 50 && main.querySelector('h1')?.textContent !== 'Properties'; i++) await settle();
    expect(main.querySelector('h1').textContent).toBe('Properties');
  });

  it('a screen whose code cannot be loaded offers a reload, not "Page not found"', async () => {
    const { VIEWS } = await import('../src/ui/viewhost.js');
    const real = VIEWS.owners;
    VIEWS.owners = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    try {
      await go('#/owners');
      expect(main.querySelector('h1').textContent).toBe('Something went wrong');
      expect([...main.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);
    } finally {
      VIEWS.owners = real;
    }
  });

  it('figures out property income from the ledger', async () => {
    const { incomeByAccount, propertyFigures } = await import('../src/views/properties/shared.js');
    const is = incomeByAccount(['pr-maple'], '2026-01-01', TODAY);
    expect(is.totalIncome).toBeGreaterThan(0);
    expect(is.net).toBe(is.totalIncome - is.totalExpense);
    const f = propertyFigures('pr-maple');
    expect(f.units).toBe(8);
    expect(f.occupied + f.vacant).toBe(8);
  });

  it('derives tenant status from leases', async () => {
    const { tenantStatus } = await import('../src/views/properties/shared.js');
    const future = app.store.all('leases').find((l) => l.start > TODAY);
    expect(tenantStatus(future.tenantIds[0])).toBe('future');
    const past = app.store.all('leases').find((l) => l.moveOut && l.moveOut.date < TODAY);
    expect(tenantStatus(past.tenantIds[0])).toBe('past');
  });
});
