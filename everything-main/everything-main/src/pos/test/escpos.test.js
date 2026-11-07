import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockStorage } from './helpers/mock-puter.js';
import {
  encodeCp437, wrap, printWidth, EscposBuilder, escposReceipt, escposReport, drawerKickBytes,
} from '../src/lib/escpos.js';
import { printerSupport, printerConfig, setPrinterConfig, testDoc } from '../src/lib/printer.js';

/**
 * The text a job would print, with the ESC/POS commands stripped.
 *
 * The commands have to be parsed rather than filtered by byte range: their
 * *parameters* are often printable ASCII ('a' selects alignment, 'E'
 * emphasis, 'd' a feed), and letting those through would count them as text
 * and make every width assertion here quietly wrong.
 */
function readable(bytes) {
  const a = [...bytes];
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    if (b === 0x1b) {
      const cmd = a[i + 1];
      if (cmd === 0x40) i += 1;             // ESC @
      else if (cmd === 0x70) i += 4;        // ESC p m t1 t2
      else i += 2;                          // ESC a|E|d n
      continue;
    }
    if (b === 0x1d) {
      i += a[i + 1] === 0x56 ? 3 : 2;       // GS V m n | GS ! n
      continue;
    }
    if (b === 0x0a) out.push('\n');
    else if (b >= 0x20 && b <= 0x7e) out.push(String.fromCharCode(b));
  }
  return out.join('');
}

const codes = (text) => [...text].map((c) => c.charCodeAt(0));

describe('encodeCp437', () => {
  it('writes plain ASCII straight through', () => {
    expect(encodeCp437('Latte $4.60')).toEqual(codes('Latte $4.60'));
  });

  it('maps the accents a shop name actually carries', () => {
    // "Caf" + e-acute: 0x82 in code page 437.
    expect(encodeCp437('Café')).toEqual([0x43, 0x61, 0x66, 0x82]);
    // Decomposed (e + combining acute) gives the same byte, not 'e?'.
    expect(encodeCp437('Café')).toEqual([0x43, 0x61, 0x66, 0x82]);
  });

  it('transliterates the app’s own typography', () => {
    // U+2212 is the minus this app writes; a printer has no byte for it.
    expect(encodeCp437('−7.01')).toEqual(codes('-7.01'));
    expect(encodeCp437('·')).toEqual([0xfa]);
    expect(encodeCp437('€5')).toEqual(codes('EUR5'));
    expect(encodeCp437('it’s')).toEqual(codes("it's"));
  });

  it('prints the yen/yuan sign with its own CP437 byte, not as JPY', () => {
    // CN¥ is how en-US formats yuan; spelling ¥ as 'JPY' named the wrong currency.
    expect(encodeCp437('CN¥12.50')).toEqual([...codes('CN'), 0x9d, ...codes('12.50')]);
    expect(printWidth('¥13')).toBe(3);
  });

  it('prints a question mark rather than a wrong glyph', () => {
    expect(encodeCp437('日')).toEqual([0x3f]);
  });
});

describe('printWidth', () => {
  it('counts columns, not characters', () => {
    expect(printWidth('Latte')).toBe(5);
    // Six characters, eight columns: the printer gets 'EUR24.68'.
    expect(printWidth('\u20ac24.68')).toBe(8);
    expect(printWidth('\u20a91,250')).toBe(8);
    // An accented letter has a byte of its own, so it is one column.
    expect(printWidth('Caf\u00e9')).toBe(4);
    // The app's own minus is one column; its ellipsis is three.
    expect(printWidth('\u22127.01')).toBe(5);
    expect(printWidth('more\u2026')).toBe(7);
  });
});

describe('wrap', () => {
  it('breaks on words, and breaks a word that can’t fit', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrap('aaaaaaaaaaaa', 5)).toEqual(['aaaaa', 'aaaaa', 'aa']);
  });

  it('always returns at least one row', () => {
    expect(wrap('', 10)).toEqual(['']);
  });

  it('wraps to the columns a row prints in, not its length', () => {
    // '\u20ac5' prints as 'EUR5', so 'ab \u20ac5' is seven columns and does not
    // fit a six-column line - by character count it looked like five.
    expect(wrap('ab \u20ac5', 6)).toEqual(['ab', '\u20ac5']);
    for (const row of wrap('Thank you\u2026 see you for \u20ac5 off', 20)) {
      expect(printWidth(row)).toBeLessThanOrEqual(20);
    }
  });
});

