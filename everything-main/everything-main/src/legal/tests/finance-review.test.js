import { describe, it, expect, afterEach } from 'vitest';
import { parseMoney, percentOf, setMoneyDefaults, formatMoney } from '../src/core/money.js';
import { parseCsv, csvObjects, toCsv } from '../src/core/csv.js';
import { contactsFromRows, contactsToRows } from '../src/core/contacts-io.js';
import { conflictSearch } from '../src/core/matters.js';
import { normalize } from '../src/core/format.js';
import { activityByCategory, hoursByUser, trustLedgerRows } from '../src/core/report-calc.js';
import { accountBalance, checkTrustWithdrawal, ledger, billTotals, activityAmount, lineAmount, lineFromActivity, draftBill, agingBuckets, billPaid, billBalance, billStatus } from '../src/core/finance.js';
import { shiftRange, billableMatters } from '../src/core/billing-ops.js';
import { isISODate } from '../src/core/dates.js';
import { parseDuration } from '../src/core/duration.js';
import { defaultSettings } from '../src/core/settings.js';

describe('parseMoney', () => {
  it('reads a decimal comma as the decimal point', () => {
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('€12,5')).toBe(1250);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1 234,56')).toBe(123456);
    expect(parseMoney('-0,99')).toBe(-99);
  });

  it('still reads commas as thousands separators', () => {
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('1,234,567')).toBe(123456700);
  });
});

describe('parseCsv', () => {
  it('keeps a quote inside an unquoted cell as text', () => {
    expect(parseCsv('Name,Notes\nAda,12" monitor\nGrace,ok\n')).toEqual([
      ['Name', 'Notes'],
      ['Ada', '12" monitor'],
      ['Grace', 'ok'],
    ]);
    expect(parseCsv('John "Jack" Smith,x\n')).toEqual([['John "Jack" Smith', 'x']]);
  });
});

describe('contact import from other apps', () => {
  it('reads email, phone, and address from an Outlook export', () => {
    const text =
      'First Name,Middle Name,Last Name,Title,Company,Job Title,Business Street,Business City,Business State,Business Postal Code,Business Country/Region,Business Phone,Mobile Phone,E-mail Address,Notes\n' +
      'Jane,,Doe,Ms.,Acme,Counsel,1 Main St,Springfield,IL,62701,USA,555-1000,555-2000,jane@acme.example,hi\n';
    const [c] = contactsFromRows(csvObjects(text));
    expect(c.emails[0].address).toBe('jane@acme.example');
    expect(c.phones[0].number).toBe('555-1000');
    expect(c.addresses[0]).toMatchObject({ street: '1 Main St', city: 'Springfield', region: 'IL', postal: '62701', country: 'USA' });
    expect(c.jobTitle).toBe('Counsel');
  });

  it('reads email, phone, company, and address from a Google Contacts export', () => {
    const text =
      'First Name,Last Name,Name Prefix,Organization Name,Organization Title,Labels,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Street,Address 1 - City,Address 1 - Region,Address 1 - Postal Code,Address 1 - Country\n' +
      'John,Smith,Dr.,Globex,CEO,* myContacts ::: Clients,Work,john@globex.example,Mobile,+1 555 3000,2 Elm,Shelbyville,IL,62565,USA\n';
    const [c] = contactsFromRows(csvObjects(text));
    expect(c.prefix).toBe('Dr.');
    expect(c.companyName).toBe('Globex');
    expect(c.jobTitle).toBe('CEO');
    expect(c.emails[0].address).toBe('john@globex.example');
    expect(c.phones[0].number).toBe('+1 555 3000');
    expect(c.addresses[0]).toMatchObject({ street: '2 Elm', city: 'Shelbyville', region: 'IL', postal: '62565', country: 'USA' });
    expect(c.tags).toEqual(['Clients']);
  });
});

describe('contact export', () => {
  it('keeps the second address line through export and import', () => {
    const src = [{ type: 'person', firstName: 'Lin', lastName: 'Ng', addresses: [{ street: '1 Main St', street2: 'Suite 400', city: 'Riverton', primary: true }] }];
    const [back] = contactsFromRows(csvObjects(toCsv(contactsToRows(src))));
    expect(back.addresses[0]).toMatchObject({ street: '1 Main St', street2: 'Suite 400', city: 'Riverton' });
  });
});

