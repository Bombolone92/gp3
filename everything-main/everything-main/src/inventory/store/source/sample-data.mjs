// Fictional store used only in the isolated promotional-asset browser.
export const CAPTURE_TIME = '2026-09-05T19:00:00.000Z';
export function sampleData() {
  const now = Date.parse(CAPTURE_TIME);
  const day = 86400000;
  const locations = [
    { id: 'warehouse', name: 'Warehouse', note: 'Receiving and reserve stock', createdAt: now - 120 * day },
    { id: 'shop', name: 'Storefront', note: 'Ready for the next customer', createdAt: now - 120 * day },
    { id: 'studio', name: 'Studio', note: 'Orders and assembly', createdAt: now - 120 * day },
  ];
  const suppliers = [
    { id: 'north', name: 'North Supply', contact: 'Alex Morgan', email: '', website: '', phone: '', notes: 'Tuesday delivery', createdAt: now - 120 * day },
    { id: 'paper', name: 'Paper & Co', contact: 'Maya Chen', email: '', website: '', phone: '', notes: 'Weekly stationery orders', createdAt: now - 120 * day },
  ];
  const specs = [
    ['mouse', 'Wireless Mouse', 'WM-310', 'Tech', 18.5, 39, 10, 'north', { warehouse: 96, shop: 24 }],
    ['keyboard', 'Mechanical Keyboard', 'KB-87', 'Tech', 42, 89, 8, 'north', { warehouse: 48, shop: 12 }],
    ['cable', 'USB-C Cable', 'UC-2M', 'Tech', 3.5, 12, 15, 'north', { shop: 6 }],
    ['stand', 'Laptop Stand', 'LS-01', 'Desk', 16, 39, 10, 'north', { warehouse: 46, shop: 6, studio: 12 }],
    ['lamp', 'Desk Lamp', 'DL-02', 'Desk', 24, 59, 8, 'north', { warehouse: 36, shop: 12 }],
    ['notebook', 'Dotted Notebook', 'NB-A5', 'Paper', 3.2, 12, 24, 'paper', { warehouse: 144, shop: 48, studio: 24 }],
    ['pen', 'Gel Pen Set', 'GP-03', 'Paper', 4.5, 14, 12, 'paper', { warehouse: 60, shop: 24 }],
    ['paper', 'Sketch Pad', 'SP-A4', 'Paper', 4.8, 16, 12, 'paper', { shop: 4 }],
    ['headset', 'Studio Headset', 'SH-70', 'Tech', 58, 129, 6, 'north', { warehouse: 30, shop: 8 }],
    ['charger', 'USB-C Charger', 'CH-65', 'Tech', 18, 49, 10, 'north', { warehouse: 42, shop: 18 }],
    ['organizer', 'Desk Organizer', 'DO-01', 'Desk', 12, 32, 8, 'north', { warehouse: 36, shop: 12 }],
    ['hub', 'USB-C Hub', 'HB-06', 'Tech', 22, 59, 8, 'north', { warehouse: 0 }],
  ];
  const products = specs.map(([id, name, sku, category, cost, price, lowStock, supplierId, stock], i) => ({
    id, name, sku, category, cost, price, lowStock, supplierId, stock,
    quantity: Object.values(stock).reduce((sum, n) => sum + n, 0),
    locationId: Object.keys(stock)[0],
    unit: 'each', packSize: 0, packName: '', archived: false,
    barcode: `INV${String(i + 1).padStart(6, '0')}`,
    notes: id === 'stand' ? 'Aluminium, adjustable height' : '',
    createdAt: now - 120 * day, updatedAt: now - 2 * day,
    bin: id === 'stand' ? { warehouse: 'A3-12', shop: 'D2', studio: 'B1' } : {},
    min: id === 'stand' ? { warehouse: 20, shop: 12, studio: 6 } : {},
  }));
  // Receipts and sales reconcile to today's stock for each product.
  const activity = [];
  products.forEach((p, index) => {
    const moves = Array.from({ length: 15 }, (_, j) => 1 + (index + j) % 3);
    let balance = p.quantity + moves.reduce((sum, n) => sum + n, 0);
    activity.push({ id: `${p.id}-receipt`, at: now - 30 * day, kind: 'add', productId: p.id,
      name: p.name, unit: p.unit, delta: balance, quantity: balance,
      cost: p.cost, locationId: p.locationId, note: 'September stock delivery' });
    moves.forEach((qty, j) => {
      balance -= qty;
      activity.push({ id: `${p.id}-sale-${j}`, at: now - (29 - j * 2) * day - index * 1800000,
        kind: 'remove', productId: p.id, name: p.name, unit: p.unit, delta: -qty, quantity: balance,
        cost: p.cost, price: p.price, reason: 'sold', locationId: p.locationId, note: 'Store sale' });
    });
  });
  activity.sort((a, b) => b.at - a.at);
  const snapshots = Array.from({ length: 30 }, (_, index) => {
    const at = now - (29 - index) * day;
    const quantities = new Map(products.map(p => [p.id, 0]));
    [...activity].reverse().filter(a => a.at <= at).forEach(a => quantities.set(a.productId, a.quantity));
    return { date: new Date(at).toISOString().slice(0, 10), products: products.length,
      units: [...quantities.values()].reduce((s, q) => s + q, 0),
      value: Math.round(products.reduce((s, p) => s + quantities.get(p.id) * p.cost, 0) * 100) / 100,
      low: products.filter(p => quantities.get(p.id) > 0 && quantities.get(p.id) <= p.lowStock).length,
      out: products.filter(p => quantities.get(p.id) === 0).length };
  });
  return { settings: { theme: 'light', currency: 'USD', defaultLowStock: 10, safetyDays: 7,
    coverageDays: 30, onboarded: true, sampleData: false }, products, locations, suppliers, activity, snapshots };
}
