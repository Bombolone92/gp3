import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  csvField, toCsv, taxColumns, receiptsCsv, lineItemsCsv, csvFilename, CSV_BOM, csvBlob,
} from '../src/lib/csv.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { todayISO } from '../src/lib/dates.js';
import { round2 } from '../src/lib/util.js';

/** Minimal RFC-4180 reader, so tests assert on parsed cells not on strings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field); field = ''; rows.push(row); row = []; i++;
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const col = (rows, name) => rows[0].indexOf(name);

describe('csvField', () => {
  it('leaves plain values alone', () => {
    expect(csvField('Latte')).toBe('Latte');
    expect(csvField(12)).toBe('12');
    expect(csvField(null)).toBe('');
  });

  it('quotes delimiters, quotes, newlines, and edge whitespace', () => {
    expect(csvField('Cake, large')).toBe('"Cake, large"');
    expect(csvField('12" pizza')).toBe('"12"" pizza"');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(' padded ')).toBe('" padded "');
  });

  it('defuses cells a spreadsheet would run as a formula', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('=HYPERLINK("http://x","Total")')).toBe('"\'=HYPERLINK(""http://x"",""Total"")"');
    expect(csvField('+441234 ext 9')).toBe("'+441234 ext 9");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-2+3')).toBe("'-2+3");
    // The apostrophe also moves the tab off the edge, so it survives unquoted.
    expect(csvField('\t=1')).toBe("'\t=1");
  });

  it('leaves real numbers as numbers, negatives included', () => {
    // A refund's amounts and quantities are negative; they still have to sum.
    expect(csvField('-32.00')).toBe('-32.00');
    expect(csvField(-3)).toBe('-3');
    expect(csvField('0.00')).toBe('0.00');
    expect(csvField('9.5')).toBe('9.5');
    expect(csvField('+1.5')).toBe('+1.5');
  });
});

describe('toCsv', () => {
  it('uses CRLF rows and a trailing newline', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
  });
});

describe('taxColumns', () => {
  it('collects each name+rate once, ordered', () => {
    const cols = taxColumns([
      { taxes: [{ name: 'Prepared food', rate: 9.5, tax: 1 }, { name: 'Sales tax', rate: 7.75, tax: 2 }] },
      { taxes: [{ name: 'Sales tax', rate: 7.75, tax: 3 }] },
      { taxes: [] },
    ]);
    expect(cols.map((c) => c.label)).toEqual(['Tax: Prepared food 9.5%', 'Tax: Sales tax 7.75%']);
  });
});

describe('receipts and line-items CSV', () => {
  let mock;
  let store;
  let sales;

  beforeEach(async () => {
    mock = installMockPuter();
    store = new Store();
    await store.init();
    const food = await store.addTax({ name: 'Prepared food', rate: 9.5 });
    const std = await store.addTax({ name: 'Sales tax', rate: 7.75 });
    const cat = await store.addCategory('Drinks, hot');
    const latte = await store.addProduct({
      name: 'Latte, "large"', price: 4.6, categoryId: cat.id, sku: 'DRK-LAT', taxId: food.id, slot: 1,
    });
    const mug = await store.addProduct({ name: 'Mug', price: 16, sku: 'MRCH-MUG', taxId: std.id, slot: 2 });
    const ghost = await store.addProduct({ name: 'Discontinued', price: 5, taxId: 'none', slot: 3 });

    const line = (p, qty, discount = null) => {
      const tax = store.taxFor(p);
      return {
        productId: p.id, name: p.name, unitPrice: p.price, qty,
        taxRate: tax?.rate || 0, taxName: tax?.name || '', discount,
      };
    };

    await store.completeSale({
      lines: [line(latte, 2), line(mug, 1, { type: 'percent', value: 10 })],
      orderDiscount: { type: 'fixed', value: 1 },
      payment: { method: 'cash', tendered: 40 },
      note: 'Regular,\ncorner table',
    });
    await store.completeSale({
      lines: [line(ghost, 1), { productId: null, name: 'Gift wrap', unitPrice: 2, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const voided = await store.completeSale({ lines: [line(mug, 1)], payment: { method: 'other' } });
    await store.voidSale(voided.id, voided.date);
    // The product is gone from the catalog but stays on its receipt.
    await store.deleteProduct(ghost.id);

    const today = todayISO();
    sales = await store.salesInRange(today, today);
  });

  afterEach(() => mock.uninstall());

  it('reconciles receipt rows with the reports revenue figure', () => {
    const rows = parseCsv(receiptsCsv(sales));
    expect(rows).toHaveLength(4);                 // header + 3 receipts
    const iTotal = col(rows, 'Total');
    const iStatus = col(rows, 'Status');
    const live = rows.slice(1).filter((r) => r[iStatus] === 'Completed');
    const csvRevenue = round2(live.reduce((a, r) => a + Number(r[iTotal]), 0));
    const reportRevenue = round2(sales.filter((s) => !s.voidedAt).reduce((a, s) => a + s.total, 0));
    expect(csvRevenue).toBe(reportRevenue);
    expect(rows.slice(1).filter((r) => r[iStatus] === 'Voided')).toHaveLength(1);
  });

  it('runs oldest first and carries a column per tax rate', () => {
    const rows = parseCsv(receiptsCsv(sales));
    const numbers = rows.slice(1).map((r) => Number(r[0]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(col(rows, 'Tax: Prepared food 9.5%')).toBeGreaterThan(-1);
    expect(col(rows, 'Tax: Sales tax 7.75%')).toBeGreaterThan(-1);

    // Each rate column agrees with the receipt's own breakdown.
    const first = sales.find((s) => s.number === 1001);
    const row = rows.slice(1).find((r) => Number(r[0]) === 1001);
    for (const t of first.taxes) {
      expect(Number(row[col(rows, `Tax: ${t.name} ${t.rate}%`)])).toBe(t.tax);
    }
    expect(Number(row[col(rows, 'Tax')])).toBe(first.taxTotal);
  });

  it('survives names and notes containing commas, quotes, and newlines', () => {
    const rows = parseCsv(receiptsCsv(sales));
    const note = rows.slice(1).find((r) => Number(r[0]) === 1001)[col(rows, 'Note')];
    expect(note).toBe('Regular,\ncorner table');

    const lineRows = parseCsv(lineItemsCsv(sales, store));
    const names = lineRows.slice(1).map((r) => r[col(lineRows, 'Product')]);
    expect(names).toContain('Latte, "large"');
    const latteRow = lineRows.slice(1).find((r) => r[col(lineRows, 'Product')] === 'Latte, "large"');
    expect(latteRow[col(lineRows, 'Category')]).toBe('Drinks, hot');
    expect(latteRow[col(lineRows, 'SKU')]).toBe('DRK-LAT');
  });

  it('line totals sum to their receipt total, cent-exact', () => {
    const rows = parseCsv(lineItemsCsv(sales, store));
    const iNum = col(rows, 'Receipt');
    const iTotal = col(rows, 'Line total');
    for (const sale of sales) {
      const mine = rows.slice(1).filter((r) => Number(r[iNum]) === sale.number);
      expect(mine).toHaveLength(sale.lines.length);
      const sum = round2(mine.reduce((a, r) => a + Number(r[iTotal]), 0));
      expect(sum).toBe(sale.total);
    }
  });

  it('falls back sensibly for deleted products and custom items', () => {
    const rows = parseCsv(lineItemsCsv(sales, store));
    const iCat = col(rows, 'Category');
    const iSku = col(rows, 'SKU');
    const byName = (n) => rows.slice(1).find((r) => r[col(rows, 'Product')] === n);
    expect(byName('Discontinued')[iCat]).toBe('—');
    expect(byName('Discontinued')[iSku]).toBe('');
    expect(byName('Gift wrap')[iCat]).toBe('Custom item');
    expect(byName('Mug')[iCat]).toBe('Uncategorized');
  });

  it('writes amounts as plain decimals with a currency column', () => {
    const rows = parseCsv(receiptsCsv(sales));
    for (const r of rows.slice(1)) {
      expect(r[col(rows, 'Total')]).toMatch(/^-?\d+\.\d\d$/);
      expect(r[col(rows, 'Currency')]).toBe('USD');
      expect(r[col(rows, 'Date')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r[col(rows, 'Time')]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
    expect(rows.slice(1).map((r) => r[col(rows, 'Payment')])).toEqual(['Cash', 'Card', 'Other']);
  });

  it('emits a header even when the range is empty', () => {
    expect(parseCsv(receiptsCsv([]))).toHaveLength(1);
    expect(parseCsv(lineItemsCsv([], store))).toHaveLength(1);
  });

  it('prefixes the blob with a BOM so Excel reads UTF-8', async () => {
    // Asserted on bytes: Blob.text() decodes UTF-8, which consumes the BOM.
    const bytes = new Uint8Array(await csvBlob('a,b\r\n').arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
  });

  it('names files by range', () => {
    expect(csvFilename('sales', '2026-08-01', '2026-08-31')).toBe('sales-2026-08-01_2026-08-31.csv');
  });
});
