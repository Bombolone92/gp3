import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import {
  loyaltyScheme, loyaltyProgress, lineEarns, progressText, progressSnapshot, rewardForCart,
} from '../src/lib/loyalty.js';
import { receiptDoc } from '../src/lib/receipt-doc.js';
import { fullRefundPicks } from '../src/lib/refunds.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

describe('loyaltyScheme', () => {
  it('is null when off, and null when it wouldn’t work', () => {
    expect(loyaltyScheme({})).toBeNull();
    expect(loyaltyScheme({ loyalty: { enabled: false, type: 'stamps', productId: 'p' } })).toBeNull();
    // Stamps with nothing chosen to stamp is not a scheme.
    expect(loyaltyScheme({ loyalty: { enabled: true, type: 'stamps', stamps: 10 } })).toBeNull();
  });

  it('is not running when what earns a stamp has left the catalog', () => {
    const settings = { loyalty: { enabled: true, type: 'stamps', productId: 'p1', stamps: 10 } };
    // Without a catalog to check against, the setting speaks for itself.
    expect(loyaltyScheme(settings)?.productId).toBe('p1');
    const catalog = { product: (id) => (id === 'p1' ? { id: 'p1' } : null), category: () => null };
    expect(loyaltyScheme(settings, catalog)?.productId).toBe('p1');
    // Deleted since: no cart line can ever match it, so the card is not one.
    const emptied = { product: () => null, category: () => null };
    expect(loyaltyScheme(settings, emptied)).toBeNull();
    const byCategory = { loyalty: { enabled: true, type: 'stamps', categoryId: 'c1', stamps: 6 } };
    expect(loyaltyScheme(byCategory, emptied)).toBeNull();
    expect(loyaltyScheme(byCategory, { category: (id) => (id === 'c1' ? { id: 'c1' } : null) })?.target).toBe(6);
    // A spend scheme names nothing in the catalog, so the check leaves it be.
    const spend = { loyalty: { enabled: true, type: 'spend', percent: 5, threshold: 5 } };
    expect(loyaltyScheme(spend, emptied)?.percent).toBe(5);
  });

  it('clamps a scheme into something describable', () => {
    const s = loyaltyScheme({ loyalty: { enabled: true, type: 'stamps', productId: 'p', stamps: 900 } });
    expect(s).toMatchObject({ type: 'stamps', scope: 'product', target: 50, rewardName: 'a free one' });
    const spend = loyaltyScheme({ loyalty: { enabled: true, type: 'spend', percent: 400, threshold: 5 } });
    expect(spend).toMatchObject({ type: 'spend', percent: 50, threshold: 5 });
  });
});

describe('a stamps card', () => {
  const scheme = { type: 'stamps', scope: 'product', productId: 'p-coffee', target: 10, rewardName: 'a free coffee' };
  const sale = (qty, over = {}) => ({
    lines: [{ productId: 'p-coffee', qty, total: qty * 4, tax: 0 }], ...over,
  });

  it('counts stamps off real sales', () => {
    const p = loyaltyProgress([sale(3), sale(4)], scheme, store);
    expect(p).toMatchObject({ earned: 7, onCard: 7, target: 10, ready: false, remaining: 3 });
    expect(progressText(p, money)).toBe('7 of 10 toward a free coffee');
  });

  it('takes stamps back with a refunded sale', () => {
    const bought = sale(9);
    const refunded = { lines: [{ productId: 'p-coffee', qty: -4, total: -16, tax: 0 }] };
    expect(loyaltyProgress([bought, refunded], scheme, store).onCard).toBe(5);
  });

  it('ignores voided sales and things the card isn’t for', () => {
    const other = { lines: [{ productId: 'p-mug', qty: 5, total: 80, tax: 0 }] };
    expect(loyaltyProgress([sale(4, { voidedAt: 1 }), other], scheme, store).earned).toBe(0);
  });

  it('earns nothing on the free one', () => {
    // The redeemed line is fully discounted, so its total is zero.
    const free = { lines: [{ productId: 'p-coffee', qty: 1, total: 0, tax: 0 }] };
    expect(lineEarns(free.lines[0], scheme, store)).toBe(false);
  });

  it('resets the card when a reward is taken, and remembers what it cost', () => {
    const redeemed = { lines: [{ productId: 'p-coffee', qty: 1, total: 0, tax: 0 }], reward: { kind: 'stamps', value: 4 } };
    const p = loyaltyProgress([sale(10), redeemed], scheme, store);
    expect(p).toMatchObject({ earned: 0, ready: false, redeemed: 1, redeemedValue: 4 });
    // The shop's own name for the reward opens the sentence; no second article.
    expect(progressText(loyaltyProgress([sale(10)], scheme, store), money)).toBe('A free coffee is ready');
    expect(progressText({ type: 'spend', ready: true, earned: 5, rewardName: 'money off' }, money))
      .toBe('$5.00 ready to spend');
  });

  it('offers the cheapest qualifying line, and nothing when there is none', () => {
    const ready = loyaltyProgress([sale(10)], scheme, store);
    const cart = [
      { productId: 'p-coffee', unitPrice: 4.6, qty: 1 },
      { productId: 'p-coffee', unitPrice: 3.2, qty: 2 },
      { productId: 'p-mug', unitPrice: 16, qty: 1 },
    ];
    expect(rewardForCart(cart, ready, scheme, store)).toMatchObject({ kind: 'stamps', lineIndex: 1, amount: 3.2 });
    // Nothing the card is for in the basket: the honest answer is none.
    expect(rewardForCart([cart[2]], ready, scheme, store)).toBeNull();
    // Not ready yet: no offer either.
    expect(rewardForCart(cart, loyaltyProgress([sale(3)], scheme, store), scheme, store)).toBeNull();
  });

  it('stamps a whole category when that is the scope', async () => {
    const cat = await store.addCategory('Drinks');
    const p = await store.addProduct({ name: 'Latte', price: 4.6, categoryId: cat.id });
    const catScheme = loyaltyScheme({
      loyalty: { enabled: true, type: 'stamps', categoryId: cat.id, stamps: 5, rewardName: 'a free drink' },
    });
    const sales = [{ lines: [{ productId: p.id, qty: 2, total: 9.2, tax: 0 }] }];
    expect(loyaltyProgress(sales, catScheme, store).onCard).toBe(2);
  });
});

