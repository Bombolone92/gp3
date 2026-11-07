import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildBackup, validateBackup } from '../src/core/backup.js';

let backend;
let store;

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend, {
    now: () => '2026-08-04T09:00:00.000Z',
    today: () => '2026-08-04',
  });
  await store.init();
});

describe('employee contact details', () => {
  it('stores a trimmed email and phone, and defaults both to empty', async () => {
    const withContact = await store.addEmployee({
      name: 'Ava',
      email: '  ava@example.com ',
      phone: ' +1 (555) 010-1234 ',
    });
    expect(withContact.email).toBe('ava@example.com');
    expect(withContact.phone).toBe('+1 (555) 010-1234');

    const without = await store.addEmployee({ name: 'Liam' });
    expect(without.email).toBe('');
    expect(without.phone).toBe('');
  });

  it('rejects an address or number that cannot be dialled or mailed', async () => {
    await expect(store.addEmployee({ name: 'Ava', email: 'not-an-address' })).rejects.toThrow(
      /email address/i
    );
    await expect(store.addEmployee({ name: 'Ava', email: 'a@b' })).rejects.toThrow(/email address/i);
    await expect(store.addEmployee({ name: 'Ava', phone: 'call the shop' })).rejects.toThrow(
      /phone number/i
    );
    // Nothing was written by the rejected calls.
    expect(store.state.employees).toEqual([]);
  });

  it('updates and clears contact details without touching the rest', async () => {
    const ava = await store.addEmployee({
      name: 'Ava',
      role: 'Lead',
      email: 'ava@example.com',
      phone: '555 0101',
      targetHours: 32,
    });
    await store.updateEmployee(ava.id, { email: 'ava.chen@example.com' });
    expect(store.state.employees[0]).toMatchObject({
      email: 'ava.chen@example.com',
      phone: '555 0101',
      role: 'Lead',
      targetHours: 32,
    });

    await store.updateEmployee(ava.id, { email: '', phone: '' });
    expect(store.state.employees[0]).toMatchObject({ email: '', phone: '' });
    expect(backend.peek('employees')[0].email).toBe('');
  });

  it('leaves a bad edit with the record untouched', async () => {
    const ava = await store.addEmployee({ name: 'Ava', email: 'ava@example.com' });
    await expect(store.updateEmployee(ava.id, { email: 'nope' })).rejects.toThrow(/email/i);
    expect(store.state.employees[0].email).toBe('ava@example.com');
  });
});

describe('backups from before contact details existed', () => {
  it('still validate and import, leaving the fields simply absent', async () => {
    const older = {
      app: 'shifts',
      schemaVersion: 1,
      exportedAt: '2026-07-01T00:00:00.000Z',
      employees: [{ id: 'e1', name: 'Ava', role: 'Lead', color: '#000', active: true }],
      shifts: [],
      availability: {},
      swaps: [],
      attendance: {},
      settings: { currency: 'USD' },
    };
    expect(validateBackup(older)).toEqual([]);
    await store.importData(older);
    expect(store.state.employees[0].name).toBe('Ava');
    expect(store.state.employees[0].email).toBeUndefined();
  });

  it('round-trips contact details through a backup', async () => {
    await store.addEmployee({ name: 'Ava', email: 'ava@example.com', phone: '555 0101' });
    const backup = buildBackup(store.state, { exportedAt: '2026-08-04T09:00:00.000Z' });
    expect(validateBackup(backup)).toEqual([]);

    const other = createStore(createMemoryBackend());
    await other.init();
    await other.importData(JSON.parse(JSON.stringify(backup)));
    expect(other.state.employees[0]).toMatchObject({
      email: 'ava@example.com',
      phone: '555 0101',
    });
  });
});
