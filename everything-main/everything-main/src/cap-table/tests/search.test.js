import { describe, it, expect } from 'vitest';
import { rankResults, securitySummary } from '../src/ui/search.js';

/* Index rows in the shape buildIndex produces - title plus the fields the
   ranking reads. */
const row = (type, title, { primary = [title], secondary = [] } = {}) => ({
  type, title, primary, secondary, sub: '',
});

const index = [
  row('stakeholder', 'Ada Chen', { primary: ['Ada Chen'], secondary: ['ada@acme.example'] }),
  row('stakeholder', 'Sam Rivera', { primary: ['Sam Rivera'], secondary: ['sam@acme.example'] }),
  row('stakeholder', 'Adamson Holdings', { primary: ['Adamson Holdings'], secondary: [] }),
  row('security', 'CS-1', { primary: ['CS-1'], secondary: ['Ada Chen', 'Common Stock', 'Shares'] }),
  row('security', 'CS-14', { primary: ['CS-14'], secondary: ['Sam Rivera', 'Common Stock', 'Shares'] }),
  row('security', 'OPT-3', { primary: ['OPT-3'], secondary: ['Sam Rivera', 'Options'] }),
  row('class', 'Common Stock', { primary: ['Common Stock'], secondary: ['Common'] }),
  row('round', 'Series A (draft)', { primary: ['Series A (draft)'], secondary: ['round', 'scenario'] }),
  row('exit', 'Acquisition', { primary: ['Acquisition'], secondary: ['exit', 'scenario'] }),
  row('route', 'Settings', { primary: ['Settings'], secondary: ['settings'] }),
  row('route', 'Round modeling', { primary: ['Round modeling'], secondary: ['rounds'] }),
];

const titles = (query) => rankResults(index, query).groups.flatMap((g) => g.items.map((i) => i.title));

