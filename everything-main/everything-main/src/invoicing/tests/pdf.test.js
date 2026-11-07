import { describe, it, expect } from 'vitest';
import { renderPdf, pdfFilename, winAnsi, textWidth, wrapText } from '../src/lib/pdf.js';
import { docSpec, receiptSpec, statementSpec, pdfMoney, pdfDate } from '../src/lib/pdf-spec.js';

const settings = {
  business: { name: 'Aurora Studio', email: 'hi@aurora.example', address: '412 Fremont Ave\nPortland, OR', taxId: '' },
  taxLabel: 'Tax',
  brandColor: '#1f6f5c',
  defaultNotes: '',
};

const client = {
  id: 'c1', name: 'Maya Chen', company: 'Northwind Labs',
  email: 'maya@northwind.example', address: '88 Pier Street\nSeattle, WA',
};

const invoice = (over = {}) => ({
  kind: 'invoice',
  number: 'INV-0042',
  clientId: 'c1',
  currency: 'USD',
  issueDate: '2026-07-20',
  dueDate: '2026-08-20',
  items: [{ id: 'l1', name: 'Brand design (day)', qty: 4, rate: 800 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  notes: 'Thank you for your business.',
  status: 'sent',
  payments: [],
  ...over,
});

const text = (bytes) => {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
};

/** Every offset in the xref table must point at the object it claims. */
function checkStructure(bytes) {
  const file = text(bytes);
  expect(file.startsWith('%PDF-1.4')).toBe(true);
  expect(file.trimEnd().endsWith('%%EOF')).toBe(true);

  const startxref = Number(file.slice(file.lastIndexOf('startxref') + 9).trim().split(/\s/)[0]);
  expect(file.slice(startxref, startxref + 4)).toBe('xref');
  const table = file.slice(startxref).split('\n');
  const count = Number(table[1].split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(table[i + 2].slice(0, 10));
    expect(file.slice(offset, offset + String(i).length + 6)).toBe(`${i} 0 obj`);
  }
  return { file, count };
}

const pageCount = (file) => (file.match(/\/Type \/Page[^s]/g) || []).length;

describe('winAnsi', () => {
  it('keeps Latin-1 and folds the punctuation those fonts do have', () => {
    expect(winAnsi('Café · Zoë')).toBe('Café · Zoë');
    expect(winAnsi('a – b — c')).toBe('a \x96 b \x97 c');
    expect(winAnsi('“quoted” ’tis…')).toBe('\x93quoted\x94 \x92tis\x85');
    expect(winAnsi('€1,000')).toBe('\x801,000');
  });

  it('folds the grouping spaces and minus that money formatting emits', () => {
    // fr-FR groups digits with U+202F; fi/sv/nb negate with U+2212.
    expect(winAnsi('1\u202F234,50')).toBe('1\xa0234,50');
    expect(winAnsi('1\u2009234')).toBe('1\xa0234');
    expect(winAnsi('\u2212800,00')).toBe('-800,00');
    expect(winAnsi('\u200f1,234.50\u00a0USD')).toBe('1,234.50\xa0USD');
  });

  it('replaces what no built-in font can draw', () => {
    expect(winAnsi('東京 Studio')).toBe('?? Studio');
    expect(winAnsi('₹500')).toBe('?500');
  });

  it('drops control characters and normalizes tabs', () => {
    expect(winAnsi('a\tbc')).toBe('a bc');
    expect(winAnsi(null)).toBe('');
  });
});

describe('textWidth and wrapText', () => {
  it('measures Helvetica in points', () => {
    // 'I' is 278/1000 em, so five of them at 10pt is 13.9pt.
    expect(textWidth('IIIII', 10)).toBeCloseTo(13.9, 5);
    expect(textWidth('MMM', 10, true)).toBeGreaterThan(textWidth('III', 10, true));
  });

  it('wraps on words and never returns nothing', () => {
    const lines = wrapText('Brand design and identity work for the launch', 9, false, 80);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9)).toBeLessThanOrEqual(80);
    expect(wrapText('', 9, false, 80)).toEqual(['']);
  });

  it('breaks a single word that cannot fit', () => {
    const lines = wrapText('Unbreakablesupercalifragilistic', 9, false, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9)).toBeLessThanOrEqual(40);
  });

  it('breaks a multi-kilobyte unbroken run without freezing the tab', () => {
    const run = 'x'.repeat(12000);
    const lines = wrapText(run, 9, false, 200);
    expect(lines.length).toBeGreaterThan(200);
    for (const line of lines) expect(textWidth(line, 9)).toBeLessThanOrEqual(200);
    expect(lines.join('')).toBe(run);   // every character still lands somewhere
  });
});

