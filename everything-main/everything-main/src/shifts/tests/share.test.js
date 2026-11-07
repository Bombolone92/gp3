import { describe, it, expect } from 'vitest';
import { buildWeekSnapshot } from '../src/core/share.js';
import { defaultAvailability } from '../src/core/scheduling.js';

const offMonday = () => {
  const availability = defaultAvailability();
  availability.days[1] = { off: true, start: '09:00', end: '17:00' };
  return availability;
};

const state = {
  employees: [
    { id: 'e1', name: 'Ava <script>alert(1)</script>', role: 'Lead & "Boss"', active: true },
    { id: 'e2', name: 'Liam', role: 'Barista', active: true },
    { id: 'e3', name: 'Gone', role: '', active: false },
  ],
  shifts: [
    { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1' },
    { id: 's2', date: '2026-08-04', start: '22:00', end: '06:00', role: 'Night', assigneeId: 'e2' },
    { id: 's3', date: '2026-08-05', start: '12:00', end: '20:00', role: 'Close', assigneeId: null },
  ],
  availability: {
    e2: { ...offMonday(), exceptions: [{ id: 'x', from: '2026-08-07', to: '2026-08-08', note: 'Trip' }] },
  },
};

describe('buildWeekSnapshot', () => {
  const html = buildWeekSnapshot(state, '2026-08-03', { generatedAt: '2026-08-04' });

  it('escapes user content everywhere', () => {
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Ava &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Lead &amp; &quot;Boss&quot;');
  });

  it('renders active employees, open shifts, and overnight markers', () => {
    expect(html).toContain('Open shifts');
    expect(html).toContain('10 PM – 6 AM +1');
    expect(html).not.toContain('>Gone<'); // inactive employees are excluded
  });

  it('marks time off and weekly off days', () => {
    expect(html).toContain('Time off');
    expect(html).toContain('>Off<');
  });

  it('is a complete standalone document with a filter option per employee', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('meta name="robots" content="noindex"');
    expect((html.match(/<option value="e/g) ?? []).length).toBe(2);
    expect(html).toContain('Aug 3 – Sun, Aug 9'.replace('Aug 3 – Sun', 'Mon, Aug 3 – Sun'));
  });

  it('labels a cleared role instead of leaving a dangling separator', () => {
    const cleared = {
      employees: [{ id: 'a1', name: 'Ava', role: 'Lead', active: true }],
      shifts: [
        { id: 's1', date: '2026-08-04', start: '09:00', end: '17:00', role: '', assigneeId: 'a1', breakMinutes: 30 },
      ],
      availability: {},
    };
    const page = buildWeekSnapshot(cleared, '2026-08-03', { generatedAt: '2026-08-04' });
    expect(page).toContain('No role · 30m break');
    expect(page).not.toContain('<i> · ');
  });

  it('keeps shifts assigned to deleted employees in a shared row', () => {
    const withFormer = {
      employees: [{ id: 'a1', name: 'Ava', role: 'Lead', active: true }],
      shifts: [
        { id: 's1', date: '2026-08-04', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'a1' },
        { id: 's2', date: '2026-08-05', start: '10:00', end: '18:00', role: 'Close', assigneeId: 'gone' },
      ],
      availability: {},
    };
    const page = buildWeekSnapshot(withFormer, '2026-08-03', { generatedAt: '2026-08-04' });
    expect(page).toContain('Former employees');
    expect(page).toContain('10 AM – 6 PM');
    // The row is not offered in the employee filter.
    expect(page).not.toContain('<option value="__former"');

    const withoutFormer = buildWeekSnapshot(state, '2026-08-03', { generatedAt: '2026-08-04' });
    expect(withoutFormer).not.toContain('Former employees');
  });

  it('keeps rows for archived employees who still hold shifts that week', () => {
    const withArchived = {
      employees: [
        { id: 'a1', name: 'Ava', role: 'Lead', active: true },
        { id: 'a2', name: 'Retired Rae', role: 'Server', active: false },
        { id: 'a3', name: 'Idle Archie', role: 'Cook', active: false },
      ],
      shifts: [
        { id: 's1', date: '2026-08-04', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'a2' },
      ],
      availability: {},
    };
    const page = buildWeekSnapshot(withArchived, '2026-08-03', { generatedAt: '2026-08-04' });
    expect(page).toContain('Retired Rae');
    expect(page).toContain('Server · Archived');
    expect(page).not.toContain('Idle Archie'); // archived without shifts stays out
  });
});
