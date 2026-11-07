import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import {
  parseCsv, sniffDelimiter, guessMapping, looksLikeHeader, planImport, catalogCsv,
} from '../src/lib/product-csv.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF, and a BOM', () => {
    const text = '﻿Name,Price\r\n"Mug, large",16.00\r\n"He said ""hi""",2\r\n';
    expect(parseCsv(text)).toEqual([
      ['Name', 'Price'],
      ['Mug, large', '16.00'],
      ['He said "hi"', '2'],
    ]);
  });

  it('drops blank lines but keeps empty cells', () => {
    expect(parseCsv('a,b\n\n,c\n')).toEqual([['a', 'b'], ['', 'c']]);
  });

  it('reads semicolon files, which is how Excel writes them in much of Europe', () => {
    const text = 'Name;Price\nCafé;4,60\n';
    expect(sniffDelimiter(text)).toBe(';');
    expect(parseCsv(text, ';')).toEqual([['Name', 'Price'], ['Café', '4,60']]);
  });

  it('ignores delimiters inside a quoted header cell when sniffing', () => {
    expect(sniffDelimiter('"Name, full";Price\n')).toBe(';');
  });
});

describe('guessMapping', () => {
  it('finds the obvious columns whatever they are called', () => {
    const map = guessMapping(['Item Name', 'Retail price', 'Cost price', 'Barcode', 'Department', 'Qty']);
    expect(map).toEqual({ name: 0, price: 1, cost: 2, sku: 3, category: 4, stock: 5 });
  });

  it('prefers an exact match over a loose one', () => {
    const map = guessMapping(['Price includes tax', 'Price']);
    expect(map.price).toBe(1);
  });

  it('tells a header row from a first product', () => {
    expect(looksLikeHeader(['Name', 'Price'])).toBe(true);
    expect(looksLikeHeader(['Latte', '4.60'])).toBe(false);
  });
});

describe('planImport', () => {
  const mapping = { name: 0, price: 1, sku: 2, category: 3, cost: 4, stock: 5, tax: 6 };
  const row = (name, price, sku = '', cat = '', cost = '', stock = '', tax = '') =>
    [name, price, sku, cat, cost, stock, tax];

  it('creates what is new and skips what it cannot use', () => {
    const plan = planImport([
      row('Latte', '4.60'),
      row('', '3.00'),
      row('Nameless price', ''),
      row('Bad price', 'four fifty'),
    ], mapping, store);

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].patch).toMatchObject({ name: 'Latte', price: 4.6 });
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'no name', 'no price', 'price “four fifty” isn’t a number',
    ]);
    // Row numbers are the spreadsheet's own, so a shopkeeper can go and look.
    expect(plan.skipped[0].rowNumber).toBe(3);
  });

  it('matches an existing product by SKU and updates rather than duplicates', async () => {
    const existing = await store.addProduct({ name: 'House blend', price: 14, sku: 'BEAN-HB' });
    const plan = planImport([row('House blend 250g', '15.50', 'bean-hb')], mapping, store);
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe(existing.id);
    expect(plan.updates[0].matchedBy).toBe('sku');
    expect(plan.updates[0].patch.price).toBe(15.5);
  });

  it('falls back to the name only when the row carries no SKU', async () => {
    const existing = await store.addProduct({ name: 'Latte', price: 4.6 });
    const byName = planImport([row('latte', '5.00')], mapping, store);
    expect(byName.updates[0]).toMatchObject({ id: existing.id, matchedBy: 'name' });

    // With a SKU of its own it is a different product, not this one renamed.
    const withSku = planImport([row('Latte', '5.00', 'NEW-1')], mapping, store);
    expect(withSku.updates).toHaveLength(0);
    expect(withSku.creates).toHaveLength(1);
  });

  it('refuses to let two rows update the same product', async () => {
    await store.addProduct({ name: 'Latte', price: 4.6, sku: 'L1' });
    const plan = planImport([row('Latte', '5.00', 'L1'), row('Latte big', '6.00', 'L1')], mapping, store);
    expect(plan.updates).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('a row above already updates this product');
  });

  it('collects categories to create, once, in the file’s own spelling', () => {
    const plan = planImport([
      row('Latte', '4.60', '', 'Drinks'),
      row('Mocha', '4.90', '', 'drinks'),
      row('Scone', '3.20', '', 'Bakery'),
    ], mapping, store);
    expect(plan.newCategories).toEqual(['Drinks', 'Bakery']);
    expect(plan.creates[1].patch.categoryName).toBe('drinks');
  });

  it('matches a tax by name or rate, honours tax-free, and reports the rest', async () => {
    const tax = await store.addTax({ name: 'Sales tax', rate: 7.75 });
    const plan = planImport([
      row('A', '1', '', '', '', '', 'sales tax'),
      row('B', '1', '', '', '', '', '7.75%'),
      row('C', '1', '', '', '', '', 'Exempt'),
      row('D', '1', '', '', '', '', 'GST'),
    ], mapping, store);
    expect(plan.creates[0].patch.taxId).toBe(tax.id);
    expect(plan.creates[1].patch.taxId).toBe(tax.id);
    expect(plan.creates[2].patch.taxId).toBe('none');
    expect(plan.creates[3].patch.taxId).toBeUndefined();
    expect(plan.unknownTaxes).toEqual(['GST']);
  });

  it('turns stock tracking on only where a number was given', () => {
    const plan = planImport([row('A', '1', '', '', '', '12'), row('B', '1')], mapping, store);
    expect(plan.creates[0].patch).toMatchObject({ trackStock: true, stock: 12 });
    expect(plan.creates[1].patch.trackStock).toBeUndefined();
  });

  it('leaves a column the file lacks alone on an update', async () => {
    const p = await store.addProduct({ name: 'Beans', price: 14, cost: 8.2, sku: 'B1', trackStock: true, stock: 9 });
    // Name, price and SKU only - no cost or stock column at all.
    const plan = planImport([['Beans', '15', 'B1']], { name: 0, price: 1, sku: 2 }, store);
    expect(plan.updates[0].patch.cost).toBeUndefined();
    await store.importProducts(plan);
    const after = store.product(p.id);
    expect(after.price).toBe(15);
    expect(after.cost).toBe(8.2);
    expect(after.stock).toBe(9);
  });
});

