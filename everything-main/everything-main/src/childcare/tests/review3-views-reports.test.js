// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from './helpers.js';
import { setupApp, mountView } from './review2-billing-helpers.js';

describe('reports: the printed date range', () => {
  it('follows the dates chosen after the report opened', async () => {
    await setupApp({});
    const reports = await import('../src/views/reports.js');
    const node = mountView(reports, {}, { r: 'absences', from: '2026-09-01', to: '2026-09-30' });
    const [from, to] = node.querySelectorAll('input[type=date]');
    from.value = '2026-10-01';
    to.value = '2026-10-12';
    to.dispatchEvent(new Event('change'));
    await tick(20);
    const printed = node.querySelector('.print-only').textContent;
    expect(printed).toContain('Oct 1, 2026 to Oct 12, 2026');
    expect(printed).not.toContain('Sep');
  });
});

describe('reports: Export CSV while the report builds', () => {
  it('waits for the report and then exports it', async () => {
    const { app } = await import('../src/app.js');
    const { button } = await import('./review2-billing-helpers.js');
    await setupApp({ collections: { students: [{ id: 's', firstName: 'Ada', status: 'active' }], 'attendance:2026-09-15': [{ id: 's-s', studentId: 's', absent: { reason: 'Sick' }, events: [] }] } });
    const read = app.store.read;
    app.store.read = async (names) => {
      await tick(30);
      return read(names);
    };
    const reports = await import('../src/views/reports.js');
    const node = mountView(reports, {}, { r: 'absences', from: '2026-09-01', to: '2026-09-30' });
    const blobs = [];
    const { createObjectURL } = URL;
    URL.createObjectURL = (b) => (blobs.push(b), '#download');
    try {
      button('Export CSV', node).click();
      await tick(80);
    } finally {
      URL.createObjectURL = createObjectURL;
    }
    expect(blobs).toHaveLength(1);
    const text = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(blobs[0]);
    });
    expect(text).toContain('Sick');
  });
});