describe('accent-insensitive matching', () => {
  const person = (firstName, lastName) => ({ id: lastName, type: 'person', firstName, lastName });
  const hits = (q, contacts) => conflictSearch(q, { contacts, matters: [] }).map((h) => h.contact.id);

  it('matches letters that have no combining accent', () => {
    expect(normalize('Łódź Søren Straße Ærø Œuvre Đorđe')).toBe('lodz soren strasse aero oeuvre dorde');
    expect(hits('Soren Kierkegaard', [person('Søren', 'Kierkegaard')])).toEqual(['Kierkegaard']);
    expect(hits('Walesa', [person('Lech', 'Wałęsa')])).toEqual(['Wałęsa']);
    expect(hits('Strasse', [person('Hans', 'Straße')])).toEqual(['Straße']);
  });

  it('treats curly and straight apostrophes alike', () => {
    expect(hits("O'Brien", [person('Pat', 'O’Brien')])).toEqual(['O’Brien']);
    expect(hits('D’Angelo', [person('Ann', "D'Angelo")])).toEqual(["D'Angelo"]);
  });
});

describe('conflict search by phone', () => {
  const c = { id: 'c1', type: 'person', firstName: 'Amara', lastName: 'Lopez', phones: [{ number: '(555) 201-4410' }] };
  const hits = (q) => conflictSearch(q, { contacts: [c], matters: [] }).map((h) => h.contact.id);

  it('matches a phone number however it is punctuated', () => {
    expect(hits('5552014410')).toEqual(['c1']);
    expect(hits('555-201-4410')).toEqual(['c1']);
    expect(hits('+1 555 201 4410')).toEqual(['c1']);
    expect(hits('201 4410')).toEqual(['c1']);
  });

  it('does not match unrelated digits', () => {
    expect(hits('555-999-0000')).toEqual([]);
  });
});

describe('conflict search with "Last, First"', () => {
  const c = { id: 'c1', type: 'person', firstName: 'John', lastName: 'Smith' };
  const hits = (q) => conflictSearch(q, { contacts: [c], matters: [] });

  it('ignores the comma between last and first names', () => {
    expect(hits('Smith, J').map((h) => h.contact.id)).toEqual(['c1']);
    expect(hits('Smith,').map((h) => h.contact.id)).toEqual(['c1']);
    expect(hits('Smith, John')[0].score).toBeGreaterThanOrEqual(60);
    expect(hits(',,')).toEqual([]);
  });
});

describe('activityByCategory', () => {
  it('keeps uncategorized flat fees apart from uncategorized time, in any order', () => {
    const flat = { kind: 'flat', date: '2026-10-01', amountCents: 100000 };
    const time = { kind: 'time', date: '2026-10-02', minutes: 60, rateCents: 10000 };
    for (const activities of [
      [flat, time],
      [time, flat],
    ]) {
      const rows = activityByCategory({ activities, settings: defaultSettings(), from: '', to: '' });
      expect(rows.map((r) => [r.name, r.amount, r.count])).toEqual([
        ['Flat fees', 100000, 1],
        ['Uncategorized', 10000, 1],
      ]);
    }
  });
});

describe('shiftRange', () => {
  it('moves a quarter by a quarter', () => {
    expect(shiftRange('2026-01-01', '2026-03-31', 1)).toEqual(['2026-04-01', '2026-06-30']);
    expect(shiftRange('2026-04-01', '2026-06-30', -1)).toEqual(['2026-01-01', '2026-03-31']);
    expect(shiftRange('2026-10-01', '2026-12-31', 1)).toEqual(['2027-01-01', '2027-03-31']);
  });

  it('moves a year by a year, across leap years', () => {
    expect(shiftRange('2027-01-01', '2027-12-31', 1)).toEqual(['2028-01-01', '2028-12-31']);
    expect(shiftRange('2028-01-01', '2028-12-31', 1)).toEqual(['2029-01-01', '2029-12-31']);
  });
});

describe('hoursByUser targets', () => {
  const users = [{ id: 'u1', name: 'Ann', targetHours: 100 }];
  const target = (from, to, today = null) => hoursByUser({ activities: [], users, bills: [], from, to, today })[0].targetMinutes;

  it('uses the monthly target as is for a whole calendar month', () => {
    expect(target('2026-02-01', '2026-02-28')).toBe(6000);
    expect(target('2026-10-01', '2026-10-31')).toBe(6000);
    expect(target('2026-01-01', '2026-03-31')).toBe(18000);
    expect(target('2026-01-01', '2026-12-31')).toBe(72000);
  });

  it('prorates part of a month by its days', () => {
    expect(target('2026-04-01', '2026-04-30', '2026-04-15')).toBe(3000);
    expect(target('2026-01-16', '2026-02-14')).toBe(Math.round(6000 * (16 / 31 + 14 / 28)));
  });
});