describe('importProducts', () => {
  const mapping = { name: 0, price: 1, sku: 2, category: 3 };

  it('creates categories once and points the new products at them', async () => {
    const plan = planImport([
      ['Latte', '4.60', '', 'Drinks'],
      ['Mocha', '4.90', '', 'drinks'],
    ], mapping, store);
    const result = await store.importProducts(plan);
    expect(result).toMatchObject({ created: 2, updated: 0, categories: 1 });
    const cat = store.categories.find((c) => c.name === 'Drinks');
    expect(store.products.every((p) => p.categoryId === cat.id)).toBe(true);
  });

  it('is durable, and rolls the whole import back if the write fails', async () => {
    const plan = planImport([['Latte', '4.60', '', 'Drinks']], mapping, store);
    mock.failNextKvSet();
    await expect(store.importProducts(plan)).rejects.toThrow();
    expect(store.products).toHaveLength(0);
    expect(store.categories).toHaveLength(0);

    const again = await store.importProducts(plan);
    expect(again.created).toBe(1);
    const fresh = new Store();
    await fresh.init();
    expect(fresh.products).toHaveLength(1);
    expect(fresh.categories).toHaveLength(1);
  });

  it('gives imported products tile colors by category', async () => {
    const plan = planImport([
      ['Latte', '4.60', '', 'Drinks'],
      ['Mocha', '4.90', '', 'Drinks'],
      ['Scone', '3.20', '', 'Bakery'],
    ], mapping, store);
    await store.importProducts(plan);
    const slot = (name) => store.products.find((p) => p.name === name).slot;
    expect(slot('Latte')).toBe(slot('Mocha'));
    expect(slot('Scone')).not.toBe(slot('Latte'));
  });

  it('drops an update whose product was deleted while the preview was open', async () => {
    const p = await store.addProduct({ name: 'Latte', price: 4.6, sku: 'L1' });
    const plan = planImport([['Latte', '5.00', 'L1']], mapping, store);
    await store.deleteProduct(p.id);
    const result = await store.importProducts({ ...plan, creates: [{ patch: { name: 'X', price: 1 } }] });
    expect(result).toMatchObject({ created: 1, updated: 0 });
  });
});

describe('catalogCsv', () => {
  it('round-trips a catalog through its own export', async () => {
    const cat = await store.addCategory('Coffee beans');
    const tax = await store.addTax({ name: 'Sales tax', rate: 7.75 });
    const beans = await store.addProduct({
      name: 'House blend', price: 14, cost: 8.2, sku: 'BEAN-HB',
      categoryId: cat.id, taxId: tax.id, trackStock: true, stock: 24, lowStock: 6,
    });
    // No SKU and no cost: the id column is what makes this one match itself.
    const water = await store.addProduct({ name: 'Tap water', price: 0, soldBy: 'measure', unit: 'L' });

    const text = catalogCsv(store.products, store);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual([
      'Id', 'Name', 'Price', 'Cost', 'SKU', 'Category', 'Tax', 'Unit',
      'Stock on hand', 'Low-stock alert at',
    ]);
    // An uncosted product exports an empty cell, never a zero.
    const waterRow = rows.find((r) => r[1] === 'Tap water');
    expect(waterRow[3]).toBe('');
    expect(waterRow[7]).toBe('L');

    const mapping = guessMapping(rows[0]);
    const plan = planImport(rows.slice(1), mapping, store);
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(2);
    expect(plan.updates.every((u) => u.matchedBy === 'id')).toBe(true);

    await store.importProducts(plan);
    expect(store.products).toHaveLength(2);
    expect(store.product(beans.id)).toMatchObject({ price: 14, cost: 8.2, stock: 24, lowStock: 6 });
    expect(store.product(water.id)).toMatchObject({ soldBy: 'measure', unit: 'L' });
  });
});

describe('guessFromRows', () => {
  it('finds the name and the price in a file with no header at all', async () => {
    const { guessFromRows } = await import('../src/lib/product-csv.js');
    expect(guessFromRows([
      ['Latte', '4.60', '12'],
      ['Mocha', '4.90', '4'],
      ['Scone', '3.20', '9'],
    ])).toEqual({ name: 0, price: 1 });
  });

  it('has no answer for an empty file rather than guessing one', async () => {
    const { guessFromRows } = await import('../src/lib/product-csv.js');
    expect(guessFromRows([])).toEqual({});
  });
});
