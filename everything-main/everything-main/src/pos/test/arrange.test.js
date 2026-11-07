import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

/** Four products in two categories, added in a known order. */
async function catalog() {
  const drinks = await store.addCategory('Drinks');
  const food = await store.addCategory('Food');
  const made = [];
  for (const [name, cat] of [['Latte', drinks], ['Scone', food], ['Mocha', drinks], ['Pie', food]]) {
    made.push(await store.addProduct({ name, price: 1, categoryId: cat.id }));
  }
  return { drinks, food, made };
}

const names = () => store.productsInOrder().map((p) => p.name);

describe('productsInOrder', () => {
  it('is insertion order until somebody arranges the grid', async () => {
    await catalog();
    expect(names()).toEqual(['Latte', 'Scone', 'Mocha', 'Pie']);
  });

  it('puts a product added after an arrangement at the end, not in it', async () => {
    const { made } = await catalog();
    await store.reorderProducts([made[3].id, made[0].id, made[1].id, made[2].id]);
    expect(names()).toEqual(['Pie', 'Latte', 'Scone', 'Mocha']);
    await store.addProduct({ name: 'Bun', price: 1 });
    expect(names()).toEqual(['Pie', 'Latte', 'Scone', 'Mocha', 'Bun']);
  });
});

describe('reorderProducts', () => {
  it('rearranges within a category without disturbing anything else', async () => {
    const { drinks, made } = await catalog();
    // What the register shows under "Drinks", swapped.
    const shown = store.productsInOrder().filter((p) => p.categoryId === drinks.id);
    expect(shown.map((p) => p.name)).toEqual(['Latte', 'Mocha']);
    await store.reorderProducts([shown[1].id, shown[0].id]);
    // The two drinks trade places; the food products keep their own slots.
    expect(names()).toEqual(['Mocha', 'Scone', 'Latte', 'Pie']);
    expect(store.product(made[1].id).sortOrder).toBe(1);
  });

  it('stamps every product with an explicit order, so it survives a restore', async () => {
    const { made } = await catalog();
    await store.reorderProducts([made[2].id, made[0].id]);
    expect(store.products.every((p) => Number.isFinite(p.sortOrder))).toBe(true);

    const data = await store.exportAll();
    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.productsInOrder().map((p) => p.name)).toEqual(names());
  });

  it('rolls back an arrangement the cloud refused', async () => {
    const { made } = await catalog();
    mock.failNextKvSet();
    await expect(store.reorderProducts([made[3].id, made[0].id])).rejects.toThrow();
    expect(names()).toEqual(['Latte', 'Scone', 'Mocha', 'Pie']);
  });

  it('refuses an arrangement that names a product twice', async () => {
    const { made } = await catalog();
    await expect(store.reorderProducts([made[0].id, made[0].id])).rejects.toThrow(/doesn’t match/);
  });

  it('ignores ids that are no longer in the catalog', async () => {
    const { made } = await catalog();
    await store.reorderProducts(['gone', made[2].id, made[0].id]);
    expect(names()).toEqual(['Mocha', 'Scone', 'Latte', 'Pie']);
  });
});

describe('favorites', () => {
  it('pins and unpins a product, and travels in a backup', async () => {
    const { made } = await catalog();
    await store.setFavorite(made[1].id, true);
    expect(store.products.filter((p) => p.favorite).map((p) => p.name)).toEqual(['Scone']);

    const data = await store.exportAll();
    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.products.filter((p) => p.favorite).map((p) => p.name)).toEqual(['Scone']);

    await store.setFavorite(made[1].id, false);
    expect(store.products.some((p) => p.favorite)).toBe(false);
  });

  it('survives an ordinary edit of the same product', async () => {
    const { made } = await catalog();
    await store.setFavorite(made[0].id, true);
    await store.reorderProducts([made[3].id, made[0].id]);
    // The product form knows nothing about favorites or order; saving it
    // must not quietly drop either.
    await store.updateProduct(made[0].id, { name: 'Latte', price: 5 });
    const latte = store.product(made[0].id);
    expect(latte.favorite).toBe(true);
    expect(Number.isFinite(latte.sortOrder)).toBe(true);
    expect(latte.price).toBe(5);
  });

  it('rolls a pin back if the write fails', async () => {
    const { made } = await catalog();
    mock.failNextKvSet();
    await expect(store.setFavorite(made[0].id, true)).rejects.toThrow();
    expect(store.product(made[0].id).favorite).toBeUndefined();
  });
});
