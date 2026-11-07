import { describe, it, expect, vi } from 'vitest';
import { extractJson, normalizeOcrResult, matchCategory, buildOcrPrompt, runReceiptOcr } from '../src/lib/ocr.js';

const categories = [
  { id: 'meals', name: 'Meals' },
  { id: 'transport', name: 'Ground transport' },
  { id: 'office', name: 'Office supplies' },
];
const now = new Date(2026, 7, 26);

describe('extractJson', () => {
  it('parses bare JSON, fenced JSON, and JSON inside prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":"}"}} thanks')).toEqual({ a: { b: '}' } });
  });
  it('returns null for nothing usable', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"broken":')).toBeNull();
    expect(extractJson(null)).toBeNull();
  });
});

describe('matchCategory', () => {
  it('matches exact, case-insensitive and partial names', () => {
    expect(matchCategory('meals', categories).id).toBe('meals');
    expect(matchCategory('Transport', categories).id).toBe('transport');
    expect(matchCategory('office', categories).id).toBe('office');
    expect(matchCategory('Lodging', categories)).toBeNull();
    expect(matchCategory('', categories)).toBeNull();
  });
});

describe('normalizeOcrResult', () => {
  it('cleans a typical model response', () => {
    const r = normalizeOcrResult({
      merchant: ' Blue Fern Cafe ', date: '08/20/2026', total: '14.60', tax: 1.2, currency: '$',
      category: 'Meals', paymentMethod: 'VISA', cardLast4: '**** 4471',
      items: [{ name: 'Latte', amount: '4.5' }, { name: '', amount: 1 }], confidence: 0.9,
    }, { categories, baseCurrency: 'EUR', now });
    expect(r).toMatchObject({ merchant: 'Blue Fern Cafe', date: '2026-08-20', total: 14.6, tax: 1.2, currency: 'USD', categoryId: 'meals', paymentMethod: 'Card', cardLast4: '4471', confidence: 0.9 });
    expect(r.items).toEqual([{ name: 'Latte', amount: 4.5 }]);
  });
  it('falls back gracefully on missing or odd values', () => {
    const r = normalizeOcrResult({ total: -5, date: '2031-01-01', currency: 'XXX', confidence: 'high' }, { categories, baseCurrency: 'GBP', now });
    expect(r.total).toBeNull();
    expect(r.date).toBeNull();
    expect(r.currency).toBe('GBP');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThan(0.5);
  });
  it('accepts a JSON string as input', () => {
    expect(normalizeOcrResult('{"merchant":"X","total":3}', { categories, baseCurrency: 'USD', now }).total).toBe(3);
  });
});

describe('buildOcrPrompt', () => {
  it('lists the user’s categories and base currency', () => {
    const p = buildOcrPrompt({ categories, baseCurrency: 'CAD' });
    expect(p).toContain('Meals, Ground transport, Office supplies');
    expect(p).toContain('"CAD"');
  });
});

describe('runReceiptOcr', () => {
  const file = new Blob(['x'], { type: 'image/png' });
  it('uses the vision model and reports the source', async () => {
    const sdk = { ai: { chat: vi.fn().mockResolvedValue({ message: { content: '{"merchant":"Deli","total":11.9,"date":"2026-08-03","confidence":0.8}' } }), img2txt: vi.fn() } };
    const { result, source } = await runReceiptOcr(file, { categories, baseCurrency: 'USD', sdk, now, model: 'test-model' });
    expect(source).toBe('vision');
    expect(result.merchant).toBe('Deli');
    expect(sdk.ai.chat).toHaveBeenCalledWith(expect.any(String), file, expect.objectContaining({ model: 'test-model' }));
    expect(sdk.ai.img2txt).not.toHaveBeenCalled();
  });
  it('falls back to img2txt plus a text extraction when vision fails', async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValueOnce({ message: { content: '{"merchant":"Deli","total":11.9}' } });
    const sdk = { ai: { chat, img2txt: vi.fn().mockResolvedValue('DELI\nTOTAL 11.90') } };
    const { result, source } = await runReceiptOcr(file, { categories, baseCurrency: 'USD', sdk, now });
    expect(source).toBe('ocr');
    expect(result.total).toBe(11.9);
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('turns a credit error into a readable message', async () => {
    const sdk = { ai: { chat: vi.fn().mockRejectedValue(new Error('Insufficient credits')), img2txt: vi.fn().mockRejectedValue(new Error('Insufficient credits')) } };
    await expect(runReceiptOcr(file, { categories, baseCurrency: 'USD', sdk, now })).rejects.toThrow(/usage limit/i);
  });
});
