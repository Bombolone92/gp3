import { describe, it, expect } from 'vitest';
import { paymentLink, docPayLink, docPaymentInstructions } from '../src/lib/paylink.js';

const ctx = { amount: 1250.5, currency: 'USD', number: 'INV-0012' };

describe('paymentLink', () => {
  it('returns null when unconfigured', () => {
    expect(paymentLink(null, ctx)).toBeNull();
    expect(paymentLink({ kind: 'none', value: 'x' }, ctx)).toBeNull();
    expect(paymentLink({ kind: 'paypal', value: '' }, ctx)).toBeNull();
  });

  it('builds a PayPal.me link with the amount and currency', () => {
    expect(paymentLink({ kind: 'paypal', value: 'janedoe' }, ctx))
      .toBe('https://paypal.me/janedoe/1250.50USD');
  });

  it('accepts a pasted PayPal.me URL or @handle', () => {
    expect(paymentLink({ kind: 'paypal', value: 'https://paypal.me/janedoe' }, ctx))
      .toBe('https://paypal.me/janedoe/1250.50USD');
    expect(paymentLink({ kind: 'paypal', value: '@janedoe' }, ctx))
      .toBe('https://paypal.me/janedoe/1250.50USD');
    expect(paymentLink({ kind: 'paypal', value: 'paypal.me/janedoe/old-amount' }, { ...ctx, amount: 5 }))
      .toBe('https://paypal.me/janedoe/5.00USD');
  });

  it('fills custom template placeholders', () => {
    const cfg = { kind: 'custom', value: 'https://pay.example.com/?a={amount}&c={currency}&ref={number}' };
    expect(paymentLink(cfg, ctx))
      .toBe('https://pay.example.com/?a=1250.50&c=USD&ref=INV-0012');
  });

  it('returns a template without placeholders as-is and upgrades bare domains', () => {
    expect(paymentLink({ kind: 'custom', value: 'https://buy.stripe.com/abc' }, ctx))
      .toBe('https://buy.stripe.com/abc');
    expect(paymentLink({ kind: 'custom', value: 'pay.example.com/me' }, ctx))
      .toBe('https://pay.example.com/me');
  });

  it('refuses a link for a zero or negative amount', () => {
    expect(paymentLink({ kind: 'paypal', value: 'janedoe' }, { ...ctx, amount: 0 })).toBeNull();
    expect(paymentLink({ kind: 'paypal', value: 'janedoe' }, { ...ctx, amount: -3 })).toBeNull();
  });
});

describe('docPayLink', () => {
  const settings = { paymentLink: { kind: 'paypal', value: 'janedoe' } };
  const invoice = (over = {}) => ({
    kind: 'invoice',
    number: 'INV-0007',
    currency: 'USD',
    status: 'sent',
    items: [{ qty: 1, rate: 100 }],
    payments: [],
    ...over,
  });

  it('links the open balance of an open invoice', () => {
    expect(docPayLink(settings, invoice({ payments: [{ amount: 40 }] })))
      .toBe('https://paypal.me/janedoe/60.00USD');
  });

  it('returns null once nothing is owed', () => {
    expect(docPayLink(settings, invoice({ payments: [{ amount: 100 }] }))).toBeNull();
  });

  it('returns null for a void invoice, whose balance never reached zero', () => {
    expect(docPayLink(settings, invoice({ status: 'void' }))).toBeNull();
  });

  it('returns null without a document or a configured provider', () => {
    expect(docPayLink(settings, null)).toBeNull();
    expect(docPayLink({ paymentLink: { kind: 'none', value: '' } }, invoice())).toBeNull();
  });

  it('prefills a requested deposit until the first payment arrives', () => {
    expect(docPayLink(settings, invoice({ deposit: { type: 'percent', value: 30 } })))
      .toBe('https://paypal.me/janedoe/30.00USD');
    expect(docPayLink(settings, invoice({
      deposit: { type: 'percent', value: 30 },
      payments: [{ amount: 30 }],
    }))).toBe('https://paypal.me/janedoe/70.00USD');
  });

  it('asks for the balance, not the deposit, once the net paid is negative', () => {
    // A payment deleted out from under its refund leaves paid < 0; the paper
    // hides its deposit row then and prints the full balance due, so the
    // link must ask for that same number.
    expect(docPayLink(settings, invoice({
      deposit: { type: 'percent', value: 30 },
      payments: [{ amount: -25 }],
    }))).toBe('https://paypal.me/janedoe/125.00USD');
  });
});

describe('docPaymentInstructions', () => {
  const settings = { paymentInstructions: 'IBAN DE00 1234' };
  const invoice = (over = {}) => ({
    kind: 'invoice',
    number: 'INV-0012',
    currency: 'USD',
    status: 'sent',
    items: [{ qty: 1, rate: 100 }],
    payments: [],
    ...over,
  });

  it('treats a non-string from a restored backup as nothing to print', () => {
    // settings.paymentInstructions = {} made paperHTML throw on every invoice.
    expect(docPaymentInstructions({ paymentInstructions: {} }, invoice(), { paymentInstructions: [] })).toBe(null);
    expect(docPaymentInstructions(settings, invoice(), { paymentInstructions: 42 })).toBe('IBAN DE00 1234');
  });

  it('prints the global instructions while a balance is open', () => {
    expect(docPaymentInstructions(settings, invoice())).toBe('IBAN DE00 1234');
    expect(docPaymentInstructions(settings, invoice({ payments: [{ amount: 40 }] })))
      .toBe('IBAN DE00 1234');
  });

  it('prefers the client\'s own instructions', () => {
    expect(docPaymentInstructions(settings, invoice(), { paymentInstructions: 'Pay via ACME portal' }))
      .toBe('Pay via ACME portal');
    // An empty override inherits, exactly like the other billing defaults.
    expect(docPaymentInstructions(settings, invoice(), { paymentInstructions: '  ' }))
      .toBe('IBAN DE00 1234');
  });

  it('says nothing on settled or void invoices, estimates, or without any text', () => {
    expect(docPaymentInstructions(settings, invoice({ payments: [{ amount: 100 }] }))).toBeNull();
    expect(docPaymentInstructions(settings, invoice({ status: 'void' }))).toBeNull();
    expect(docPaymentInstructions(settings, { ...invoice(), kind: 'quote' })).toBeNull();
    expect(docPaymentInstructions({}, invoice())).toBeNull();
    expect(docPaymentInstructions(settings, null)).toBeNull();
  });
});
