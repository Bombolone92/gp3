/**
 * Sample dataset for "explore with sample data": a small design studio with
 * a few months of realistic billing, shaped exactly like an export so
 * store.importAll() installs it, and wipes it, through one hardened path.
 */

import { uid } from './util.js';
import { toISO, todayISO, addDays, yearOf } from './dates.js';
import { formatDocNumber } from './doc.js';
import { DEFAULT_SETTINGS } from './store.js';
import { retireSharePages } from './backup.js';

/**
 * A logo for the sample business, embedded exactly like a real upload so the
 * branding feature is visible while exploring. Hand-written rather than
 * generated: an inline SVG costs a few hundred bytes.
 */
const SAMPLE_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="216" height="56" viewBox="0 0 216 56">'
  + '<g fill="none" stroke="#1f6f5c" stroke-width="4.5" stroke-linecap="round">'
  + '<path d="M7 42a23 23 0 0 1 46 0"/><path d="M19 42a11 11 0 0 1 22 0"/></g>'
  + '<text x="66" y="41" font-family="Georgia,&#39;Times New Roman&#39;,serif" font-size="26"'
  + ' fill="#14332c" textLength="140" lengthAdjust="spacingAndGlyphs">Aurora</text></svg>';

function sampleLogo() {
  try {
    return `data:image/svg+xml;base64,${btoa(SAMPLE_LOGO_SVG)}`;
  } catch {
    return '';
  }
}