describe('a spend scheme', () => {
  const scheme = { type: 'spend', percent: 5, threshold: 5, rewardName: 'money off' };
  const sale = (net) => ({ lines: [{ productId: 'p', qty: 1, total: net + 1, tax: 1 }] });

  it('earns a share of takings net of tax, and unlocks at the threshold', () => {
    const p = loyaltyProgress([sale(100)], scheme, store);
    expect(p).toMatchObject({ earned: 5, ready: true });
    const under = loyaltyProgress([sale(40)], scheme, store);
    expect(under).toMatchObject({ earned: 2, ready: false, remaining: 3 });
    expect(progressText(under, money)).toBe('$2.00 earned · $5.00 unlocks money off');
  });

  it('takes what was spent off what has been earned', () => {
    const spent = { lines: [], reward: { kind: 'spend', value: 5 } };
    expect(loyaltyProgress([sale(100), spent], scheme, store).earned).toBe(0);
  });

  it('offers the accrued amount for the whole sale', () => {
    const ready = loyaltyProgress([sale(200)], scheme, store);
    expect(rewardForCart([{ productId: 'p', unitPrice: 4, qty: 1 }], ready, scheme, store))
      .toMatchObject({ kind: 'spend', amount: 10 });
  });
});

describe('a redeemed reward on a receipt', () => {
  async function sellWithReward() {
    const product = await store.addProduct({ name: 'Latte', price: 4.6 });
    return store.completeSale({
      lines: [
        { productId: product.id, name: 'Latte', unitPrice: 4.6, qty: 2, taxRate: 0, taxName: '', discount: { type: 'fixed', value: 4.6 } },
      ],
      payment: { method: 'card' },
      reward: { kind: 'stamps', name: 'a free coffee', lineIndex: 0 },
      loyalty: { type: 'stamps', onCard: 0, target: 10, ready: false, rewardName: 'a free coffee' },
    });
  }

  it('records what the reward actually cost, from the cart’s own math', async () => {
    const receipt = await sellWithReward();
    expect(receipt.reward).toEqual({ kind: 'stamps', name: 'a free coffee', value: 4.6 });
    expect(receipt.total).toBe(4.6);
  });

  it('never takes the caller’s word for the value', async () => {
    const product = await store.addProduct({ name: 'Latte', price: 4.6 });
    const receipt = await store.completeSale({
      lines: [{ productId: product.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
      // No discount on the line at all: there is no reward to record.
      reward: { kind: 'stamps', name: 'a free coffee', lineIndex: 0, value: 999 },
    });
    expect(receipt.reward).toBeUndefined();
  });

  it('prints the card, and the reward, on the slip', async () => {
    const receipt = await sellWithReward();
    const doc = receiptDoc(receipt, store.settings);
    expect(doc.loyalty).toBe('0 of 10 toward a free coffee');
    expect(doc.reward).toContain('a free coffee');
  });

  it('leaves the card off a refund slip', async () => {
    const receipt = await sellWithReward();
    const refund = await store.refundSale({
      receiptId: receipt.id, date: receipt.date, picks: fullRefundPicks(receipt),
    });
    expect(receiptDoc(refund, store.settings).loyalty).toBe('');
  });

  it('is sanitized rather than trusted', async () => {
    const product = await store.addProduct({ name: 'Latte', price: 4.6 });
    const receipt = await store.completeSale({
      lines: [{ productId: product.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
      loyalty: { type: 'stamps', onCard: -5, target: 0, rewardName: 'x'.repeat(80) },
    });
    expect(receipt.loyalty).toMatchObject({ onCard: 0, target: 1 });
    expect(receipt.loyalty.rewardName).toHaveLength(40);
  });
});

describe('progressSnapshot', () => {
  it('keeps the figures, not the sentence', () => {
    const p = loyaltyProgress(
      [{ lines: [{ productId: 'p', qty: 3, total: 12, tax: 0 }] }],
      { type: 'stamps', scope: 'product', productId: 'p', target: 10, rewardName: 'a free coffee' },
      store,
    );
    expect(progressSnapshot(p)).toEqual({
      type: 'stamps', onCard: 3, target: 10, ready: false, rewardName: 'a free coffee',
    });
    expect(progressSnapshot(null)).toBeNull();
  });
});