describe('hoursByUser over all dates', () => {
  it('prorates the target over the time actually recorded instead of one month', () => {
    const users = [{ id: 'u1', name: 'Ann', targetHours: 100 }];
    const activities = [
      { kind: 'time', userId: 'u1', date: '2026-01-01', minutes: 60, rateCents: 0 },
      { kind: 'time', userId: 'u1', date: '2026-05-20', minutes: 60, rateCents: 0 },
    ];
    const [r] = hoursByUser({ activities, users, bills: [], from: '', to: '', today: '2026-06-30' });
    expect(r.targetMinutes).toBe(36000);
    const [s] = hoursByUser({ activities, users, bills: [], from: '', to: '2026-03-31', today: '2026-06-30' });
    expect(s.targetMinutes).toBe(18000);
  });
});

describe('trust ledger report', () => {
  const accounts = [
    { id: 't1', type: 'trust', openingBalanceCents: 5000 },
    { id: 't2', type: 'trust', openingBalanceCents: 0 },
    { id: 'op', type: 'operating', openingBalanceCents: 99999 },
  ];
  const transactions = [
    { id: 'x1', accountId: 't1', matterId: 'm1', type: 'deposit', amountCents: 1000, date: '2026-01-10' },
    { id: 'x2', accountId: 't1', matterId: 'm1', type: 'withdrawal', amountCents: 400, date: '2026-02-10' },
  ];

  it("starts an account's ledger from the account's opening balance", () => {
    const all = trustLedgerRows({ transactions, accounts, accountId: 't1' });
    expect(all.rows.map((r) => r.balance)).toEqual([6000, 5600]);
    expect(all.closing).toBe(accountBalance(accounts[0], transactions));
    expect(trustLedgerRows({ transactions, accounts, accountId: 't1', from: '2026-02-01' }).opening).toBe(6000);
    expect(trustLedgerRows({ transactions, accounts, accountId: 't1', from: '2026-03-01' }).opening).toBe(5600);
    expect(trustLedgerRows({ transactions, accounts }).closing).toBe(5600);
  });

  it('leaves a matter ledger at zero before its first deposit', () => {
    expect(trustLedgerRows({ transactions, accounts, matterId: 'm1' }).rows.map((r) => r.balance)).toEqual([1000, 600]);
  });
});

describe('backdated trust withdrawals', () => {
  const tx = [
    { id: 'd1', accountId: 'tr', matterId: 'm1', type: 'deposit', amountCents: 10000, date: '2026-03-01', createdAt: '1' },
    { id: 'w1', accountId: 'tr', matterId: 'm1', type: 'withdrawal', amountCents: 6000, date: '2026-03-10', createdAt: '2' },
    { id: 'd2', accountId: 'tr', matterId: 'm1', type: 'deposit', amountCents: 50000, date: '2026-04-01', createdAt: '3' },
  ];
  const check = (amountCents, date) => checkTrustWithdrawal({ matterId: 'm1', accountId: 'tr', amountCents, transactions: tx, date });

  it('refuses a withdrawal dated before the funds arrived', () => {
    const r = check(5000, '2026-02-15');
    expect(r.ok).toBe(false);
    expect(r.available).toBe(0);
    expect(r.reason).toMatch(/on or after that date/);
  });

  it('refuses a withdrawal that would overdraw the matter on a later day', () => {
    // 10,000 in on Mar 1, so 10,000 is there on Mar 5, but 6,000 leaves on Mar 10.
    expect(check(5000, '2026-03-05').ok).toBe(false);
    expect(check(4000, '2026-03-05').ok).toBe(true);
    const after = [...tx, { id: 'w2', accountId: 'tr', matterId: 'm1', type: 'withdrawal', amountCents: 4000, date: '2026-03-05', createdAt: '4' }];
    expect(ledger(after, { matterId: 'm1' }).every((r) => r.balance >= 0)).toBe(true);
  });

  it('allows what is held from that day on, and everything held today without a date', () => {
    expect(check(54000, '2026-04-01').ok).toBe(true);
    expect(check(54001, '2026-04-01').ok).toBe(false);
    expect(check(54000).ok).toBe(true);
  });
});

