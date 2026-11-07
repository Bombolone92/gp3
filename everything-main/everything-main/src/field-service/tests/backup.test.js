import { describe, it, expect } from 'vitest';
import { validateBackup } from '../src/core/backup.js';

const backup = (collections, settings) => ({ format: 'field-service-backup', version: 1, collections, settings });

describe('backup validation', () => {
  it('accepts a normal backup', () => {
    expect(validateBackup(backup({ clients: [{ id: 'c1', firstName: 'Ann' }], team: [{ id: 't1', name: 'Sam' }] }, { company: { name: 'Acme' } }))).toBe(null);
    expect(validateBackup(backup({}))).toBe(null);
  });

  it('rejects files that are not backups', () => {
    for (const bad of [null, [], 'x', { format: 'other', collections: {} }, { format: 'field-service-backup' }]) expect(validateBackup(bad)).toMatch(/not a Field Service backup/);
  });

  it('rejects damaged records before anything is replaced', () => {
    expect(validateBackup(backup({ jobs: [null] }))).toMatch(/damaged record in jobs/);
    expect(validateBackup(backup({ jobs: [{ id: 5 }] }))).toMatch(/damaged/);
    for (const id of ['', 'job 1', 'a:b', 'x'.repeat(65)]) expect(validateBackup(backup({ jobs: [{ id }] })), id).toMatch(/damaged/);
    expect(validateBackup(backup({ jobs: {} }))).toMatch(/not a list/);
    expect(validateBackup(backup({ products: [{ id: 'p1' }] }))).toMatch(/without a name/);
  });

  it('rejects settings with the wrong shape', () => {
    expect(validateBackup(backup({}, { company: null }))).toMatch(/settings/);
    expect(validateBackup(backup({}, { taxes: {} }))).toMatch(/settings/);
    expect(validateBackup(backup({}, 'x'))).toMatch(/settings/);
  });
});
