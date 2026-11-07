import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  optionUnitPrice, optionsLabel, optionsKey, hasOptions, defaultSelection,
  selectionValid, selectionOptions, optionsToSelection, formatDelta, groupSummary,
} from '../src/lib/options.js';
import { computeCart } from '../src/lib/totals.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';

const latte = {
  id: 'latte',
  name: 'Latte',
  price: 4.6,
  options: [
    {
      id: 'g-size',
      name: 'Size',
      required: true,
      multi: false,
      choices: [
        { id: 'c-s', name: 'Small', delta: -0.4 },
        { id: 'c-r', name: 'Regular', delta: 0 },
        { id: 'c-l', name: 'Large', delta: 0.7 },
      ],
    },
    {
      id: 'g-extras',
      name: 'Extras',
      required: false,
      multi: true,
      choices: [
        { id: 'c-shot', name: 'Extra shot', delta: 0.75 },
        { id: 'c-oat', name: 'Oat milk', delta: 0.6 },
      ],
    },
  ],
};

describe('option pricing', () => {
  it('folds deltas into the unit price, to the cent', () => {
    expect(optionUnitPrice(4.6, [])).toBe(4.6);
    expect(optionUnitPrice(4.6, [{ delta: 0.7 }])).toBe(5.3);
    expect(optionUnitPrice(4.6, [{ delta: 0.7 }, { delta: 0.6 }, { delta: 0.75 }])).toBe(6.65);
    expect(optionUnitPrice(4.6, [{ delta: -0.4 }])).toBe(4.2);
  });

  it('never prices a line below zero', () => {
    expect(optionUnitPrice(1, [{ delta: -5 }])).toBe(0);
  });

  it('survives the float traps whole-dollar arithmetic sets', () => {
    expect(optionUnitPrice(0.1, [{ delta: 0.2 }])).toBe(0.3);
    expect(optionUnitPrice(4.35, [{ delta: 0.35 }])).toBe(4.7);
  });

  it('prices through computeCart identically with tax added on or included', () => {
    const options = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': ['c-oat'] });
    const unitPrice = optionUnitPrice(latte.price, options);   // 4.60 + 0.70 + 0.60
    expect(unitPrice).toBe(5.9);

    const excl = computeCart([{ name: 'Latte', unitPrice, qty: 2, taxRate: 10, options }]);
    expect(excl.subtotal).toBe(11.8);
    expect(excl.taxTotal).toBe(1.18);
    expect(excl.total).toBe(12.98);

    const incl = computeCart([{ name: 'Latte', unitPrice, qty: 2, taxRate: 10, options }], { pricesIncludeTax: true });
    expect(incl.total).toBe(11.8);
    expect(incl.taxTotal).toBe(1.07);
  });
});

describe('option selection', () => {
  it('preselects required groups and leaves optional ones empty', () => {
    const sel = defaultSelection(latte);
    // 'Regular', not 'Small': the preselection has to price at the tile price.
    expect(sel['g-size']).toEqual(['c-r']);
    expect(sel['g-extras']).toEqual([]);
    expect(selectionValid(latte, sel)).toBe(true);
    expect(optionUnitPrice(latte.price, selectionOptions(latte, sel))).toBe(latte.price);
  });

  it('falls back to the first choice when every choice moves the price', () => {
    const bundle = {
      options: [{
        id: 'g', name: 'Pack', required: true, multi: false,
        choices: [{ id: 'a', name: 'Six', delta: 5 }, { id: 'b', name: 'Twelve', delta: 9 }],
      }],
    };
    expect(defaultSelection(bundle).g).toEqual(['a']);
  });

  it('is invalid while a required group is empty', () => {
    expect(selectionValid(latte, { 'g-size': [], 'g-extras': [] })).toBe(false);
    expect(selectionValid(latte, { 'g-size': ['c-r'], 'g-extras': ['c-oat'] })).toBe(true);
  });

  it('flattens to line options in group then choice order', () => {
    const options = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': ['c-oat', 'c-shot'] });
    expect(options).toEqual([
      { group: 'Size', name: 'Large', delta: 0.7 },
      { group: 'Extras', name: 'Extra shot', delta: 0.75 },
      { group: 'Extras', name: 'Oat milk', delta: 0.6 },
    ]);
    expect(optionsLabel(options)).toBe('Large · Extra shot · Oat milk');
  });

  it('round-trips stored options back into a selection', () => {
    const options = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': ['c-shot'] });
    const back = optionsToSelection(latte, options);
    expect(back).toEqual({ 'g-size': ['c-l'], 'g-extras': ['c-shot'] });
  });

  it('falls back to defaults for options the product no longer offers', () => {
    const stale = [{ group: 'Size', name: 'Venti', delta: 2 }, { group: 'Gone', name: 'x', delta: 0 }];
    expect(optionsToSelection(latte, stale)).toEqual({ 'g-size': ['c-r'], 'g-extras': [] });
  });

  it('keeps a single-select group single even if history had two', () => {
    const sel = optionsToSelection(latte, [
      { group: 'Size', name: 'Small', delta: -0.4 },
      { group: 'Size', name: 'Large', delta: 0.7 },
    ]);
    expect(sel['g-size']).toHaveLength(1);
  });
});