describe('pdfFilename', () => {
  it('names the file after the document', () => {
    expect(pdfFilename({ filename: 'INV-0042' })).toBe('INV-0042.pdf');
    expect(pdfFilename({ number: 'RCT-0007' })).toBe('RCT-0007.pdf');
  });

  it('never lets a name escape into a path', () => {
    expect(pdfFilename({ filename: '../../etc/passwd' })).toBe('etc-passwd.pdf');
    expect(pdfFilename({ filename: 'statement-Harbor & Finch' })).toBe('statement-Harbor-Finch.pdf');
    expect(pdfFilename({})).toBe('document.pdf');
  });
});

describe('renderPdf', () => {
  it('writes a structurally valid single-page PDF', async () => {
    const bytes = await renderPdf(docSpec(invoice(), client, settings, { today: '2026-08-04' }));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBe(1);
    expect(file).toContain('/BaseFont /Helvetica');
    expect(file).toContain('/BaseFont /Helvetica-Bold');
    expect(file).toContain('(INV-0042)');
    expect(file).toContain('(Brand design \\(day\\))');   // parentheses escaped
    expect(file).toContain('(Aurora Studio)');
  });

  it('never lets a tracked label bleed letter-spacing into later text', async () => {
    const bytes = await renderPdf(docSpec(invoice(), client, settings, { today: '2026-08-04' }));
    const file = text(bytes);
    const ops = file.match(/BT .*? ET/g) || [];
    expect(ops.length).toBeGreaterThan(10);
    // Tc is graphics state and survives BT/ET, so walk the stream carrying
    // it forward: any op that draws text without setting its own spacing
    // inherits whatever a label left behind — which its width math (always
    // tracking 0 for body text) never accounted for.
    let spacing = 0;
    for (const op of ops) {
      const tc = op.match(/(-?[\d.]+) Tc/);
      if (tc) spacing = Number(tc[1]);
      else if (op.includes(' Tj')) expect(spacing).toBe(0);
      if (op.includes('(INV-0042)')) expect(spacing).toBe(0);
    }
    // The walk exercised real tracking: the INVOICE title is letter-spaced.
    expect(file).toMatch(/[1-9][\d.]* Tc/);
  });

  it('paginates a long document and keeps the totals with it', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `l${i}`, name: `Line item number ${i + 1} with a fairly long description to wrap`, qty: 2, rate: 125,
    }));
    const bytes = await renderPdf(docSpec(invoice({ items }), client, settings, { today: '2026-08-04' }));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    // Column headers repeat on every page carrying rows, and the totals block
    // is written once — on its own page if that is what it takes to stay whole.
    const heads = (file.match(/\(DESCRIPTION\)/g) || []).length;
    expect(heads).toBeGreaterThan(1);
    expect(heads).toBeLessThanOrEqual(pageCount(file));
    expect((file.match(/\(Total\)/g) || []).length).toBe(1);
    expect((file.match(/\(Balance due\)/g) || []).length).toBe(0);
    expect(file).toContain('(Page 1 of ');
  });

  it('wraps a notes block taller than a page instead of drawing past the bottom', async () => {
    const notes = Array.from({ length: 120 }, (_, i) => `Clause ${i + 1} of the engagement terms.`).join('\n');
    const bytes = await renderPdf(docSpec(invoice({ notes }), client, settings, {}));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    // Every text op sits inside the page: below-the-edge text has negative y.
    const ys = [...file.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    // The tail of the notes actually made it onto some page.
    expect(file).toContain('(Clause 120 of the engagement terms.)');
    expect((file.match(/\(Total\)/g) || []).length).toBe(1);
  });

  it('slices a single row taller than a page across pages', async () => {
    const name = Array.from({ length: 800 }, (_, i) => `word${i + 1}`).join(' ');
    const bytes = await renderPdf(docSpec(invoice({
      items: [{ id: 'l1', name, qty: 1, rate: 100 }],
    }), client, settings, {}));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    const ys = [...file.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    // The description's tail is drawn, and the table header repeats with it.
    expect(file).toContain('word800');
    const heads = (file.match(/\(DESCRIPTION\)/g) || []).length;
    expect(heads).toBeGreaterThan(1);
    expect(heads).toBeLessThanOrEqual(pageCount(file));
  });

  it('wraps a long right-aligned cell inside its own column', async () => {
    const qty = Array.from({ length: 12 }, (_, i) => `qword${i + 1}`).join(' ');
    const bytes = await renderPdf(docSpec(invoice({
      items: [{ id: 'l1', name: 'Design', qty, rate: 100 }],
    }), client, settings, {}));
    const { file } = checkStructure(bytes);
    const ops = [...file.matchAll(/1 0 0 1 ([\d.-]+) [\d.-]+ Tm \((.*?)\) Tj/g)];
    const qtyOps = ops.filter((m) => m[2].includes('qword'));
    expect(qtyOps.length).toBeGreaterThan(1);
    // The qty column begins at 48% of the content width; none of the
    // quantity may be drawn leftward into the description column.
    for (const m of qtyOps) expect(Number(m[1])).toBeGreaterThan(287);
  });

  it('breaks addresses longer than a page instead of drawing past the bottom', async () => {
    const address = Array.from({ length: 120 }, (_, i) => `Address line ${i + 1}`).join('\n');
    const bytes = await renderPdf(docSpec(invoice(), { ...client, address },
      { ...settings, business: { ...settings.business, address } }, {}));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    const ys = [...file.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    // Both columns' tails made it onto some page, and the paper still ends
    // in exactly one totals block.
    expect((file.match(/\(Address line 120\)/g) || []).length).toBe(2);
    expect((file.match(/\(Total\)/g) || []).length).toBe(1);
  });

  it('wraps and breaks a long receipt note instead of drawing off the page', async () => {
    const note = [Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(' '),
      ...Array.from({ length: 90 }, (_, i) => `Note line ${i + 1}`)].join('\n');
    const payment = { id: 'p1', number: 'RCT-0007', date: '2026-08-01', amount: 1200, method: 'Card', note };
    const bytes = await renderPdf(receiptSpec(payment, invoice({ payments: [payment] }), client, settings));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    // No op may land past the bottom (negative y) or, for the right-aligned
    // sub-lines, start left of the page edge (negative x).
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...coords.map((c) => c[0]))).toBeGreaterThanOrEqual(0);
    expect(file).toContain('(Note line 90)');
    expect(file).toContain('word60');
  });

  it('breaks a totals list longer than a page', async () => {
    const taxes = Array.from({ length: 60 }, (_, i) => ({ label: `Levy ${i + 1}`, rate: 1 }));
    const bytes = await renderPdf(docSpec(invoice({ taxes }), client, settings, {}));
    const { file } = checkStructure(bytes);
    expect(pageCount(file)).toBeGreaterThan(1);
    const ys = [...file.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(file).toContain('Levy 60');
    expect((file.match(/\(Total\)/g) || []).length).toBe(1);
  });

  it('renders a receipt and a statement too', async () => {
    const payment = { id: 'p1', number: 'RCT-0007', date: '2026-08-01', amount: 1200, method: 'Card', note: '' };
    const receipt = await renderPdf(receiptSpec(payment, invoice({ payments: [payment] }), client, settings));
    expect(text(receipt)).toContain('(RECEIPT)');
    expect(text(receipt)).toContain('(AMOUNT RECEIVED)');

    const statement = await renderPdf(statementSpec(client, [invoice()], settings, { today: '2026-08-04' }));
    expect(text(statement)).toContain('(STATEMENT)');
    expect(text(statement)).toContain('(Total due)');
  });

  it('renders a refund receipt as a refund', async () => {
    const refund = { id: 'p2', number: 'RCT-0008', date: '2026-08-02', amount: -300, method: 'Card', note: '' };
    const bytes = await renderPdf(receiptSpec(refund, invoice({ payments: [{ amount: 1200 }, refund] }), client, settings));
    const file = text(bytes);
    expect(file).toContain('(REFUND RECEIPT)');
    expect(file).toContain('(AMOUNT REFUNDED)');
    expect(file).not.toContain('(-$300.00)');      // shown as a positive amount refunded
  });

  it('survives a document with nothing on it', async () => {
    const bare = {
      kind: 'invoice', number: 'INV-0001', currency: 'USD', issueDate: '2026-08-04',
      items: [], taxRate: 0, discountType: 'none', discountValue: 0, payments: [], status: 'draft',
    };
    const bytes = await renderPdf(docSpec(bare, null, { business: {} }, {}));
    checkStructure(bytes);
    expect(text(bytes)).toContain('(No line items)');
    expect(text(bytes)).toContain('(No client on file)');
  });

  it('draws A4 pages unless the spec names US Letter', async () => {
    const a4 = await renderPdf(docSpec(invoice(), client, settings, {}));
    expect(text(a4)).toContain('/MediaBox [0 0 595.28 841.89]');

    const letter = await renderPdf(docSpec(invoice(), client, { ...settings, paperSize: 'letter' }, {}));
    const file = text(letter);
    expect(file).toContain('/MediaBox [0 0 612 792]');
    expect(file).not.toContain('841.89');
    checkStructure(letter);
  });

  it('paginates against the Letter page height, not A4', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `l${i}`, name: `Line ${i + 1}`, qty: 1, rate: 100,
    }));
    const a4Pages = pageCount(text(await renderPdf(
      docSpec(invoice({ items }), client, settings, {}))));
    const letterPages = pageCount(text(await renderPdf(
      docSpec(invoice({ items }), client, { ...settings, paperSize: 'letter' }, {}))));
    // Letter is shorter than A4, so the same document needs at least as many pages.
    expect(letterPages).toBeGreaterThanOrEqual(a4Pages);
  });

  it('ignores a logo it cannot decode rather than failing', async () => {
    const spec = { ...docSpec(invoice(), client, settings, {}), logo: 'data:image/png;base64,notreallyanimage' };
    const bytes = await renderPdf(spec);
    checkStructure(bytes);
    expect(text(bytes)).not.toContain('/DCTDecode');
  });
});

