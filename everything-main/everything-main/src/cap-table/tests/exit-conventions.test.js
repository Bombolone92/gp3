import { describe, it, expect } from 'vitest';
import { exitWaterfall } from '../src/lib/captable.js';

/**
 * How an unconverted SAFE is paid at a sale, held to the instrument's own
 * text: the cap divides by the liquidity capitalization (no unissued pool),
 * and the money-back leg ranks where each SAFE form puts it.
 */

const ASOF = '2026-01-01';
const holder = (id, name, kind = 'founder') => ({ id, name, kind });

/** 8,000,000 common, 2,000,000 Series A at $1.00 (1x, non-participating). */
function table({ pool = 0, classes = [], securities = [] } = {}) {
  return {
    company: { name: 'Test Co', poolAuthorized: pool },
    classes: [
      { id: 'c1', name: 'Common Stock', kind: 'common', liquidationMultiple: 0, participating: false, seniority: 0 },
      { id: 'p1', name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 },
      ...classes,
    ],
    stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova Ventures', 'investor'), holder('h5', 'Beacon Angels', 'investor'), holder('h6', 'Harbor', 'investor')],
    securities: [
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
      { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 1, date: '2024-01-01' },
      ...securities,
    ],
  };
}
const safe = (overrides = {}) => ({
  id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h5', principal: 250_000, valuationCap: 5_000_000,
  discount: 0, safeType: 'post', date: '2025-01-01', ...overrides,
});
const paid = (r, id) => r.rows.find((x) => x.stakeholderId === id)?.proceeds ?? 0;
const row = (r, id) => r.convertibles.find((c) => c.id === id);

describe('a SAFE cap at an exit divides by the liquidity capitalization', () => {
  it('leaves the unissued option pool out of a post-money cap basis', () => {
    /* $250k on a $5M post-money cap is 5% of the liquidity capitalization:
       the 10,000,000 shares on the table plus the SAFE's own, so 10M / 0.95
       and 526,316 shares. With the 2,000,000 unallocated pool counted the
       basis was 12M / 0.95 and the SAFE took 631,579 shares - 5.94% of a
       sale its instrument gives it 5% of. */
    const r = exitWaterfall(table({ pool: 2_000_000, securities: [safe()] }), { exitValue: 50_000_000, asOf: ASOF });
    const s = row(r, 'sf1');
    expect(s.elected).toBe('converted');
    expect(s.shares).toBeCloseTo(10_000_000 / 0.95 - 10_000_000, 3);
    // Series A converts at this price, so the SAFE's 5% is 5% of the whole sale.
    expect(s.proceeds).toBeCloseTo(2_500_000, 2);
    expect(r.distributed).toBeCloseTo(50_000_000, 4);
  });

  it('leaves the pool out of a pre-money cap basis too', () => {
    // $250k on a $5M pre-money cap: the cap divides by the 10,000,000 shares, so $0.50 a share.
    const r = exitWaterfall(table({ pool: 2_000_000, securities: [safe({ safeType: 'pre' })] }), { exitValue: 50_000_000, asOf: ASOF });
    const s = row(r, 'sf1');
    expect(s.elected).toBe('converted');
    expect(s.conversionPrice).toBeCloseTo(0.5, 9);
    expect(s.shares).toBeCloseTo(500_000, 6);
  });

  it('reads the same with no pool at all', () => {
    const withPool = exitWaterfall(table({ pool: 2_000_000, securities: [safe()] }), { exitValue: 50_000_000, asOf: ASOF });
    const without = exitWaterfall(table({ securities: [safe()] }), { exitValue: 50_000_000, asOf: ASOF });
    expect(row(withPool, 'sf1').shares).toBeCloseTo(row(without, 'sf1').shares, 6);
    expect(paid(withPool, 'h1')).toBeCloseTo(paid(without, 'h1'), 4);
  });
});