describe('option identity', () => {
  it('distinguishes combinations and matches identical ones', () => {
    const large = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': [] });
    const largeAgain = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': [] });
    const small = selectionOptions(latte, { 'g-size': ['c-s'], 'g-extras': [] });
    const largeOat = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': ['c-oat'] });

    expect(optionsKey(large)).toBe(optionsKey(largeAgain));
    expect(optionsKey(large)).not.toBe(optionsKey(small));
    expect(optionsKey(large)).not.toBe(optionsKey(largeOat));
    expect(optionsKey(null)).toBe(optionsKey([]));
  });
});

describe('presentation helpers', () => {
  it('signs deltas and hides zero', () => {
    const money = (n) => `$${n.toFixed(2)}`;
    expect(formatDelta(0.7, money)).toBe('+$0.70');
    expect(formatDelta(-0.4, money)).toBe('−$0.40');
    expect(formatDelta(0, money)).toBe('');
  });

  it('summarizes groups and detects their presence', () => {
    expect(groupSummary(latte.options)).toBe('Size, Extras');
    expect(hasOptions(latte)).toBe(true);
    expect(hasOptions({ name: 'Espresso', options: [] })).toBe(false);
    expect(hasOptions(null)).toBe(false);
  });
});

describe('store persistence of options', () => {
  let mock;
  let store;

  beforeEach(async () => {
    mock = installMockPuter();
    store = new Store();
    await store.init();
  });
  afterEach(() => mock.uninstall());

  it('stores cleaned groups and reads them back', async () => {
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1, options: latte.options });
    expect(p.options).toHaveLength(2);
    expect(p.options[0].choices[0].delta).toBe(-0.4);

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).options[1].multi).toBe(true);
  });

  it('drops half-built groups instead of storing something unaskable', async () => {
    const p = await store.addProduct({
      name: 'X', price: 1, slot: 1,
      options: [
        { name: '   ', choices: [{ name: 'a', delta: 0 }] },      // no group name
        { name: 'Empty', choices: [] },                           // no choices
        { name: 'Blanks', choices: [{ name: '  ', delta: 1 }] },   // no usable choice
        { name: 'Good', choices: [{ name: 'One', delta: '1.25' }, { name: 'Two', delta: 'abc' }] },
      ],
    });
    expect(p.options.map((g) => g.name)).toEqual(['Good']);
    expect(p.options[0].choices.map((c) => c.delta)).toEqual([1.25, 0]);
    expect(p.options[0].choices[0].id).toBeTruthy();
    expect(p.options[0].required).toBe(false);   // absent flags default to off
  });

  it('caps a delta whose cents would leave the exact-integer range', async () => {
    // A price is capped at the form (parseAmount), and a delta must obey the
    // same rule: 1e21 stored raw would quietly break subtotal + tax = total.
    const p = await store.addProduct({
      name: 'X', price: 1, slot: 1,
      options: [{ name: 'Size', choices: [{ name: 'Up', delta: 1e21 }, { name: 'Down', delta: -1e21 }] }],
    });
    expect(p.options[0].choices.map((c) => c.delta)).toEqual([999_999_999.99, -999_999_999.99]);
  });

  it('clearing a product\'s options actually clears them', async () => {
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1, options: latte.options });
    const updated = await store.updateProduct(p.id, { name: 'Latte', price: 4.6, slot: 1, options: [] });
    expect(updated.options).toEqual([]);
    expect(hasOptions(store.product(p.id))).toBe(false);
  });

  it('snapshots chosen options onto the receipt line', async () => {
    const options = selectionOptions(latte, { 'g-size': ['c-l'], 'g-extras': ['c-oat'] });
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1, options: latte.options });
    const receipt = await store.completeSale({
      lines: [{
        productId: p.id, name: 'Latte', unitPrice: optionUnitPrice(4.6, options), qty: 1,
        taxRate: 0, taxName: '', discount: null, options,
      }],
      payment: { method: 'card' },
    });
    expect(receipt.lines[0].options).toEqual(options);
    expect(receipt.total).toBe(5.9);

    // History survives the product losing its options entirely.
    await store.updateProduct(p.id, { name: 'Latte', price: 4.6, slot: 1, options: [] });
    const month = await store.loadMonth(receipt.date.slice(0, 7));
    expect(month[0].lines[0].options).toEqual(options);
  });

  it('leaves the options key off lines that have none', async () => {
    const receipt = await store.completeSale({
      lines: [{ productId: null, name: 'Espresso', unitPrice: 3.2, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    expect('options' in receipt.lines[0]).toBe(false);
  });
});