describe('docSpec', () => {
  it("speaks the document's language, and carries the page wording for the writer", () => {
    const spec = docSpec(invoice({ language: 'fr' }), client, settings, { today: '2026-09-01' });
    expect(spec.kind).toBe('Facture');
    expect(spec.party.label).toBe('Facturé à');
    expect(spec.totals[0].label).toBe('Sous-total');
    expect(spec.stamp.label).toBe('En retard');
    expect(spec.pageOf).toBe('Page {n} sur {m}');
    // Untouched documents render exactly as before.
    expect(docSpec(invoice(), client, settings, {}).kind).toBe('Invoice');
  });

  it("statements follow the client's language", () => {
    const spec = statementSpec({ ...client, language: 'de' }, [invoice()], settings, { today: '2026-08-04' });
    expect(spec.kind).toBe('Kontoauszug');
    expect(spec.totals[0].label).toBe('Gesamt fällig');
  });

  it('names the paper size from settings, defaulting to A4', () => {
    expect(docSpec(invoice(), client, settings, {}).paper).toBe('a4');
    expect(docSpec(invoice(), client, { ...settings, paperSize: 'letter' }, {}).paper).toBe('letter');
    expect(docSpec(invoice(), client, { ...settings, paperSize: 'legal' }, {}).paper).toBe('a4');
  });

  it('carries the branding, the stamp, and the paid rows', () => {
    const paid = invoice({ payments: [{ amount: 3200 }] });
    const spec = docSpec(paid, client, settings, { today: '2026-08-04' });
    expect(spec.brand).toBe('#1f6f5c');
    expect(spec.kind).toBe('Invoice');
    expect(spec.stamp).toEqual({ label: 'Paid', color: '#0d7a3f' });
    expect(spec.totals.map((r) => r.label)).toEqual(['Subtotal', 'Total', 'Paid', 'Balance due']);
    expect(spec.party.label).toBe('Billed to');
  });

  it('leaves the stamp off a document with no status to show', () => {
    expect(docSpec(invoice(), client, settings, { today: '2026-08-04' }).stamp).toBe(null);
    expect(docSpec(invoice(), client, settings, {}).stamp).toBe(null);
  });

  it('stamps what the document says about itself without a date, but never the clock', () => {
    // The share page's call shape: no `today`. Void and paid are the document's
    // own state and print; overdue would need a date and does not.
    expect(docSpec(invoice({ status: 'void' }), client, settings, {}).stamp.label).toBe('Void');
    expect(docSpec(invoice({ payments: [{ amount: 3200 }] }), client, settings, {}).stamp.label).toBe('Paid');
    expect(docSpec(invoice({ dueDate: '2020-01-01' }), client, settings, {}).stamp).toBe(null);
    expect(docSpec(invoice({ dueDate: '2020-01-01' }), client, settings, { today: '2026-08-04' }).stamp.label).toBe('Overdue');
    const quote = { ...invoice(), kind: 'quote', validUntil: '2020-01-01' };
    expect(docSpec({ ...quote, status: 'declined' }, client, settings, {}).stamp.label).toBe('Declined');
    expect(docSpec(quote, client, settings, {}).stamp).toBe(null);
  });

  it('keeps a pay link only while money is owed', () => {
    const link = 'https://paypal.me/aurora/3200.00USD';
    expect(docSpec(invoice(), client, settings, { payLink: link }).payLink).toBe(link);
    expect(docSpec(invoice({ payments: [{ amount: 3200 }] }), client, settings, { payLink: link }).payLink).toBe(null);
  });

  it('labels an estimate as an estimate', () => {
    const quote = { ...invoice(), kind: 'quote', number: 'EST-0002', validUntil: '2026-09-01' };
    const spec = docSpec(quote, client, settings, { today: '2026-08-04' });
    expect(spec.kind).toBe('Estimate');
    expect(spec.party.label).toBe('Prepared for');
    expect(spec.dates[1][0]).toBe('Valid until');
  });

  it('says "on receipt" only for a due-less invoice, never for an estimate', () => {
    const dueless = { ...invoice(), dueDate: '' };
    expect(docSpec(dueless, client, settings, {}).dates[1]).toEqual(['Due', 'On receipt']);
    // An estimate restored without a valid-until simply has no expiry row.
    const quote = { ...invoice(), kind: 'quote', number: 'EST-0002', validUntil: '' };
    const labels = docSpec(quote, client, settings, {}).dates.map(([l]) => l);
    expect(labels).not.toContain('Valid until');
    expect(labels).toContain('Issued');
  });

  it('names a company-only client by their company, once', () => {
    const spec = docSpec(invoice(), { id: 'c1', name: '', company: 'Northwind Labs' }, settings, {});
    expect(spec.party.name).toBe('Northwind Labs');
    expect(spec.party.lines).not.toContain('Northwind Labs');
  });

  it('does not repeat a company that matches the client name', () => {
    const both = { id: 'c1', name: 'Northwind Labs', company: 'Northwind Labs', email: 'maya@northwind.example' };
    const spec = docSpec(invoice(), both, settings, {});
    expect(spec.party.name).toBe('Northwind Labs');
    expect(spec.party.lines).toEqual(['maya@northwind.example']);
  });

  it('discloses inclusive tax under the total instead of adding a row above it', () => {
    const spec = docSpec(invoice({ taxRate: 20, taxInclusive: true }), client, settings, {});
    const labels = spec.totals.map((r) => r.label);
    expect(labels).toContain('Includes Tax (20%)');
    expect(labels.indexOf('Includes Tax (20%)')).toBeGreaterThan(labels.indexOf('Total'));
    expect(labels).not.toContain('Tax (20%)');
  });

  it('asks for a deposit only while nothing has been paid', () => {
    const asked = docSpec(invoice({ deposit: { type: 'percent', value: 25 } }), client, settings, {});
    expect(asked.totals.at(-1)).toEqual({
      label: 'Deposit due (25%)', value: pdfMoney(800, 'USD'), strong: true,
    });
    const paidSome = docSpec(invoice({
      deposit: { type: 'percent', value: 25 },
      payments: [{ amount: 800 }],
    }), client, settings, {});
    expect(paidSome.totals.map((r) => r.label)).not.toContain('Deposit due (25%)');
  });

  it('carries payment instructions while a balance is due', async () => {
    const withBank = { ...settings, paymentInstructions: 'IBAN DE00 1234' };
    const spec = docSpec(invoice(), client, withBank, {});
    expect(spec.instructions).toEqual({ label: 'Payment details', text: 'IBAN DE00 1234' });
    expect(docSpec(invoice({ payments: [{ amount: 3200 }] }), client, withBank, {}).instructions)
      .toBe(null);
    const file = text(await renderPdf(spec));
    expect(file).toContain('(PAYMENT DETAILS)');
    expect(file).toContain('(IBAN DE00 1234)');
  });

  it('discloses the late-fee policy while a balance is due', async () => {
    const withPolicy = { ...settings, lateFee: { type: 'fixed', value: 25 } };
    const spec = docSpec(invoice(), client, withPolicy, {});
    expect(spec.lateFee).toEqual({
      label: 'Late fee',
      text: `A late fee of ${pdfMoney(25, 'USD')} per month applies after the due date.`,
    });
    expect(docSpec(invoice({ payments: [{ amount: 3200 }] }), client, withPolicy, {}).lateFee).toBe(null);
    const file = text(await renderPdf(spec));
    expect(file).toContain('(LATE FEE)');
  });

  it('shows the PO / reference beside the dates only when one exists', () => {
    const spec = docSpec(invoice({ reference: 'PO 2026-118' }), client, settings, {});
    expect(spec.dates).toContainEqual(['Reference', 'PO 2026-118']);
    expect(docSpec(invoice(), client, settings, {}).dates.map(([l]) => l))
      .not.toContain('Reference');
  });

  it('prints the client tax ID as the last bill-to line', () => {
    const spec = docSpec(invoice(), { ...client, taxId: 'DE 123456789' }, settings, {});
    expect(spec.party.lines.at(-1)).toBe('Tax ID: DE 123456789');
    expect(docSpec(invoice(), client, settings, {}).party.lines).not.toContain('Tax ID: ');
  });
});

