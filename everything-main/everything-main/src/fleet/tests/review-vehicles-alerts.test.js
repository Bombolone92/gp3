// @vitest-environment jsdom
/** The "needs attention" panel. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { computeAlerts } from '../src/views/alerts.js';

beforeAll(polyfill);

let veh;
let person;
beforeEach(async () => {
  await freshStore();
  veh = app.store.put('vehicles', { name: 'Van 1', archived: false });
  person = app.store.put('contacts', { firstName: 'Ana', lastName: 'Diaz', archived: false });
});

const titles = () => computeAlerts().items.map((i) => `${i.title} | ${i.sub}`);

describe('needs attention', () => {
  it('leaves out renewals of archived or deleted vehicles, like their service reminders', () => {
    app.store.put('renewals', { kind: 'vehicle', vehicleId: veh.id, type: 'Registration', dueDate: '2026-10-01' });
    expect(titles()).toEqual([expect.stringMatching(/^Registration overdue \| Van 1/)]);
    app.store.patch('vehicles', veh.id, { archived: true });
    expect(titles()).toEqual([]);
    app.store.remove('vehicles', veh.id);
    expect(titles()).toEqual([]);
    expect(computeAlerts().overdueRenewals).toBe(0);
  });

  it('leaves out renewals of archived or deleted contacts instead of showing a blank name', () => {
    app.store.put('renewals', { kind: 'contact', contactId: person.id, type: 'Driver license', dueDate: '2026-10-15' });
    expect(titles()).toEqual([expect.stringMatching(/^Driver license due soon \| Ana Diaz/)]);
    app.store.remove('contacts', person.id);
    expect(titles()).toEqual([]);
  });

  it('leaves out issues and work orders of archived vehicles, as the dashboard does', () => {
    app.store.put('issues', { vehicleId: veh.id, number: 1, summary: 'Brakes', status: 'open', priority: 'critical' });
    app.store.put('workOrders', { vehicleId: veh.id, number: 2, status: 'open', dueDate: '2026-10-01' });
    expect(titles().length).toBe(2);
    app.store.patch('vehicles', veh.id, { archived: true });
    expect(titles()).toEqual([]);
  });

  it('picks up a renamed contact or service task', () => {
    const task = app.store.put('serviceTasks', { name: 'Oil change' });
    app.store.put('reminders', { vehicleId: veh.id, taskId: task.id, interval: { every: 1, unit: 'months' }, lastDate: '2026-01-01', history: [] });
    app.store.put('renewals', { kind: 'contact', contactId: person.id, type: 'Driver license', dueDate: '2026-10-01' });
    expect(titles().join('\n')).toMatch(/Oil change overdue/);
    app.store.patch('serviceTasks', task.id, { name: 'Engine oil' });
    app.store.patch('contacts', person.id, { lastName: 'Ruiz' });
    expect(titles().join('\n')).toMatch(/Engine oil overdue/);
    expect(titles().join('\n')).toMatch(/Ana Ruiz/);
  });
});