describe('bill discounts with a credit line', () => {
  const lines = [
    { kind: 'expense', qty: 1, priceCents: 50000 },
    { kind: 'flat', amountCents: -10000, description: 'Courtesy credit' },
  ];

  it('never turns a discount into a charge when fees are negative', () => {
    for (const discount of [
      { type: 'amount', value: 5000 },
      { type: 'percent', value: 10 },
    ]) {
      const t = billTotals({ lines, discount, taxRate: 0 });
      expect(t.discount).toBe(0);
      expect(t.total).toBe(40000);
    }
  });
});

describe('isISODate', () => {
  it('rejects dates that do not exist', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-00-10')).toBe(false);
    expect(isISODate('2027-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-10-12')).toBe(true);
  });
});

describe('parseDuration', () => {
  it('accepts hours written with a leading decimal point and a unit', () => {
    expect(parseDuration('.5h')).toBe(30);
    expect(parseDuration('.25 hours')).toBe(15);
    expect(parseDuration('.5h 10m')).toBe(40);
  });
});

describe('parseDuration limits', () => {
  it('rejects impossible durations whichever way they are written', () => {
    expect(parseDuration('99999')).toBeNull();
    expect(parseDuration('99999h')).toBeNull();
    expect(parseDuration('9999999m')).toBeNull();
    expect(parseDuration('99999h 5m')).toBeNull();
    expect(parseDuration('744h')).toBe(744 * 60);
    expect(parseDuration('120m')).toBe(120);
  });
});

describe('percentOf', () => {
  it('rounds exact half cents up, without binary floating point error', () => {
    // 6.35% of $410.00 is exactly $26.035.
    expect(percentOf(41000, 6.35)).toBe(2604);
    // 2.3% of $15.00 is exactly $0.345.
    expect(percentOf(1500, 2.3)).toBe(35);
    expect(percentOf(1375, 2.8)).toBe(39);
    expect(percentOf(-41000, 6.35)).toBe(-2604);
    expect(percentOf(12345, 8.875)).toBe(1096);
    expect(percentOf(100, 0)).toBe(0);
    expect(percentOf(100, 'x')).toBe(0);
  });

  it('charges the right tax on a bill', () => {
    const t = billTotals({ lines: [{ kind: 'flat', amountCents: 41000 }], taxRate: 6.35 });
    expect(t.tax).toBe(2604);
    expect(t.total).toBe(43604);
  });
});

describe('expense amounts', () => {
  it('rounds quantity times price to the right cent', () => {
    // 0.35 × 90¢ is exactly 31.5¢, and 0.29 × 50¢ is 14.5¢.
    const a = { id: 'e1', kind: 'expense', qty: 0.35, priceCents: 90 };
    expect(activityAmount(a)).toBe(32);
    expect(lineAmount(lineFromActivity(a))).toBe(32);
    expect(activityAmount({ kind: 'expense', qty: 0.29, priceCents: 50 })).toBe(15);
    expect(activityAmount({ kind: 'expense', qty: 3, priceCents: 1250 })).toBe(3750);
    expect(activityAmount({ kind: 'expense', priceCents: 1250 })).toBe(1250);
  });
});

describe('flat fee matters billed through flat fee entries', () => {
  const matter = { id: 'm1', clientId: 'c1', description: 'Will', billing: { method: 'flat', flatFeeCents: 150000 } };
  const flatEntry = { id: 'f1', kind: 'flat', matterId: 'm1', date: '2026-09-02', amountCents: 150000, billId: 'b1' };
  const expense = { id: 'e1', kind: 'expense', matterId: 'm1', date: '2026-10-02', qty: 1, priceCents: 4500 };

  it('does not add the agreed fee again once a flat fee entry was billed', () => {
    const out = draftBill({ matter, activities: [flatEntry, expense], settings: defaultSettings(), number: 2, issueDate: '2026-10-12' });
    expect(out.bill.lines.map((l) => l.kind)).toEqual(['expense']);
    const [row] = billableMatters({ matters: [matter], activities: [flatEntry, expense] });
    expect(row.flat).toBe(0);
    expect(row.total).toBe(4500);
    expect(billableMatters({ matters: [matter], activities: [flatEntry] })).toEqual([]);
  });

  it('does not add the agreed fee when a flat fee entry is waiting outside the period', () => {
    const later = { ...flatEntry, billId: null, date: '2026-11-01' };
    const out = draftBill({ matter, activities: [later, expense], settings: defaultSettings(), number: 2, issueDate: '2026-10-12', to: '2026-10-31' });
    expect(out.bill.lines.map((l) => l.kind)).toEqual(['expense']);
  });

  it('still adds the agreed fee when the fee was never entered or billed', () => {
    const out = draftBill({ matter, activities: [expense], settings: defaultSettings(), number: 2, issueDate: '2026-10-12' });
    expect(out.bill.lines.map((l) => l.kind)).toEqual(['flat', 'expense']);
  });
});