describe('pdfMoney', () => {
  it('keeps symbols the fonts can draw', () => {
    expect(pdfMoney(1000, 'USD')).toMatch(/1,000/);
    expect(pdfMoney(1000, 'EUR')).toMatch(/1,000/);
  });

  it('falls back to the currency code for symbols they cannot', () => {
    const rupees = pdfMoney(1000, 'INR');
    expect(rupees).not.toContain('₹');
    expect(rupees).toMatch(/INR/);
  });

  it('forces Latin digits when the app locale writes others', () => {
    // Pretend the app runs in a locale whose digits WinAnsi cannot draw.
    const RealNF = Intl.NumberFormat;
    globalThis.Intl.NumberFormat = function NumberFormat(locale, opts) {
      return new RealNF(locale === undefined ? 'ar-EG' : locale, opts);
    };
    try {
      const out = pdfMoney(1234.5, 'EGP');
      expect(out).toMatch(/1[,. ]?234[.,]50/);
      expect(winAnsi(out)).not.toContain('?');
    } finally {
      globalThis.Intl.NumberFormat = RealNF;
    }
  });
});

describe('pdfDate', () => {
  it('keeps a drawable localized date', () => {
    const date = pdfDate('2026-08-04', 'fr');
    expect(date).toMatch(/2026/);
    expect(winAnsi(date)).not.toContain('?');
  });

  it('falls back to the ISO date when the locale writes undrawable text', () => {
    expect(pdfDate('2026-08-04', 'ar-EG')).toBe('2026-08-04');
  });

  it('keeps an empty date empty', () => {
    expect(pdfDate('', 'ar-EG')).toBe('');
    expect(pdfDate(null, '')).toBe('');
  });
});