describe('rankResults', () => {
  it('folds accents on both sides, so a plain query finds an accented name', () => {
    const accented = [
      row('stakeholder', 'Zoë Müller', { primary: ['Zoë Müller'], secondary: [] }),
      row('stakeholder', 'José Núñez', { primary: ['José Núñez'], secondary: [] }),
    ];
    const found = (q) => rankResults(accented, q).groups.flatMap((g) => g.items.map((i) => i.title));
    expect(found('muller')).toEqual(['Zoë Müller']);
    expect(found('zoe')).toEqual(['Zoë Müller']);
    expect(found('nunez')).toEqual(['José Núñez']);
    expect(found('Núñez')).toEqual(['José Núñez']);
  });

  it('lists an equity plan under its own heading, not among the share classes', () => {
    const withPlan = [...index, row('plan', '2024 Equity Incentive Plan', { primary: ['2024 Equity Incentive Plan'], secondary: ['plan', 'equity plan', 'option pool'] })];
    const { groups } = rankResults(withPlan, 'equity');
    expect(groups.map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([['Equity plans', ['2024 Equity Incentive Plan']]]);
    expect(rankResults(withPlan, 'common').groups.map((g) => g.label)).toEqual(['Share classes', 'Securities']);
  });

  it('offers every route as a jump on an empty query', () => {
    const { groups } = rankResults(index, '');
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('route');
    expect(groups[0].items.map((i) => i.title)).toEqual(['Settings', 'Round modeling']);
  });

  it('ranks an exact label above a prefix and a substring of it', () => {
    // CS-1 exactly; CS-14 only has it as a prefix.
    expect(titles('cs-1')).toEqual(['CS-1', 'CS-14']);
  });

  it('ranks a name prefix above a word-start match', () => {
    expect(titles('ada').slice(0, 2)).toEqual(['Ada Chen', 'Adamson Holdings']);
  });

  it('finds a holder by their email', () => {
    expect(titles('sam@acme')).toEqual(['Sam Rivera']);
  });

  it('puts a record ahead of the records that merely mention it', () => {
    // "Common Stock" is the class's own name and the class of two
    // certificates - the class itself has to lead.
    expect(titles('common stock')[0]).toBe('Common Stock');
  });

  it('finds a security by its holder and by its class', () => {
    expect(titles('rivera')).toEqual(['Sam Rivera', 'CS-14', 'OPT-3']);
  });

  it('leads with the group whose match was best', () => {
    expect(rankResults(index, 'opt-3').groups[0].type).toBe('security');
    expect(rankResults(index, 'chen').groups[0].type).toBe('stakeholder');
  });

  it('matches every word of a multi-word query in any order', () => {
    expect(titles('sam opt')).toEqual(['OPT-3']);
  });

  it('searches the routes too', () => {
    expect(titles('settings')).toEqual(['Settings']);
    expect(titles('round mod')).toEqual(['Round modeling']);
  });

  it('finds nothing for a query nothing matches', () => {
    const { groups, total } = rankResults(index, 'zzz');
    expect(groups).toEqual([]);
    expect(total).toBe(0);
  });

  it('caps each group and reports what it left out', () => {
    const many = Array.from({ length: 9 }, (_, i) => row('security', `CS-${i + 1}`));
    const { groups, total, shown } = rankResults(many, 'cs-');
    expect(total).toBe(9);
    expect(shown).toBe(6);
    expect(groups[0].total).toBe(9);
    expect(groups[0].items).toHaveLength(6);
  });
});

describe('securitySummary', () => {
  const asOf = '2026-09-06';

  it('names the size of a live record', () => {
    expect(securitySummary({ kind: 'shares', quantity: 3_800_000 }, asOf)).toBe('3,800,000 shares');
    expect(securitySummary({ kind: 'option', quantity: 120_000, exercised: 10_000 }, asOf)).toBe('120,000 options');
    expect(securitySummary({ kind: 'rsu', quantity: 12_000, settled: 4_000 }, asOf)).toBe('12,000 units');
    expect(securitySummary({ kind: 'warrant', quantity: 10_000, expires: '2030-01-01' }, asOf)).toBe('10,000 shares');
    expect(securitySummary({ kind: 'safe', principal: 250_000, date: '2025-11-05' }, asOf)).toBe('$250K');
  });

  it('says where a record stands once it is no longer what its size says', () => {
    /* A transferred certificate read "3,800,000 shares" beside a holder who no
       longer had them; a converted SAFE read as money waiting for a round. */
    expect(securitySummary({ kind: 'shares', quantity: 3_800_000, closedAt: '2026-06-01', closedReason: 'transfer' }, asOf))
      .toBe('3,800,000 shares · Transferred Jun 1, 2026');
    expect(securitySummary({ kind: 'shares', quantity: 200_000, closedAt: '2026-07-01', closedReason: 'repurchase' }, asOf))
      .toBe('200,000 shares · Repurchased Jul 1, 2026');
    expect(securitySummary({ kind: 'safe', principal: 250_000, date: '2025-11-05', convertedAt: '2026-09-05', convertedToId: 'x' }, asOf))
      .toBe('$250K · Converted');
    expect(securitySummary({ kind: 'option', quantity: 20_000, exercised: 0, expires: '2025-06-01' }, asOf))
      .toBe('20,000 options · Expired');
    expect(securitySummary({ kind: 'option', quantity: 20_000, exercised: 0, cancelled: 20_000, cancelledDate: '2026-01-01' }, asOf))
      .toBe('0 options · Cancelled');
    expect(securitySummary({ kind: 'option', quantity: 20_000, exercised: 20_000 }, asOf))
      .toBe('20,000 options · Fully exercised');
    expect(securitySummary({ kind: 'rsu', quantity: 12_000, settled: 12_000 }, asOf))
      .toBe('12,000 units · Fully settled');
    // A note settled at maturity and a lapsed warrant read as live before.
    expect(securitySummary({ kind: 'note', principal: 100_000, interestRate: 0, date: '2024-01-01', maturedAt: '2026-01-15' }, asOf))
      .toBe('$100K · Matured');
    expect(securitySummary({ kind: 'warrant', quantity: 10_000, expires: '2026-01-01' }, asOf))
      .toBe('10,000 shares · Expired');
  });
});