describe('currencies without cents', () => {
  afterEach(() => setMoneyDefaults({ currency: 'USD' }));

  it('bills whole yen so the lines add up to the total and the balance can be paid', () => {
    setMoneyDefaults({ currency: 'JPY' });
    const lines = [1, 2, 3].map((i) => ({ id: `l${i}`, kind: 'time', minutes: 20, rateCents: 1000000 }));
    lines.push({ id: 'e', kind: 'expense', qty: 0.5, priceCents: 33300 });
    const bill = { id: 'b1', status: 'issued', lines, discount: { type: 'percent', value: 3 }, taxRate: 10 };
    const t = billTotals(bill);
    for (const v of [...lines.map(lineAmount), t.fees, t.discount, t.tax, t.total]) expect(v % 100).toBe(0);
    expect(lines.slice(0, 3).map(lineAmount)).toEqual([333300, 333300, 333300]);
    expect(formatMoney(lines.slice(0, 3).reduce((s, l) => s + lineAmount(l), 0))).toBe(formatMoney(t.fees));
  });

  it('treats a yen bill paid to the fraction of a yen as paid', () => {
    setMoneyDefaults({ currency: 'JPY' });
    // ¥3,333.50 before amounts were rounded to whole yen, ¥3,334 now.
    const bill = { id: 'b1', status: 'issued', dueDate: '2026-01-01', lines: [{ id: 'l', kind: 'time', minutes: 20, rateCents: 1000100 }] };
    expect(billTotals(bill).total).toBe(333400);
    const payments = [{ billId: 'b1', amountCents: 333350 }];
    expect(billBalance(bill, payments)).toBe(0);
    expect(billStatus(bill, payments, '2026-10-12')).toBe('paid');
    expect(billStatus(bill, [{ billId: 'b1', amountCents: 333300 }], '2026-10-12')).toBe('overdue');
  });

  it('keeps cents for dollars', () => {
    const bill = { id: 'b1', status: 'issued', dueDate: '2026-01-01', lines: [{ id: 'l', kind: 'flat', amountCents: 1000 }] };
    expect(billBalance(bill, [{ billId: 'b1', amountCents: 999 }])).toBe(1);
    expect(billStatus(bill, [{ billId: 'b1', amountCents: 999 }], '2026-10-12')).toBe('overdue');
    expect(lineAmount({ kind: 'time', minutes: 20, rateCents: 1000000 })).toBe(333333);
  });
});

describe('payments per bill', () => {
  it('reads the payments list once, not once per bill', () => {
    let reads = 0;
    const bills = [];
    const payments = [];
    for (let i = 0; i < 300; i++) {
      bills.push({ id: `b${i}`, status: 'issued', dueDate: '2026-09-01', lines: [{ kind: 'flat', amountCents: 10000 }] });
      payments.push({
        get billId() {
          reads++;
          return `b${i}`;
        },
        amountCents: 2500,
      });
    }
    const aging = agingBuckets(bills, payments, '2026-10-12');
    expect(aging.d60).toBe(300 * 7500);
    expect(reads).toBeLessThanOrEqual(payments.length);
    expect(billPaid(bills[7], payments)).toBe(2500);
    expect(billPaid({ id: 'none' }, payments)).toBe(0);
    // A new payments array (the store replaces it on change) is read afresh.
    expect(billPaid(bills[7], [...payments, { billId: 'b7', amountCents: 100 }])).toBe(2600);
  });
});

describe('Outlook title column', () => {
  it('reads Title as the name prefix when the file also has a Job Title column', () => {
    const text = 'First Name,Last Name,Title,Job Title\nJane,Doe,Ms.,\nJohn,Roe,Mr.,Partner\n';
    const [a, b] = contactsFromRows(csvObjects(text));
    expect([a.prefix, a.jobTitle]).toEqual(['Ms.', '']);
    expect([b.prefix, b.jobTitle]).toEqual(['Mr.', 'Partner']);
  });

  it('still reads Title as the job title when there is no Job Title column', () => {
    const [c] = contactsFromRows(csvObjects('First Name,Last Name,Title\nBo,Lee,CFO\n'));
    expect([c.prefix, c.jobTitle]).toEqual(['', 'CFO']);
  });
});
