/**
 * Importing a catalog from a spreadsheet, and exporting one back out.
 *
 * A shop's first day is spent typing its catalog into a form, one product at
 * a time - which is where a trial ends. This reads whatever file a shop has in
 * hand: its own export, Square's, Loyverse's, a paper price list somebody
 * typed up. No competitor shares a header format, so the header row is only
 * *guessed* at; every column can be pointed at by hand.
 *
 * Nothing is written until a preview has said exactly what will happen. The
 * plan is pure - the store applies it - so what the preview counted and what
 * lands are the same thing by construction.
 *
 * Matching, in order: the id this app's own export carries, then SKU, then
 * name. That makes a re-import an update rather than a second copy of the
 * catalog, which is what turns a supplier's 4% rise into a spreadsheet edit.
 */

import { parseAmount, parseRate } from './money.js';
import { toCsv } from './csv.js';

/** Beyond this a file is not a catalog; a real one is orders of magnitude smaller. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
/** Rows read from one file. Products live in a single hot kv entry. */
export const MAX_IMPORT_ROWS = 5000;

/** A rejection with a message meant for the shopkeeper, not the console. */
export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * The delimiter a file actually uses. Excel writes ';' wherever the decimal
 * separator is a comma, and 'Name;Price' read as one column would look to the
 * shopkeeper like the app simply couldn't read their file. Counted outside
 * quotes, on the header line, so a name containing a comma can't vote.
 */