describe('EscposBuilder', () => {
  it('pads a label and an amount to the paper’s width', () => {
    const b = new EscposBuilder({ columns: 20 });
    b.columnsLine('Subtotal', '3.20');
    expect(readable(b.build())).toBe('Subtotal        3.20\n');
  });

  it('pads by printed columns, so a transliterated amount still fits', () => {
    // '\u20ac' has no byte in code page 437 and prints as 'EUR'. Padding the
    // line by character count made it 34 columns on 32-column paper, and the
    // printer wrapped '68' onto a row of its own.
    for (const columns of [32, 48]) {
      const b = new EscposBuilder({ columns });
      b.columnsLine('Total', '\u20ac24.68');
      b.columnsLine('Sales tax 7.75%', '\u20ac1.24');
      b.columnsLine('A product name long enough to need shortening', '\u20ac9.99');
      for (const line of readable(b.build()).split('\n').filter(Boolean)) {
        expect(line).toHaveLength(columns);
        expect(line.endsWith('.68') || line.endsWith('.24') || line.endsWith('.99')).toBe(true);
      }
    }
  });

  it('shortens the label, never the amount', () => {
    const b = new EscposBuilder({ columns: 16 });
    b.columnsLine('A very long product name', '124.00');
    const line = readable(b.build()).trim();
    expect(line).toHaveLength(16);
    expect(line.endsWith('124.00')).toBe(true);
    expect(line).toContain('~');
  });

  it('cuts with a feed first, so the slip clears the head', () => {
    const bytes = new EscposBuilder().cut().build();
    expect([...bytes]).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 66, 0]);
  });
});

describe('escposReceipt', () => {
  const doc = {
    storeName: 'Corner Roast Café',
    address: '12 Market Lane',
    registrations: ['VAT No. GB123'],
    kind: null,
    voided: false,
    meta: ['Receipt #1042', 'Thursday, August 20, 2026'],
    items: [{ qty: '2×', name: 'Espresso', amount: '$6.40', subs: [{ text: 'no ice', kind: 'note' }] }],
    totals: [{ label: 'Total', value: '$7.01', strong: true }],
    payments: [{ label: 'Cash', value: '$10.00' }, { label: 'Change', value: '$2.99' }],
    note: 'for Sam',
    reward: 'a free espresso',
    loyalty: '1 of 3 toward a free espresso',
    footer: 'Thanks, see you tomorrow',
  };

  it('prints everything the on-screen slip shows, in the same order', () => {
    const text = readable(escposReceipt(doc, { columns: 32 }));
    const at = (needle) => text.indexOf(needle);
    expect(at('Corner Roast')).toBeGreaterThan(-1);
    expect(at('12 Market Lane')).toBeGreaterThan(at('Corner Roast'));
    expect(at('VAT No. GB123')).toBeGreaterThan(at('12 Market Lane'));
    expect(at('Receipt #1042')).toBeGreaterThan(at('VAT No. GB123'));
    expect(at('Espresso')).toBeGreaterThan(at('Receipt #1042'));
    expect(at('no ice')).toBeGreaterThan(at('Espresso'));
    expect(at('Total')).toBeGreaterThan(at('no ice'));
    expect(at('Change')).toBeGreaterThan(at('Total'));
    expect(at('for Sam')).toBeGreaterThan(at('Change'));
    expect(at('1 of 3 toward')).toBeGreaterThan(at('for Sam'));
    expect(at('Thanks, see you tomorrow')).toBeGreaterThan(at('1 of 3 toward'));
    // The quantity leads the item line, as it does on screen.
    expect(text).toMatch(/2x Espresso\s+\$6\.40/);
  });

  it('marks a void and a refund so paper can’t pass for a sale', () => {
    expect(readable(escposReceipt({ ...doc, voided: true }, { columns: 32 }))).toContain('*** VOID ***');
    expect(readable(escposReceipt({ ...doc, kind: 'REFUND' }, { columns: 32 }))).toContain('*** REFUND ***');
  });

  it('holds every line to the paper’s width', () => {
    for (const columns of [32, 48]) {
      const lines = readable(escposReceipt(doc, { columns })).split('\n');
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(columns);
    }
  });

  it('wraps the double-width store name to half the paper', () => {
    // big() doubles the glyph width, so 32-column paper fits 16 characters
    // on the header line. Wrapped to 32, the printer broke it mid-word.
    const long = { ...doc, storeName: 'The Corner Roast Coffee House' };
    const narrow = readable(escposReceipt(long, { columns: 32 })).split('\n');
    expect(narrow[0]).toBe('The Corner Roast');
    expect(narrow[1]).toBe('Coffee House');
    // 80mm paper fits 24 of them, so the break falls a word later.
    const wide = readable(escposReceipt(long, { columns: 48 })).split('\n');
    expect(wide[0]).toBe('The Corner Roast Coffee');
    expect(wide[1]).toBe('House');
  });

  it('holds every line to the width for a shop selling in euros', () => {
    const euro = {
      ...doc,
      items: [{ qty: '2x', name: 'Espresso', amount: '\u20ac6.40', subs: [] }],
      totals: [
        { label: 'Subtotal', value: '\u20ac6.40' },
        { label: 'Total', value: '\u20ac7.01', strong: true },
      ],
      payments: [{ label: 'Cash', value: '\u20ac10.00' }, { label: 'Change', value: '\u20ac2.99' }],
      footer: 'Bedankt\u2026 tot morgen',
    };
    for (const columns of [32, 48]) {
      const lines = readable(escposReceipt(euro, { columns })).split('\n');
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(columns);
      // And the amounts arrive whole, not cut to make the line fit.
      expect(readable(escposReceipt(euro, { columns }))).toContain('EUR7.01');
    }
  });

  it('ends with the cut, and with the drawer pulse only when asked', () => {
    const plain = escposReceipt(doc, { columns: 32 });
    const kicked = escposReceipt(doc, { columns: 32, kick: true });
    expect([...plain.slice(-4)]).toEqual([0x1d, 0x56, 66, 0]);
    expect([...kicked.slice(-5)]).toEqual([...drawerKickBytes()]);
  });
});