export function sampleDataset(store) {
  const now = new Date();
  const daysAgo = (n) => addDays(todayISO(), -n);
  const monthsAgo = (n, day) => {
    const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return toISO(d);
  };

  const c = { northwind: uid(), bluebird: uid(), harbor: uid(), tom: uid() };
  const clients = [
    { id: c.northwind, name: 'Maya Chen', company: 'Northwind Labs', email: 'maya@northwindlabs.example', phone: '', address: '88 Pier Street\nSeattle, WA', createdAt: Date.now() },
    { id: c.bluebird, name: 'Sam Ortiz', company: 'Bluebird Cafe', email: 'sam@bluebirdcafe.example', phone: '(503) 555-0114', address: '19 Alder Lane\nPortland, OR', createdAt: Date.now() },
    { id: c.harbor, name: 'Priya Nair', company: 'Harbor & Finch Architects', email: 'priya@harborfinch.example', phone: '', address: '400 Waterline Blvd\nVancouver, BC', taxId: 'GST 81234 5678 RT0001', createdAt: Date.now() },
    { id: c.tom, name: 'Tom Aldana', company: '', email: 'tom.aldana@example.com', phone: '', address: '', createdAt: Date.now() },
  ];

  const items = [
    { id: uid(), name: 'Brand design (day)', rate: 800 },
    { id: uid(), name: 'Development (hour)', rate: 120 },
    { id: uid(), name: 'Consulting session', rate: 240 },
    { id: uid(), name: 'Website maintenance (monthly)', rate: 250 },
  ];

  const quoteHarborId = uid();
  const invHarborId = uid();
  const recurringId = uid();
  let receiptN = 1;
  const pay = (date, amount, method) => ({
    id: uid(), number: formatDocNumber('RCT-', receiptN),
    date, amount, method, note: '', createdAt: Date.now() + receiptN++,
  });

  const doc = (over) => ({
    id: uid(),
    kind: 'invoice',
    clientId: c.northwind,
    currency: 'USD',
    items: [],
    taxRate: 0,
    discountType: 'none',
    discountValue: 0,
    notes: 'Thank you for your business.',
    status: 'sent',
    payments: [],
    createdAt: Date.now(),
    ...over,
  });

  const invoice = (over) => doc({ ...over });
  const quote = (over) => doc({ kind: 'quote', ...over });

  const docs = [
    invoice({
      number: 'INV-0001', clientId: c.northwind,
      issueDate: monthsAgo(4, 6), dueDate: monthsAgo(4, 20),
      items: [{ id: uid(), name: 'Brand design (day)', qty: 4, rate: 800 }],
      payments: [pay(monthsAgo(4, 18), 3200, 'Bank transfer')],
    }),
    invoice({
      number: 'INV-0002', clientId: c.bluebird,
      issueDate: monthsAgo(3, 2), dueDate: monthsAgo(3, 16),
      items: [
        { id: uid(), name: 'Menu redesign', qty: 1, rate: 640 },
        { id: uid(), name: 'Consulting session', qty: 1, rate: 220 },
      ],
      payments: [pay(monthsAgo(3, 12), 860, 'Card')],
    }),
    invoice({
      id: invHarborId, number: 'INV-0003', clientId: c.harbor, quoteId: quoteHarborId,
      issueDate: monthsAgo(2, 15), dueDate: monthsAgo(1, 15),
      items: [
        { id: uid(), name: 'Portfolio site design', qty: 1, rate: 3000 },
        { id: uid(), name: 'Development (hour)', qty: 20, rate: 120 },
      ],
      payments: [
        pay(monthsAgo(2, 20), 2700, 'Bank transfer'),
        pay(monthsAgo(1, 10), 2700, 'Bank transfer'),
      ],
    }),
    invoice({
      number: 'INV-0004', clientId: c.bluebird,
      issueDate: daysAgo(40), dueDate: daysAgo(26),
      items: [{ id: uid(), name: 'Seasonal campaign assets', qty: 1, rate: 1240 }],
    }),
    invoice({
      number: 'INV-0005', clientId: c.harbor,
      issueDate: daysAgo(10), dueDate: addDays(todayISO(), 20),
      // Harbor & Finch are in BC: GST and PST print as their own rows, and
      // the consulting line carries GST only — services are PST-exempt there.
      taxes: [{ label: 'GST', rate: 5 }, { label: 'PST', rate: 7 }],
      items: [
        { id: uid(), name: 'Development (hour)', qty: 16, rate: 120 },
        { id: uid(), name: 'Consulting session', qty: 1, rate: 240, taxes: [{ label: 'GST', rate: 5 }] },
      ],
      payments: [pay(daysAgo(4), 600, 'PayPal')],
    }),
    invoice({
      number: 'INV-0006', clientId: c.northwind,
      issueDate: daysAgo(8), dueDate: addDays(todayISO(), 6),
      reference: 'PO 2026-118',
      items: [{ id: uid(), name: 'Design system audit', qty: 1, rate: 1980 }],
    }),
    invoice({
      number: 'INV-0007', clientId: c.tom, status: 'draft',
      issueDate: daysAgo(2), dueDate: addDays(todayISO(), 12),
      items: [{ id: uid(), name: 'Consulting session', qty: 2, rate: 240 }],
      notes: '',
    }),
    invoice({
      number: 'INV-0008', clientId: c.bluebird, recurringId,
      issueDate: monthsAgo(0, 1), dueDate: monthsAgo(0, 15),
      items: [{ id: uid(), name: 'Website maintenance (monthly)', qty: 1, rate: 250 }],
    }),
    quote({
      id: quoteHarborId, number: 'EST-0001', clientId: c.harbor,
      status: 'accepted', invoiceId: invHarborId,
      issueDate: monthsAgo(3, 8), validUntil: monthsAgo(2, 8),
      items: [
        { id: uid(), name: 'Portfolio site design', qty: 1, rate: 3000 },
        { id: uid(), name: 'Development (hour)', qty: 20, rate: 120 },
      ],
      notes: 'Includes two revision rounds.',
    }),
    quote({
      number: 'EST-0002', clientId: c.northwind,
      issueDate: daysAgo(20), validUntil: addDays(todayISO(), 10),
      deposit: { type: 'percent', value: 30 },
      items: [{ id: uid(), name: 'Product launch microsite', qty: 1, rate: 4600 }],
      notes: 'Includes two revision rounds.',
    }),
    quote({
      number: 'EST-0003', clientId: c.bluebird,
      issueDate: daysAgo(45), validUntil: daysAgo(15),
      items: [{ id: uid(), name: 'Loyalty app concept', qty: 1, rate: 2800 }],
    }),
    quote({
      number: 'EST-0004', clientId: c.tom, status: 'declined',
      issueDate: daysAgo(10), validUntil: addDays(todayISO(), 20),
      items: [{ id: uid(), name: 'Brand design (day)', qty: 2, rate: 800 }],
    }),
  ];

  const byYear = {};
  for (const d of docs) (byYear[yearOf(d.issueDate)] ||= []).push(d);

  // Next occurrence of day 1, strictly after today.
  const nd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const recurring = [{
    id: recurringId,
    name: 'Bluebird website maintenance',
    clientId: c.bluebird,
    currency: 'USD',
    items: [{ id: uid(), name: 'Website maintenance (monthly)', qty: 1, rate: 250 }],
    taxRate: 0,
    discountType: 'none',
    discountValue: 0,
    notes: 'Thank you for your business.',
    freq: 'monthly',
    anchorDay: 1,
    nextDue: toISO(nd),
    paused: false,
    createdAt: Date.now(),
  }];

  return {
    app: 'invoicing',
    version: 1,
    settings: {
      ...store.settings,
      business: {
        name: 'Aurora Studio',
        email: 'hello@aurorastudio.example',
        phone: '(503) 555-0199',
        address: '412 Fremont Ave\nPortland, OR 97227',
        taxId: '',
        logo: sampleLogo(),
      },
      brandColor: '#1f6f5c',
      currency: 'USD',
      paymentInstructions: 'Bank transfer preferred.\nAurora Studio · First Federal Bank\nAccount 4802 1234 5678 · Routing 123456789',
      lateFee: { type: 'percent', value: 2 },
      nextInvoice: 9,
      nextQuote: 5,
      nextReceipt: 6,
      sampleData: true,
      onboarded: true,
    },
    clients,
    items,
    recurring,
    docs: byYear,
  };
}

/** One-tap exit from sample mode: everything gone, onboarding reopens. */
export async function wipeSampleData(store) {
  // Emailing or sharing a sample document published a real page on the
  // account's subdomain. The wipe drops the tokens that name those pages,
  // so they must be taken offline first — exactly as a restore does —
  // or they would stay live with no way left to unshare them.
  await retireSharePages(store);
  await store.importAll({
    app: 'invoicing',
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      theme: store.settings.theme,
      currency: store.settings.currency,
      share: store.settings.share,
      onboarded: false,
      sampleData: false,
    },
    clients: [],
    items: [],
    recurring: [],
    docs: {},
  });
}
