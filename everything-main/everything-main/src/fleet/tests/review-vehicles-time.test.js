// @vitest-environment jsdom
/** Times shown on vehicle pages are local, not UTC. */
import { it, expect, beforeAll } from 'vitest';
import { polyfill, freshStore, viewCtx, settle } from './review-vehicles-setup.js';
import { app } from '../src/app.js';

process.env.TZ = 'America/Los_Angeles';
beforeAll(polyfill);

it("shows an inspection's start time in local time on the vehicle's Inspections tab", async () => {
  await freshStore({ sample: true });
  for (const i of app.store.all('inspections').filter((x) => x.vehicleId === 'v101')) app.store.remove('inspections', i.id);
  // Started at 8:05 in the morning in Los Angeles, stored as UTC like a real submission.
  app.store.put('inspections', { vehicleId: 'v101', formId: 'if-pretrip', formName: 'Pre-trip', date: '2026-10-12', startedAt: '2026-10-12T15:05:00.000Z', submittedAt: '2026-10-12T15:15:00.000Z', results: [], failed: 0 });
  const { render } = await import('../src/views/vehicle-detail.js');
  const out = render(viewCtx({ params: { id: 'v101' }, query: { tab: 'inspections' } }));
  document.querySelector('main').replaceChildren(out.node);
  await settle();
  const cell = out.node.querySelector('tbody td');
  expect(cell.textContent).toMatch(/8:05/);
});

it('dates a document by the day it was added where the viewer is', async () => {
  await freshStore();
  // Added at 8 p.m. on Oct 11 in Los Angeles, which is already Oct 12 in UTC.
  app.store.put('vehicles', { name: 'Van 1', archived: false, attachments: [{ id: 'f1', name: 'title.pdf', type: 'application/pdf', size: 10, path: 'files/vehicles/f1-title.pdf', createdAt: '2026-10-12T03:00:00.000Z' }] });
  localStorage.clear();
  const { render } = await import('../src/views/documents.js');
  const out = render(viewCtx());
  document.querySelector('main').replaceChildren(out.node);
  await settle();
  const cells = [...out.node.querySelectorAll('tbody td')].map((td) => td.textContent);
  expect(cells).toContain('Oct 11, 2026');
});