describe('escposReport', () => {
  it('prints sections as headings and rows as columns', () => {
    const bytes = escposReport(
      { storeName: 'Shop', kind: 'Z-REPORT', meta: ['Aug 20'], footer: 'counted and closed' },
      [
        { section: 'Takings' },
        { label: 'Cash', value: '120.00' },
        { label: 'Expected', value: '140.00', strong: true },
      ],
      { columns: 32 },
    );
    const text = readable(bytes);
    expect(text).toContain('*** Z-REPORT ***');
    expect(text).toContain('TAKINGS');
    expect(text).toMatch(/Cash\s+120\.00/);
    expect(text).toContain('counted and closed');
  });
});

describe('drawerKickBytes', () => {
  it('is the standard pulse', () => {
    expect([...drawerKickBytes()]).toEqual([0x1b, 0x70, 0, 25, 250]);
  });
});

describe('the printer this device has', () => {
  let storage;

  beforeEach(() => { storage = installMockStorage(); });
  afterEach(() => storage.uninstall());

  it('reports no support in an environment with none, without throwing', () => {
    const support = printerSupport();
    expect(support.any).toBe(false);
    expect(support.bluetooth).toBe(false);
  });

  it('remembers a choice on this device, and forgets it', () => {
    expect(printerConfig()).toBeNull();
    setPrinterConfig({
      transport: 'serial', name: 'Till printer', columns: 32, autoPrint: true, kickOnCash: true,
    });
    expect(printerConfig()).toEqual({
      transport: 'serial', name: 'Till printer', columns: 32, autoPrint: true, kickOnCash: true,
    });
    setPrinterConfig(null);
    expect(printerConfig()).toBeNull();
  });

  it('refuses a stored value it doesn’t recognize', () => {
    localStorage.setItem('pos:printer:v1', JSON.stringify({ transport: 'telepathy' }));
    expect(printerConfig()).toBeNull();
    localStorage.setItem('pos:printer:v1', 'not json');
    expect(printerConfig()).toBeNull();
  });

  it('falls back to 80mm when the width is nonsense', () => {
    setPrinterConfig({ transport: 'usb', name: 'x', columns: 999 });
    expect(printerConfig().columns).toBe(48);
  });

  it('has a test print that proves the width', () => {
    const text = readable(escposReceipt(testDoc('Corner Roast', 32), { columns: 32 }));
    expect(text).toContain('*** TEST PRINT ***');
    expect(text).toContain('32 characters per line');
    // The footer is longer than 58mm paper, so it wraps - which is the point.
    expect(text).toContain('Test print');
    expect(text).toContain('recorded');
  });
});
