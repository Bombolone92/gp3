import { describe, it, expect } from 'vitest';
import { sampleDataset, wipeSampleData } from '../src/lib/sample.js';
import { auditActionLabel } from '../src/lib/audit.js';
import { puterBackend } from './helpers/puter-kv.js';
import { Store } from '../src/lib/store.js';
import { fullyDiluted, poolRemaining, ownershipByStakeholder } from '../src/lib/captable.js';
import { foldRows } from '../src/charts/ownership.js';

describe('sampleDataset', () => {
  const data = sampleDataset();

  it('survives the import sanitizers without losing anything', () => {
    const classes = Store.sanitizeClasses(data.classes);
    const stakeholders = Store.sanitizeStakeholders(data.stakeholders);
    const securities = Store.sanitizeSecurities(data.securities, { classes, stakeholders });
    expect(classes).toHaveLength(data.classes.length);
    expect(stakeholders).toHaveLength(data.stakeholders.length);
    expect(securities).toHaveLength(data.securities.length);
  });

  it('describes a coherent company', () => {
    const db = { company: data.company, classes: data.classes, stakeholders: data.stakeholders, securities: data.securities };
    // The pool covers every grant with room to spare.
    expect(poolRemaining(data.company.poolAuthorized, data.securities)).toBeGreaterThan(0);
    // Founders together hold a majority, fully diluted.
    const { rows } = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    const founderIds = new Set(data.stakeholders.filter((h) => h.kind === 'founder').map((h) => h.id));
    const founderPct = rows.filter((r) => founderIds.has(r.stakeholderId)).reduce((a, r) => a + r.pct, 0);
    expect(founderPct).toBeGreaterThan(0.5);
    expect(fullyDiluted(data.securities, data.company.poolAuthorized)).toBeGreaterThan(9_000_000);
  });

  it('regenerates fresh ids on every call', () => {
    const again = sampleDataset();
    expect(again.stakeholders[0].id).not.toBe(data.stakeholders[0].id);
  });

  it('journals the wipe under its own name, beside the load it undoes', async () => {
    puterBackend().install();
    const s = new Store();
    await s.init();
    await s.importAll(sampleDataset(), { label: 'Before loading sample data', operation: 'loadSampleData', settings: { sampleData: true, onboarded: true } });
    await wipeSampleData(s);
    const ops = (await s.exportAudit()).events.map((e) => e.operation);
    expect(ops).toEqual(['wipeSampleData', 'loadSampleData', 'baseline']);
    expect(auditActionLabel(ops[0])).toBe('Wipe sample data');
    expect(s.settings).toMatchObject({ sampleData: false, onboarded: false });
    expect(s.restorePoints.map((p) => p.label)).toEqual(['Before wiping sample data']);
  });
});

describe('foldRows (chart series budget)', () => {
  it('leaves small sets alone', () => {
    const rows = [{ name: 'A', shares: 1, pct: 0.5 }, { name: 'B', shares: 1, pct: 0.5 }];
    expect(foldRows(rows)).toHaveLength(2);
  });

  it('folds the tail into Other past the slot budget', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `H${i}`, shares: 10, pct: 1 / 12 }));
    const folded = foldRows(rows);
    expect(folded).toHaveLength(8);
    const other = folded.at(-1);
    expect(other.name).toContain('Other');
    expect(other.pct).toBeCloseTo(5 / 12, 10);
    // Percentages are conserved by the fold.
    expect(folded.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);
  });
});
