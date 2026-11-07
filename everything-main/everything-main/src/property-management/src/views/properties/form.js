/** Create or edit a property. New properties set up their units in the same form. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, field, textInput, textarea, select, moneyInput, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { PROPERTY_TYPES } from '../../core/settings.js';
import { displayName } from '../../core/format.js';
import { newId } from '../../core/ids.js';
import { addressFields, bankSelect, memberSelect } from '../common.js';
import { chipsEditor, generateUnitNames } from './shared.js';

const SINGLE = new Set(['single-family']);

function typeSelect(value) {
  const s = h(
    'select.select',
    { name: 'type' },
    ['Residential', 'Commercial'].map((g) => h('optgroup', { label: g }, PROPERTY_TYPES.filter((t) => t.group === g).map((t) => h('option', { value: t.id }, t.label)))),
  );
  s.value = value || 'multi-family';
  return s;
}

const blankUnit = () => ({ key: newId(), name: '', beds: '', baths: '', sqft: '', marketRent: 0 });

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('properties', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'building', title: 'Property not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/properties' }, 'Back to properties')] }));
  }
  const settings = store.state.settings;
  const draft = existing
    ? structuredClone(existing)
    : { name: '', type: 'multi-family', address: {}, owners: [], managerId: '', bankAccountId: settings.accounting?.defaultBankId || '', reserve: 0, active: true, yearBuilt: '', description: '', amenities: [] };
  draft.owners ??= [];
  draft.amenities ??= [];
  const units = existing ? null : [blankUnit(), blankUnit()];
  let saved = false;

  const form = h('form.rn-form', { novalidate: true });
  const name = textInput({ name: 'name', value: draft.name, autofocus: !existing || null, placeholder: 'e.g. Maple Court Apartments' });
  const type = typeSelect(draft.type);
  const year = textInput({ name: 'yearBuilt', type: 'number', min: 1700, max: 2100, value: draft.yearBuilt ?? '' });
  const description = textarea({ name: 'description', rows: 3, value: draft.description || '', placeholder: 'A short description for listings and your team' });
  const addr = addressFields(draft.address || {}, { required: true });
  const amenities = chipsEditor(draft.amenities, { label: 'Add amenity', placeholder: 'e.g. Laundry room, then Enter' });
  const nameError = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a property name.');

  const details = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Property details')),
    h(
      'div.card-body.stack',
      h('div.form-grid', field('Property name', name, { span2: true, required: true }), field('Type', type), field('Year built', year)),
      nameError,
      h('div.form-grid', ...addr.node),
      field('Description', description),
      field('Amenities', amenities, { hint: 'Shown on listings' }),
    ),
  );

  // ---- Owners -----------------------------------------------------------------------
  const ownersBody = h('div.stack');
  const ownerTotal = h('span.rn-owner-total', { 'aria-live': 'polite' });
  function drawOwners() {
    const owners = store.all('owners').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const used = new Set(draft.owners.map((o) => o.ownerId));
    ownersBody.replaceChildren(
      ...draft.owners.map((o, i) => {
        const sel = h(
          'select.select',
          { 'aria-label': `Owner ${i + 1}` },
          owners.filter((x) => x.id === o.ownerId || !used.has(x.id)).map((x) => h('option', { value: x.id }, displayName(x))),
        );
        sel.value = o.ownerId;
        sel.addEventListener('change', () => {
          o.ownerId = sel.value;
          drawOwners();
        });
        const pct = textInput({ type: 'number', min: 0, max: 100, step: 'any', value: o.pct, 'aria-label': `Ownership percent for owner ${i + 1}`, cls: 'num' });
        pct.addEventListener('input', () => {
          o.pct = Number(pct.value) || 0;
          paintTotal();
        });
        return h(
          'div.rn-owner-row',
          sel,
          h('div.input-affix.rn-suffix.rn-pct', pct, h('span.affix-end', '%')),
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove owner ${i + 1}`, onClick: () => (draft.owners.splice(i, 1), rebalance(), drawOwners()) }, icon('x', 16)),
        );
      }),
      h(
        'div.row',
        owners.length > used.size
          ? h(
              'button.btn.sm.ghost',
              {
                type: 'button',
                onClick: () => {
                  const next = owners.find((x) => !used.has(x.id));
                  draft.owners.push({ ownerId: next.id, pct: 0 });
                  rebalance();
                  drawOwners();
                },
              },
              icon('plus', 14),
              'Add owner',
            )
          : null,
        h(
          'button.btn.sm.ghost',
          {
            type: 'button',
            onClick: async () => {
              const { quickOwnerDialog } = await import('../people/owner-form.js');
              const o = await quickOwnerDialog();
              if (!o) return;
              draft.owners.push({ ownerId: o.id, pct: 0 });
              rebalance();
              drawOwners();
            },
          },
          icon('user-plus', 14),
          'New rental owner',
        ),
        h('div.spacer'),
        ownerTotal,
      ),
    );
    paintTotal();
  }
  function rebalance() {
    const n = draft.owners.length;
    if (!n) return;
    const share = Math.floor((100 / n) * 100) / 100;
    draft.owners.forEach((o, i) => (o.pct = i === n - 1 ? Math.round((100 - share * (n - 1)) * 100) / 100 : share));
  }
  function totalPct() {
    return Math.round(draft.owners.reduce((s, o) => s + (Number(o.pct) || 0), 0) * 100) / 100;
  }
  function paintTotal() {
    const t = totalPct();
    ownerTotal.textContent = draft.owners.length ? `Total ${t}%` : 'No owners yet';
    ownerTotal.classList.toggle('bad', !!draft.owners.length && t !== 100);
  }
  drawOwners();

  // ---- Management and banking ---------------------------------------------------------
  const manager = memberSelect({ name: 'managerId', value: draft.managerId || '', empty: 'No manager assigned' });
  const bank = bankSelect({ name: 'bankAccountId', value: draft.bankAccountId });
  const reserve = moneyInput({ name: 'reserve', cents: draft.reserve || 0 });
  const management = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Owners and management')),
    h(
      'div.card-body.stack',
      h('div', h('div.field-label', 'Rental owners'), ownersBody),
      h('div.form-grid', field('Property manager', manager), field('Operating bank account', bank, { hint: 'Rent for this property is deposited here' }), field('Property reserve', reserve, { hint: 'Cash kept back from owner distributions' })),
    ),
  );

  // ---- Units (new properties only) ---------------------------------------------------
  let unitsCard = null;
  const unitsBody = h('div');
  function drawUnits() {
    const single = SINGLE.has(type.value);
    if (single) {
      unitsBody.replaceChildren(h('p.subtle', 'A single-family home has one unit. It is created for you, and you can set its details after saving.'));
      return;
    }
    const rows = units.map((u, i) => {
      const inp = (key, attrs) => {
        const el = textInput({ value: u[key], 'aria-label': `${attrs.label} for unit ${i + 1}`, ...attrs.input });
        el.addEventListener('input', () => (u[key] = el.value));
        return el;
      };
      const rent = moneyInput({ cents: u.marketRent, 'aria-label': `Market rent for unit ${i + 1}` });
      rent.addEventListener('input', () => (u.marketRent = rent.cents));
      return h(
        'div.rn-unit-row',
        inp('name', { label: 'Name', input: { placeholder: 'Unit' } }),
        inp('beds', { label: 'Bedrooms', input: { type: 'number', min: 0, placeholder: 'Beds' } }),
        inp('baths', { label: 'Bathrooms', input: { type: 'number', min: 0, step: 0.5, placeholder: 'Baths' } }),
        inp('sqft', { label: 'Size', input: { type: 'number', min: 0, placeholder: 'Sq ft' } }),
        rent,
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove unit ${i + 1}`, onClick: () => (units.splice(i, 1), drawUnits()) }, icon('x', 16)),
      );
    });
    const start = textInput({ value: '101', 'aria-label': 'First unit name', cls: 'rn-gen-start' });
    const count = textInput({ type: 'number', min: 1, max: 200, value: 4, 'aria-label': 'Number of units', cls: 'rn-gen-count' });
    unitsBody.replaceChildren(
      units.length ? h('div.rn-unit-head', { 'aria-hidden': 'true' }, h('span', 'Unit'), h('span', 'Beds'), h('span', 'Baths'), h('span', 'Sq ft'), h('span', 'Market rent'), h('span')) : null,
      h('div.stack.rn-unit-rows', rows),
      h(
        'div.rn-unit-actions',
        h('button.btn.sm.ghost', { type: 'button', onClick: () => (units.push(blankUnit()), drawUnits(), [...unitsBody.querySelectorAll('.rn-unit-row')].at(-1)?.querySelector('input')?.focus()) }, icon('plus', 14), 'Add unit'),
        h(
          'div.rn-gen',
          h('span.subtle', 'Or add'),
          count,
          h('span.subtle', 'units starting at'),
          start,
          h(
            'button.btn.sm',
            {
              type: 'button',
              onClick: () => {
                const have = new Set(units.map((u) => u.name.trim().toLowerCase()).filter(Boolean));
                const named = units.filter((u) => u.name.trim() || u.beds || u.sqft || u.marketRent);
                const fresh = generateUnitNames(start.value, count.value)
                  .filter((n) => !have.has(n.toLowerCase()))
                  .map((n) => ({ ...blankUnit(), name: n }));
                units.splice(0, units.length, ...named, ...fresh);
                drawUnits();
              },
            },
            'Generate',
          ),
        ),
      ),
    );
  }
  if (units) {
    unitsCard = h('section.card', h('div.card-head', h('h2.grow', 'Units'), h('span.subtle', 'You can change units later')), h('div.card-body', unitsBody));
    type.addEventListener('change', drawUnits);
    drawUnits();
  }

  const actions = h(
    'div.rn-form-actions',
    h('div.spacer'),
    h('a.btn', { href: existing ? `#/properties/${existing.id}` : '#/properties' }, 'Cancel'),
    h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Create property'),
  );

  form.append(h('div.rn-form-cols', h('div.stack', details), h('div.stack', management, unitsCard)), actions);

  const snapshot = () =>
    JSON.stringify({ n: name.value, t: type.value, y: year.value, d: description.value, a: addr.value(), am: draft.amenities, o: draft.owners, m: manager.value, b: bank.value, r: reserve.value, u: units });
  const initial = snapshot();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim()) {
      nameError.hidden = false;
      name.setAttribute('aria-invalid', 'true');
      name.focus();
      return;
    }
    const address = addr.value();
    if (!address.street) {
      const street = form.querySelector('[name=street]');
      street.setAttribute('aria-invalid', 'true');
      street.focus();
      toast('Enter the street address.', { type: 'error' });
      return;
    }
    const owners = draft.owners.filter((o) => o.ownerId);
    if (owners.length && totalPct() !== 100) {
      toast('Ownership must add up to 100%.', { type: 'error' });
      ownersBody.querySelector('input')?.focus();
      return;
    }
    const single = SINGLE.has(type.value);
    if (!existing && !single) {
      // Two units with one name would be indistinguishable everywhere.
      const seen = new Set();
      const dup = units.map((u) => u.name.trim()).find((n) => n && (seen.has(n.toLowerCase()) || !seen.add(n.toLowerCase())));
      if (dup) {
        toast(`Two units are named ${dup}. Give each unit its own name.`, { type: 'error' });
        return;
      }
    }
    const rec = {
      ...draft,
      name: name.value.trim(),
      type: type.value,
      yearBuilt: year.value ? Number(year.value) : null,
      description: description.value.trim(),
      address,
      owners: owners.map((o) => ({ ownerId: o.ownerId, pct: Number(o.pct) || 0 })),
      managerId: manager.value || null,
      bankAccountId: bank.value || null,
      reserve: reserve.cents,
      singleUnit: existing ? (single && lookup.unitsOf(existing.id).length <= 1) || false : single,
    };
    const savedRec = store.put('properties', rec);
    if (!existing) {
      if (single) store.put('units', { propertyId: savedRec.id, name: 'Home', beds: null, baths: null, sqft: null, marketRent: 0 });
      else {
        const list = units.filter((u) => u.name.trim());
        if (list.length)
          store.bulkPut(
            'units',
            list.map((u) => ({
              propertyId: savedRec.id,
              name: u.name.trim(),
              beds: u.beds === '' ? null : Number(u.beds),
              baths: u.baths === '' ? null : Number(u.baths),
              sqft: u.sqft === '' ? null : Number(u.sqft),
              marketRent: u.marketRent || 0,
            })),
          );
      }
    }
    saved = true;
    toast(existing ? 'Property saved' : `${savedRec.name} created`);
    navigate(`/properties/${savedRec.id}${existing ? '' : single ? '' : '?tab=units'}`);
  });

  const title = existing ? `Edit ${existing.name}` : 'New property';
  return {
    node: h(
      'div.page',
      pageHeader({ title, crumbs: [{ label: 'Properties', href: '#/properties' }, ...(existing ? [{ label: existing.name, href: `#/properties/${existing.id}` }] : [])] }),
      form,
    ),
    title,
    dirty: () => !saved && snapshot() !== initial,
  };
}