describe('docSpec units', () => {
  it('writes the unit into the quantity column and lends it room', () => {
    const spec = docSpec(invoice({
      items: [{ id: 'l1', name: 'Studio time', qty: 12, rate: 85, unit: 'hours' }],
    }), client, settings, {});
    expect(spec.table.rows[0][1]).toBe('12 hours');
    expect(spec.table.widths[1]).toBeGreaterThan(0.14);
    expect(spec.table.widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('keeps the geometry a document with no units always had', () => {
    const spec = docSpec(invoice(), client, settings, {});
    expect(spec.table.rows[0][1]).toBe('4');
    expect(spec.table.widths).toEqual([0.48, 0.14, 0.19, 0.19]);
  });

  it('draws a unit-bearing invoice inside the page', async () => {
    const bytes = await renderPdf(docSpec(invoice({
      items: [
        { id: 'l1', name: 'Studio time', qty: 12, rate: 85, unit: 'hours' },
        { id: 'l2', name: 'Retouching by a very long description indeed', qty: 1, rate: 240, unit: 'day' },
      ],
    }), client, settings, { today: '2026-08-01' }));
    const { file } = checkStructure(bytes);
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[0]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
    expect(file).toContain('12 hours');
    expect(file).toContain('1 day');
  });
});

describe('docSpec work descriptions', () => {
  it('hands the writer a two-part cell when a line carries details', () => {
    const spec = docSpec(invoice({
      items: [{ id: 'l1', name: 'J. Smith', qty: 3.5, rate: 300, details: 'Drafted the motion' }],
    }), client, settings, {});
    expect(spec.table.rows[0][0]).toEqual({ text: 'J. Smith', sub: 'Drafted the motion' });
    // A line without details stays the plain string it always was.
    expect(docSpec(invoice(), client, settings, {}).table.rows[0][0]).toBe('Brand design (day)');
  });

  it('draws the details under the name, inside the page', async () => {
    const bytes = await renderPdf(docSpec(invoice({
      items: [{
        id: 'l1', name: 'J. Smith', qty: 3.5, rate: 300, unit: 'hours',
        details: 'Reviewed pleadings and prepared the exhibit list',
      }],
    }), client, settings, { today: '2026-08-01' }));
    const { file } = checkStructure(bytes);
    expect(file).toContain('J. Smith');
    expect(file).toContain('Reviewed pleadings');
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
  });

  it('renders a document without details byte-identically to before', async () => {
    const plain = invoice();
    const before = text(await renderPdf(docSpec(plain, client, settings, { today: '2026-08-01' })));
    const withEmpty = text(await renderPdf(docSpec(
      { ...plain, items: [{ ...plain.items[0], details: '' }] },
      client, settings, { today: '2026-08-01' })));
    expect(withEmpty).toBe(before);
  });
});

describe('the statement PDF’s aging summary', () => {
  const open = (over = {}) => invoice({ issueDate: '2026-05-01', dueDate: '2026-08-01', ...over });

  it('adds the buckets under the totals, and draws them on the page', async () => {
    const spec = statementSpec(client, [
      open({ number: 'INV-0100', dueDate: '2026-07-20' }),
      open({ number: 'INV-0101', dueDate: '2026-01-01' }),
    ], settings, { today: '2026-08-04' });
    const labels = spec.totals.map((r) => r.label);
    expect(labels).toContain('Outstanding by age');
    expect(labels).toContain('1–30 days');
    expect(labels).toContain('Over 90 days');
    const { file } = checkStructure(await renderPdf(spec));
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[0]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
  });

  it('leaves a single-age statement exactly as it was', () => {
    const spec = statementSpec(client, [open()], settings, { today: '2026-08-04' });
    expect(spec.totals.map((r) => r.label)).not.toContain('Outstanding by age');
  });
});

describe('the tax note in the PDF', () => {
  it('rides along as its own labelled block, in the document’s language', async () => {
    const spec = docSpec(invoice({ taxes: [], language: 'fr' }), client,
      { ...settings, taxNote: 'preset:reverseCharge' }, {});
    expect(spec.taxNote).toMatchObject({ label: 'Taxe' });
    expect(spec.taxNote.text).toContain('Autoliquidation');
    const { file } = checkStructure(await renderPdf(spec));
    expect(file).toContain('Autoliquidation');
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[0]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
  });

  it('is absent when tax is charged, and when nothing is configured', () => {
    expect(docSpec(invoice({ taxes: [{ label: 'VAT', rate: 20 }] }), client,
      { ...settings, taxNote: 'preset:reverseCharge' }, {}).taxNote).toBe(null);
    expect(docSpec(invoice({ taxes: [] }), client, settings, {}).taxNote).toBe(null);
  });
});

describe('the pay-online heading in the PDF', () => {
  it('speaks the document’s language, like every other label on the sheet', async () => {
    const withLink = (over) => docSpec(invoice(over), client, settings, { payLink: 'https://pay.example/x' });
    const en = await renderPdf(withLink({}));
    expect(new TextDecoder('latin1').decode(en)).toContain('(PAY ONLINE)');
    const spec = withLink({ language: 'fr' });
    expect(spec.payOnline).toBe('Payer en ligne');
    const fr = new TextDecoder('latin1').decode(await renderPdf(spec));
    expect(fr).toContain('(PAYER EN LIGNE)');
    expect(fr).not.toContain('(PAY ONLINE)');
  });
});

describe('the payment schedule in the PDF', () => {
  const plan = (over = {}) => invoice({
    items: [{ id: 'l1', name: 'Project', qty: 1, rate: 3000 }],
    schedule: [
      { id: 'a', label: 'On signing', dueDate: '2026-07-01', type: 'percent', value: 50 },
      { id: 'b', label: 'On delivery', dueDate: '2026-09-01', type: 'percent', value: 50 },
    ],
    ...over,
  });

  it('writes the plan under the totals, and draws it inside the page', async () => {
    const spec = docSpec(plan({ payments: [{ id: 'p', date: '2026-07-02', amount: 2000 }] }),
      client, settings, { today: '2026-08-04' });
    const labels = spec.totals.map((r) => r.label);
    expect(labels).toContain('Payment schedule');
    expect(labels.some((l) => l.includes('On signing') && l.includes('Paid'))).toBe(true);
    expect(labels.some((l) => l.includes('On delivery') && l.includes('open'))).toBe(true);
    const { file } = checkStructure(await renderPdf(spec));
    const coords = [...file.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...coords.map((c) => c[0]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...coords.map((c) => c[1]))).toBeGreaterThanOrEqual(0);
  });

  it('leaves a document without a schedule exactly as it was', () => {
    expect(docSpec(invoice(), client, settings, {}).totals.map((r) => r.label))
      .not.toContain('Payment schedule');
  });

  it('counts only the late half of a plan as overdue on a statement', () => {
    const spec = statementSpec(client, [plan()], settings, { today: '2026-08-04' });
    // $3,000 due in all; the September half is not overdue because the July half is.
    expect(spec.totals.find((r) => r.label === 'Total due').value).toBe(pdfMoney(3000, 'USD'));
    expect(spec.totals.find((r) => r.label === 'Of which overdue').value).toBe(pdfMoney(1500, 'USD'));
  });

  it('stamps a scheduled invoice overdue from its earliest open part', () => {
    const spec = docSpec(plan(), client, settings, { today: '2026-08-04' });
    expect(spec.stamp.label).toBe('Overdue');
  });

  it('dates the header by the earliest open installment, as the paper does', () => {
    const due = (spec) => spec.dates.find(([label]) => label === 'Due')?.[1];
    expect(due(docSpec(plan({ dueDate: '2026-06-01' }), client, settings, {}))).toBe(pdfDate('2026-07-01', ''));
    expect(due(docSpec(plan({ dueDate: '2026-06-01', payments: [{ id: 'p', amount: 1500 }] }), client, settings, {})))
      .toBe(pdfDate('2026-09-01', ''));
    expect(due(docSpec(invoice(), client, settings, {}))).toBe(pdfDate('2026-08-20', ''));
  });
});

describe('text that outgrows its column in the PDF', () => {
  // Every text op on a page, with the box it occupies, parsed back out of
  // the content streams the writer produced.
  const textOps = (file) => file.split('stream\n').slice(1).map((s) => s.split('\nendstream')[0])
    .map((stream) => [...stream.matchAll(/BT [\d. ]+rg \/(F[12]) ([\d.]+) Tf ([\d.-]+) Tc 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \(((?:[^()\\]|\\.)*)\) Tj ET/g)]
      .map((m) => {
        const bold = m[1] === 'F2';
        const size = Number(m[2]);
        const t = m[6].replace(/\\([\\()])/g, '$1');
        const x0 = Number(m[4]);
        const y = Number(m[5]);
        return { t, size, x0, x1: x0 + textWidth(t, size, bold, Number(m[3])), yTop: y + size * 0.8, yBot: y };
      }));
  const overlaps = (file) => textOps(file).flatMap((ops) => {
    const found = [];
    for (let i = 0; i < ops.length; i++) {
      for (let j = i + 1; j < ops.length; j++) {
        const a = ops[i];
        const b = ops[j];
        const vert = Math.min(a.yTop, b.yTop) - Math.max(a.yBot, b.yBot);
        const horiz = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (vert > 2 && horiz > 1) found.push(`"${a.t}" over "${b.t}"`);
      }
    }
    return found;
  });
  const inBounds = (file, pageW) => textOps(file).flat().every((op) => op.x0 >= 0 && op.x1 <= pageW - 40 + 0.5);
  const A4_W = 595.28;

  it('wraps a totals label short of its own amount', async () => {
    // A schedule row reads "when · what for · what is open", and a tax label
    // is whatever the user named it; drawn on one line they ran through the
    // amount beside them and on past the margin.
    const spec = docSpec(invoice({
      items: [{ id: 'l1', name: 'Project', qty: 1, rate: 3000 }],
      taxes: [{ label: 'Harmonized sales tax (Ontario, 13% HST)', rate: 13 }],
      schedule: [
        { id: 'a', label: 'On signing of the master services agreement', dueDate: '2026-07-01', type: 'percent', value: 50 },
        { id: 'b', label: 'On delivery of final assets', dueDate: '2026-09-01', type: 'percent', value: 50 },
      ],
      payments: [{ id: 'p', date: '2026-07-02', amount: 1000 }],
    }), client, settings, { today: '2026-08-04' });
    const { file } = checkStructure(await renderPdf(spec));
    expect(overlaps(file)).toEqual([]);
    expect(inBounds(file, A4_W)).toBe(true);
    // Preserve the full label without assuming a locale-specific line break.
    const text = textOps(file).flat().map((op) => op.t).join(' ');
    expect(text).toContain('On delivery of final assets');
    expect(text).toContain('On signing of the master services agreement');
  });

  it('wraps a long reference instead of running it off the left of the page', async () => {
    const reference = Array.from({ length: 12 }, (_, i) => `PurchaseOrder${i + 1}`).join(' ');
    const spec = docSpec(invoice({ reference }), client, settings, {});
    const { file } = checkStructure(await renderPdf(spec));
    expect(overlaps(file)).toEqual([]);
    expect(inBounds(file, A4_W)).toBe(true);
    expect(file).toContain('PurchaseOrder12');
  });

  it('wraps the business and client names to their own columns', async () => {
    const long = 'Aurora Studio Creative Consulting and Design Partners of the Pacific Northwest LLC';
    const spec = docSpec(invoice(), { ...client, company: long }, {
      ...settings, business: { ...settings.business, name: long },
    }, {});
    const { file } = checkStructure(await renderPdf(spec));
    expect(overlaps(file)).toEqual([]);
    expect(inBounds(file, A4_W)).toBe(true);
    // A name with nothing to break at is cut rather than let run off the page.
    const glued = docSpec(invoice(), client, { ...settings, business: { ...settings.business, name: 'X'.repeat(80) } }, {});
    expect(inBounds(checkStructure(await renderPdf(glued)).file, A4_W)).toBe(true);
  });
});
