import { describe, it, expect } from 'vitest';
import { buildExtractionPrompt, parseObligations, MAX_EXTRACT_CHARS } from '../src/lib/extract.js';

describe('buildExtractionPrompt', () => {
  it('embeds the agreement text', () => {
    const prompt = buildExtractionPrompt('The Vendor shall deliver monthly reports.');
    expect(prompt).toContain('The Vendor shall deliver monthly reports.');
    expect(prompt).toContain('JSON array');
  });

  it('clips oversized input', () => {
    const prompt = buildExtractionPrompt('x'.repeat(MAX_EXTRACT_CHARS + 5000));
    expect(prompt.length).toBeLessThan(MAX_EXTRACT_CHARS + 2000);
  });
});

describe('parseObligations', () => {
  const valid = [
    { text: 'Pay invoice net 30', owner: 'us', due: '2026-09-01' },
    { text: 'Deliver quarterly report', owner: 'them', due: null },
  ];

  it('parses a clean JSON array string', () => {
    const out = parseObligations(JSON.stringify(valid));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ...valid[0], repeat: null });
  });

  it('accepts an already-parsed array', () => {
    expect(parseObligations(valid)).toHaveLength(2);
  });

  it('strips markdown code fences', () => {
    const out = parseObligations('```json\n' + JSON.stringify(valid) + '\n```');
    expect(out).toHaveLength(2);
  });

  it('recovers the array from surrounding prose', () => {
    const out = parseObligations(`Here are the obligations I found:\n${JSON.stringify(valid)}\nLet me know if you need more.`);
    expect(out).toHaveLength(2);
  });

  it('unwraps an object with a nested array', () => {
    const out = parseObligations(JSON.stringify({ obligations: valid }));
    expect(out).toHaveLength(2);
  });

  it('defaults bad owners and invalid due dates', () => {
    const out = parseObligations(JSON.stringify([
      { text: 'Do the thing', owner: 'somebody', due: 'next Tuesday' },
    ]));
    expect(out[0].owner).toBe('us');
    expect(out[0].due).toBeNull();
  });

  it('accepts alternative text keys the model might use', () => {
    const out = parseObligations(JSON.stringify([{ obligation: 'Give 30 days notice', owner: 'us' }]));
    expect(out[0].text).toBe('Give 30 days notice');
  });

  it('drops entries without text and non-objects', () => {
    const out = parseObligations(JSON.stringify([
      { owner: 'us' }, 'just a string', null, { text: '  ' }, { text: 'Real one', owner: 'them' },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Real one');
  });

  it('caps runaway lists at 25 and long text at 200 chars', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ text: `Obligation ${i} ${'y'.repeat(300)}` }));
    const out = parseObligations(JSON.stringify(many));
    expect(out).toHaveLength(25);
    expect(out[0].text.length).toBe(200);
  });

  it('keeps a cadence the text stated, and normalizes the wording', () => {
    const out = parseObligations(JSON.stringify([
      { text: 'Pay each month', repeat: 'monthly' },
      { text: 'Report', repeat: 'Quarterly' },
      { text: 'Insurance', repeat: 'yearly' },
      { text: 'Invoice', frequency: 'monthly' },
      { text: 'One-off', repeat: 'none' },
      { text: 'Odd', repeat: 'every other Thursday' },
    ]));
    expect(out.map((o) => o.repeat)).toEqual(['monthly', 'quarterly', 'annually', 'monthly', null, null]);
  });

  it('returns [] for garbage, empty, and non-JSON input', () => {
    expect(parseObligations('')).toEqual([]);
    expect(parseObligations(null)).toEqual([]);
    expect(parseObligations('The contract requires payment.')).toEqual([]);
    expect(parseObligations('{"broken": ')).toEqual([]);
  });
});