describe('a SAFE taking its money back ranks where its form puts it', () => {
  it('pays a post-money SAFE on par with the preferred, pro rata by claim when short', () => {
    /* $1M after no debt cannot cover the $2M preference and the $250k
       cash-out: the two share it in proportion to what each is due. */
    const r = exitWaterfall(table({ securities: [safe()] }), { exitValue: 1_000_000, asOf: ASOF });
    expect(row(r, 'sf1').elected).toBe('cash');
    expect(row(r, 'sf1').proceeds).toBeCloseTo(1_000_000 * (250_000 / 2_250_000), 6);
    expect(paid(r, 'h4')).toBeCloseTo(1_000_000 * (2_000_000 / 2_250_000), 6);
    expect(paid(r, 'h1')).toBe(0);
    expect(r.distributed).toBeCloseTo(1_000_000, 6);
  });

  it('pays every claim in the pool in full once the proceeds cover them', () => {
    const r = exitWaterfall(table({ securities: [safe()] }), { exitValue: 2_250_000, asOf: ASOF });
    expect(row(r, 'sf1').proceeds).toBeCloseTo(250_000, 6);
    expect(paid(r, 'h4')).toBeCloseTo(2_000_000, 6);
    expect(r.residual).toBeCloseTo(0, 6);
  });

  it('lets the preferred divide their share of the pool by seniority', () => {
    /* Series B ($1M, senior) over Series A ($2M) with a $500k post-money
       SAFE in cash: $1.75M is half the $3.5M of claims, so the SAFE takes
       $250k, and the preferred's $1.5M goes to B first. */
    const db = table({
      classes: [{ id: 'p2', name: 'Series B Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 2 }],
      securities: [
        { id: 's3', kind: 'shares', label: 'SB-1', stakeholderId: 'h6', classId: 'p2', quantity: 1_000_000, pricePerShare: 1, date: '2025-01-01' },
        safe({ principal: 500_000 }),
      ],
    });
    const r = exitWaterfall(db, { exitValue: 1_750_000, asOf: ASOF });
    expect(row(r, 'sf1').proceeds).toBeCloseTo(250_000, 6);
    expect(paid(r, 'h6')).toBeCloseTo(1_000_000, 6);
    expect(paid(r, 'h4')).toBeCloseTo(500_000, 6);
    expect(paid(r, 'h1')).toBe(0);
  });

  it('pays a pre-money SAFE its money ahead of every share', () => {
    const r = exitWaterfall(table({ securities: [safe({ safeType: 'pre' })] }), { exitValue: 1_000_000, asOf: ASOF });
    expect(row(r, 'sf1').elected).toBe('cash');
    expect(row(r, 'sf1').proceeds).toBeCloseTo(250_000, 6);
    expect(paid(r, 'h4')).toBeCloseTo(750_000, 6);
    expect(paid(r, 'h1')).toBe(0);
  });

  it('splits a shortfall pro rata among pre-money SAFEs, after the notes', () => {
    const db = table({ securities: [
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 50_000, interestRate: 0, date: '2025-06-01' },
      safe({ safeType: 'pre', principal: 200_000 }),
      safe({ id: 'sf2', label: 'SAFE-2', stakeholderId: 'h6', safeType: 'pre', principal: 100_000 }),
    ] });
    const r = exitWaterfall(db, { exitValue: 200_000, asOf: ASOF });
    expect(r.debtRepaid).toBeCloseTo(50_000, 6);
    expect(row(r, 'sf1').proceeds).toBeCloseTo(100_000, 6);
    expect(row(r, 'sf2').proceeds).toBeCloseTo(50_000, 6);
    expect(r.preferencePaid).toBe(0);
    expect(r.distributed).toBeCloseTo(200_000, 6);
  });

  it('still converts when that pays more than the money back', () => {
    const r = exitWaterfall(table({ securities: [safe()] }), { exitValue: 50_000_000, asOf: ASOF });
    expect(row(r, 'sf1').elected).toBe('converted');
    expect(row(r, 'sf1').proceeds).toBeCloseTo(2_500_000, 2);
  });
});
