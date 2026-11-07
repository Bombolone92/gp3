import { describe, it, expect } from 'vitest';
import { buildBackup, parseBackup, isFirmEmpty } from '../src/core/settings-backup.js';
import { COLLECTIONS } from '../src/core/store.js';
import { defaultSettings, mergeSettings, practiceAreaName, stageName, categoryName } from '../src/core/settings.js';

describe('backups', () => {
  it('round-trips every collection and settings', () => {
    const data = buildBackup({ collections: { matters: [{ id: 'm1', description: 'A' }], contacts: [{ id: 'c1' }] }, settings: { currency: 'CAD' }, exportedAt: '2026-10-12T00:00:00.000Z' });
    expect(Object.keys(data.collections)).toEqual(COLLECTIONS);
    const out = parseBackup(JSON.stringify(data));
    expect(out.settings).toEqual({ currency: 'CAD' });
    expect(out.collections.matters).toEqual([{ id: 'm1', description: 'A' }]);
    expect(out.counts.contacts).toBe(1);
    expect(out.counts.bills).toBe(0);
    expect(out.exportedAt).toBe('2026-10-12T00:00:00.000Z');
  });

  it('rejects files that are not backups from this app', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackup(JSON.stringify({ app: 'other' }))).toThrow(/not a backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'legal', version: 99 }))).toThrow(/newer version/);
  });

  it('drops unknown collections and records without a safe id', () => {
    const out = parseBackup(JSON.stringify({ app: 'legal', version: 1, collections: { matters: [{ id: 'ok' }, { id: '../../x' }, null, { name: 'no id' }], secrets: [{ id: 's' }] }, settings: [] }));
    expect(out.collections.matters).toEqual([{ id: 'ok' }]);
    expect(out.collections.secrets).toBeUndefined();
    expect(out.settings).toBeNull();
  });

  it('treats a firm with only users and accounts as empty', () => {
    const data = { users: [{ id: 'u' }], accounts: [{ id: 'a' }] };
    expect(isFirmEmpty((c) => data[c])).toBe(true);
    expect(isFirmEmpty((c) => ({ ...data, contacts: [{ id: 'c' }] })[c])).toBe(false);
  });

  it('keeps only settings of the expected type, so a damaged file cannot break the app', () => {
    const settings = {
      currency: 'CAD',
      practiceAreas: null,
      stages: [null, { id: 'st-x', name: 'Custom stage' }],
      activityCategories: 'none',
      documentCategories: ['Pleadings', 7, null],
      customFields: [null, { id: 'f1', entity: 'matter', label: 'Court', type: 'text' }],
      billing: { increment: '6', termsDays: 15, taxName: null },
      numbering: 'x',
      firm: { name: 'Hartley Law', phone: { n: 1 } },
    };
    const out = parseBackup(JSON.stringify({ app: 'legal', version: 1, settings }));
    const merged = mergeSettings(defaultSettings(), out.settings);
    expect(merged.currency).toBe('CAD');
    expect(practiceAreaName(merged, 'pa-lit')).toBe('Litigation');
    expect(stageName(merged, 'pa-lit', 'st-x')).toBe('Custom stage');
    expect(categoryName(merged, 'ac-draft')).toBe('Drafting');
    expect(merged.documentCategories).toEqual(['Pleadings']);
    expect(merged.customFields).toEqual([{ id: 'f1', entity: 'matter', label: 'Court', type: 'text' }]);
    expect(merged.billing).toMatchObject({ increment: 6, termsDays: 15, taxName: 'Tax' });
    expect(merged.numbering).toEqual(defaultSettings().numbering);
    expect(merged.firm).toMatchObject({ name: 'Hartley Law', phone: '' });
  });

  it('keeps the current currency when a backup names one that is not a currency code', () => {
    const parse = (currency) => parseBackup(JSON.stringify({ app: 'legal', version: 1, settings: { currency, firm: { name: 'A' } } })).settings;
    expect(parse('EURO')).toEqual({ firm: { name: 'A' } });
    expect(parse('')).toEqual({ firm: { name: 'A' } });
    expect(parse('JPY')).toEqual({ currency: 'JPY', firm: { name: 'A' } });
  });

  it('drops records whose id is not text, since links and lookups use text ids', () => {
    const out = parseBackup(JSON.stringify({ app: 'legal', version: 1, collections: { matters: [{ id: 5 }, { id: 'm5' }] } }));
    expect(out.collections.matters).toEqual([{ id: 'm5' }]);
  });
});