export function sniffDelimiter(text) {
  const line = String(text).split(/\r?\n/, 1)[0] || '';
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/**
 * RFC-4180 rows out of CSV text: quoted fields, doubled quotes inside them,
 * CRLF or LF, and a BOM stripped. Blank lines are dropped - a spreadsheet
 * export usually ends in one, and it is not a product.
 */
export function parseCsv(text, delimiter = ',') {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // A row of nothing but empty cells carries no product.
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
    if (ch === delimiter) { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/**
 * The fields an import can fill, in the order the mapper offers them. `key`
 * is what a plan row carries; `aliases` are the header names seen in the wild
 * (Square, Loyverse, Shopify, and the obvious hand-typed ones), matched
 * loosely - case, spaces, and punctuation are ignored.
 */
export const IMPORT_FIELDS = [
  {
    key: 'name', label: 'Name', required: true,
    hint: 'Required. A row without one is skipped.',
    aliases: ['name', 'productname', 'itemname', 'item', 'product', 'title', 'description', 'variantname'],
  },
  {
    key: 'price', label: 'Price', required: true,
    hint: 'Required. What the customer pays.',
    aliases: ['price', 'unitprice', 'saleprice', 'retailprice', 'amount', 'sellprice', 'priceusd'],
  },
  {
    key: 'cost', label: 'Cost',
    hint: 'What you pay. Optional; drives profit and margin.',
    aliases: ['cost', 'unitcost', 'costprice', 'purchaseprice', 'wholesale', 'wholesaleprice', 'buyprice'],
  },
  {
    key: 'sku', label: 'SKU / barcode',
    hint: 'How a re-import knows this is the same product.',
    aliases: ['sku', 'barcode', 'code', 'upc', 'ean', 'gtin', 'itemcode', 'productcode', 'reference', 'ref'],
  },
  {
    key: 'category', label: 'Category',
    hint: 'Categories not in your list are created.',
    aliases: ['category', 'categoryname', 'group', 'department', 'type', 'section'],
  },
  {
    key: 'tax', label: 'Tax',
    hint: 'Matched by the name of one of your rates.',
    aliases: ['tax', 'taxname', 'taxrate', 'vat', 'gst', 'taxclass'],
  },
  {
    key: 'stock', label: 'Stock on hand',
    hint: 'A number here turns on stock tracking.',
    aliases: ['stock', 'stockonhand', 'quantity', 'qty', 'onhand', 'inventory', 'currentquantity', 'newquantity'],
  },
  {
    key: 'lowStock', label: 'Low-stock alert at',
    hint: 'Optional threshold for the reorder list.',
    aliases: ['lowstock', 'lowstockalert', 'reorderpoint', 'reorderlevel', 'alertat', 'minimumstock', 'min'],
  },
  {
    key: 'unit', label: 'Unit of measure',
    hint: 'A unit (kg, L) makes the product sold by measure.',
    aliases: ['unit', 'unitofmeasure', 'uom', 'measure', 'soldby'],
  },
  {
    key: 'id', label: 'Product id',
    hint: 'Only in this app’s own export. Matched first.',
    aliases: ['id', 'productid', 'posid'],
  },
];

/** Header text reduced to what can be compared across spreadsheets. */
const normalizeHeader = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Guess which column is which from the header row. Returns { [field]: index },
 * with only the columns it is confident about - an alias match, or a header
 * that merely contains the alias where nothing better claimed it.
 */
export function guessMapping(header) {
  const cells = (header || []).map(normalizeHeader);
  const taken = new Set();
  const out = {};
  // Exact alias matches first, so 'Price' wins over 'Price includes tax'.
  for (const pass of ['exact', 'loose']) {
    for (const field of IMPORT_FIELDS) {
      if (out[field.key] !== undefined) continue;
      for (let i = 0; i < cells.length; i++) {
        if (taken.has(i) || !cells[i]) continue;
        const hit = pass === 'exact'
          ? field.aliases.includes(cells[i])
          : field.aliases.some((a) => a.length >= 3 && cells[i].includes(a));
        if (!hit) continue;
        out[field.key] = i;
        taken.add(i);
        break;
      }
    }
  }
  return out;
}

/**
 * No header row to read the columns off: guess from the shape of the data
 * instead. The first column that is mostly words is the name; the first that
 * is mostly money is the price. Enough to spare the shopkeeper two selects on
 * a bare two-column list, and never enough to guess at anything subtler.
 */
export function guessFromRows(rows) {
  const sample = (rows || []).slice(0, 20);
  if (!sample.length) return {};
  const width = sample.reduce((a, r) => Math.max(a, r.length), 0);
  const score = [];
  for (let i = 0; i < width; i++) {
    let filled = 0;
    let numeric = 0;
    for (const row of sample) {
      const cell = String(row[i] ?? '').trim();
      if (!cell) continue;
      filled++;
      if (parseAmount(cell) !== null) numeric++;
    }
    score.push({ i, filled, numeric });
  }
  const out = {};
  const words = score.find((c) => c.filled && c.numeric / c.filled < 0.3);
  if (words) out.name = words.i;
  const money = score.find((c) => c.i !== out.name && c.filled && c.numeric / c.filled > 0.7);
  if (money) out.price = money.i;
  return out;
}

/** True when a header row looks like headings rather than a first product. */
export function looksLikeHeader(row) {
  const guessed = guessMapping(row);
  // A header names at least one field and holds no money in the price cell.
  if (guessed.name === undefined && guessed.price === undefined) return false;
  const priceCell = guessed.price !== undefined ? row[guessed.price] : null;
  return priceCell === null || parseAmount(priceCell) === null;
}

/** Values a tax cell can use to mean "this product is tax-free". */
const TAX_FREE = ['none', 'no', 'no tax', 'notax', 'tax-free', 'taxfree', 'exempt', 'zero', 'zero-rated', '0', '0%'];

/** A stock/threshold cell: a plain number, or null when the cell says nothing. */
function parseCount(text) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;   // typed, but not a number - a skip reason
  return Math.round(n * 1000) / 1000;
}

/**
 * planImport(rows, mapping, catalog) - what an import would do, before it does
 * anything. `rows` are data rows (no header); `catalog` is
 * { products, categories, taxes }.
 *
 * Every row lands in exactly one of creates / updates / skipped, so the
 * preview's counts always add up to the file.
 */
export function planImport(rows, mapping, { products = [], categories = [], taxes = [] } = {}, { firstRow = 2 } = {}) {
  const creates = [];
  const updates = [];
  const skipped = [];
  /** Categories the file names that don't exist yet, in first-seen order. */
  const newCategories = [];
  const unknownTaxes = [];

  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map();
  for (const p of products) {
    const key = String(p.sku || '').trim().toLowerCase();
    // First one wins: a duplicated SKU in the catalog is already ambiguous,
    // and the import must not silently pick a different product each run.
    if (key && !bySku.has(key)) bySku.set(key, p);
  }
  const byName = new Map();
  for (const p of products) {
    const key = String(p.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, p);
  }
  const catByName = new Map(categories.map((c) => [String(c.name).trim().toLowerCase(), c]));
  const taxByName = new Map(taxes.map((t) => [String(t.name).trim().toLowerCase(), t]));
  const taxByRate = new Map(taxes.map((t) => [Number(t.rate), t]));

  /** Products this file has already claimed, so two rows can't fight over one. */
  const claimed = new Set();
  const cell = (row, key) => (mapping[key] === undefined ? undefined : String(row[mapping[key]] ?? '').trim());

  rows.forEach((row, index) => {
    const rowNumber = firstRow + index;
    const name = cell(row, 'name');
    const priceText = cell(row, 'price');
    if (!name) {
      skipped.push({ rowNumber, name: '', reason: 'no name' });
      return;
    }
    const price = parseAmount(priceText);
    if (!priceText) {
      skipped.push({ rowNumber, name, reason: 'no price' });
      return;
    }
    if (price === null) {
      skipped.push({ rowNumber, name, reason: `price “${priceText}” isn’t a number` });
      return;
    }

    /* ---- which product, if any, this row is ---- */
    const id = cell(row, 'id');
    const sku = cell(row, 'sku');
    let existing = null;
    let matchedBy = null;
    if (id && byId.has(id)) { existing = byId.get(id); matchedBy = 'id'; }
    if (!existing && sku && bySku.has(sku.toLowerCase())) {
      existing = bySku.get(sku.toLowerCase());
      matchedBy = 'sku';
    }
    if (!existing && !sku && byName.has(name.toLowerCase())) {
      existing = byName.get(name.toLowerCase());
      matchedBy = 'name';
    }
    if (existing && claimed.has(existing.id)) {
      skipped.push({ rowNumber, name, reason: 'a row above already updates this product' });
      return;
    }

    /* ---- the fields this file actually carries ---- */
    const patch = { name, price };

    if (mapping.cost !== undefined) {
      const costText = cell(row, 'cost');
      if (costText) {
        const cost = parseAmount(costText);
        if (cost === null) {
          skipped.push({ rowNumber, name, reason: `cost “${costText}” isn’t a number` });
          return;
        }
        patch.cost = cost;
      } else if (!existing) {
        patch.cost = null;
      }
    }
    if (mapping.sku !== undefined && (sku || !existing)) patch.sku = sku;

    if (mapping.category !== undefined) {
      const catName = cell(row, 'category');
      if (catName) {
        const found = catByName.get(catName.toLowerCase());
        if (found) {
          patch.categoryId = found.id;
        } else {
          // Created on apply, once, under the spelling the file first used.
          if (!newCategories.some((n) => n.toLowerCase() === catName.toLowerCase())) {
            newCategories.push(catName);
          }
          patch.categoryName = catName;
        }
      }
    }

    if (mapping.tax !== undefined) {
      const taxText = cell(row, 'tax');
      if (taxText) {
        const lower = taxText.toLowerCase();
        const asRate = parseRate(taxText.replace('%', ''));
        if (TAX_FREE.includes(lower)) {
          patch.taxId = 'none';
        } else if (taxByName.has(lower)) {
          patch.taxId = taxByName.get(lower).id;
        } else if (asRate !== null && taxByRate.has(asRate)) {
          patch.taxId = taxByRate.get(asRate).id;
        } else if (!unknownTaxes.some((t) => t.toLowerCase() === lower)) {
          // Never silently defaulted in silence: the preview names it, and
          // the product falls back to the store's default rate.
          unknownTaxes.push(taxText);
        }
      }
    }

    if (mapping.unit !== undefined) {
      const unit = cell(row, 'unit');
      if (unit && !/^(each|ea|unit|piece|pcs|item)$/i.test(unit)) {
        patch.soldBy = 'measure';
        patch.unit = unit;
      } else if (unit) {
        patch.soldBy = 'each';
      }
    }

    if (mapping.stock !== undefined) {
      const stock = parseCount(cell(row, 'stock'));
      if (Number.isNaN(stock)) {
        skipped.push({ rowNumber, name, reason: `stock “${cell(row, 'stock')}” isn’t a number` });
        return;
      }
      if (stock !== null) {
        patch.trackStock = true;
        patch.stock = stock;
      }
    }
    if (mapping.lowStock !== undefined) {
      const low = parseCount(cell(row, 'lowStock'));
      if (low !== null && !Number.isNaN(low) && low >= 0) patch.lowStock = low;
    }

    if (existing) {
      claimed.add(existing.id);
      updates.push({ id: existing.id, before: existing, patch, matchedBy, rowNumber });
    } else {
      creates.push({ patch, rowNumber });
    }
  });

  return { creates, updates, skipped, newCategories, unknownTaxes };
}

/** 'matched by SKU' / 'matched by name' - how the preview explains an update. */
export function matchLabel(matchedBy) {
  if (matchedBy === 'sku') return 'matched by SKU';
  if (matchedBy === 'id') return 'matched by product id';
  return 'matched by name';
}

/**
 * The catalog as CSV: a shop's own list, round-trippable, and the template the
 * import reads. The id column is what makes a round trip exact - a product
 * with no SKU still matches itself on the way back in.
 */
export function catalogCsv(products, catalog = null) {
  const rows = [[
    'Id', 'Name', 'Price', 'Cost', 'SKU', 'Category', 'Tax', 'Unit',
    'Stock on hand', 'Low-stock alert at',
  ]];
  const amount = (n) => (Number(n) || 0).toFixed(2);
  const sorted = [...products].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const p of sorted) {
    const category = p.categoryId && catalog ? catalog.category(p.categoryId)?.name || '' : '';
    let tax = '';
    if (p.taxId === 'none') tax = 'None';
    else if (p.taxId && catalog) tax = catalog.tax(p.taxId)?.name || '';
    rows.push([
      p.id,
      p.name,
      amount(p.price),
      // Empty, not zero: an uncosted product must come back uncosted.
      p.cost === null || p.cost === undefined ? '' : amount(p.cost),
      p.sku || '',
      category,
      tax,
      p.soldBy === 'measure' ? p.unit || '' : '',
      p.stock === null || p.stock === undefined ? '' : String(p.stock),
      p.lowStock === null || p.lowStock === undefined ? '' : String(p.lowStock),
    ]);
  }
  return toCsv(rows);
}

/**
 * Read a picked file into rows. Rejects with an ImportError carrying something
 * the shopkeeper can act on - a spreadsheet saved as .xlsx is the single most
 * likely mistake, and "couldn't read that file" would not explain it.
 */
export async function readCatalogFile(file) {
  if (!file) throw new ImportError('No file chosen.');
  if (!file.size) throw new ImportError('That file is empty.');
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError('That file is far too large to be a product list.');
  }
  const text = await file.text();
  // ZIP magic: every .xlsx / .ods is a zip archive, and its bytes are not CSV.
  if (text.startsWith('PK') || /\.(xlsx|xls|ods|numbers)$/i.test(file.name || '')) {
    throw new ImportError('That’s a spreadsheet file. In your spreadsheet app choose “Save as” or “Export” and pick CSV, then try again.');
  }
  const delimiter = sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (!rows.length) throw new ImportError('That file has no rows in it.');
  const truncated = rows.length > MAX_IMPORT_ROWS + 1;
  return {
    rows: truncated ? rows.slice(0, MAX_IMPORT_ROWS + 1) : rows,
    delimiter,
    truncated,
  };
}
