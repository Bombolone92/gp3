import { describe, it, expect } from 'vitest';
import {
  hasReminder, reminderDate, reminderPending, collectReminders, REMINDER_OFFSETS,
} from '../src/lib/reminders.js';

const TODAY = '2026-08-06';

const task = (patch = {}) => ({
  id: 't1', title: 'Thing', columnId: 'todo',
  dueDate: null, remindOffset: null, remindedOn: null, ...patch,
});

describe('reminderDate', () => {
  it('is the due date minus the offset', () => {
    expect(reminderDate(task({ dueDate: '2026-08-10', remindOffset: 0 }))).toBe('2026-08-10');
    expect(reminderDate(task({ dueDate: '2026-08-10', remindOffset: 2 }))).toBe('2026-08-08');
    expect(reminderDate(task({ dueDate: '2026-08-10', remindOffset: 7 }))).toBe('2026-08-03');
  });

  it('needs both a due date and an offset', () => {
    expect(reminderDate(task({ remindOffset: 1 }))).toBeNull();
    expect(reminderDate(task({ dueDate: '2026-08-10' }))).toBeNull();
    expect(hasReminder(task({ dueDate: '2026-08-10', remindOffset: 0 }))).toBe(true);
    expect(hasReminder(task({ dueDate: '2026-08-10' }))).toBe(false);
  });

  it('offers only the documented offsets', () => {
    expect(REMINDER_OFFSETS.map((o) => o.value)).toEqual([0, 1, 2, 7]);
  });
});

describe('reminderPending', () => {
  const at = (dueDate, remindOffset, extra) => task({ dueDate, remindOffset, ...extra });

  it('waits until the reminder day arrives', () => {
    expect(reminderPending(at('2026-08-10', 1), { today: TODAY })).toBe(false);
    expect(reminderPending(at('2026-08-07', 1), { today: TODAY })).toBe(true);
  });

  it('still fires for a day that already passed — nothing is missed', () => {
    // Reminder was due on the 1st; opening the app on the 6th must show it.
    expect(reminderPending(at('2026-08-02', 1), { today: TODAY })).toBe(true);
  });

  it('fires once a day at most', () => {
    const t = at('2026-08-06', 0, { remindedOn: TODAY });
    expect(reminderPending(t, { today: TODAY })).toBe(false);
    expect(reminderPending({ ...t, remindedOn: '2026-08-05' }, { today: TODAY })).toBe(true);
  });

  it('says nothing about a finished task', () => {
    expect(reminderPending(at('2026-08-06', 0), { today: TODAY, done: true })).toBe(false);
  });

  it('says nothing about a task with no reminder', () => {
    expect(reminderPending(task({ dueDate: '2026-08-01' }), { today: TODAY })).toBe(false);
  });
});

describe('collectReminders', () => {
  const doc = (tasks) => ({
    columns: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done', done: true }],
    tasks,
  });

  it('gathers pending reminders across projects, earliest deadline first', () => {
    const sources = [
      {
        entry: { id: 'p1', name: 'Launch' },
        doc: doc([
          task({ id: 'a', dueDate: '2026-08-09', remindOffset: 7 }),
          task({ id: 'b', dueDate: '2026-08-06', remindOffset: 0 }),
          task({ id: 'skip-done', columnId: 'done', dueDate: '2026-08-01', remindOffset: 0 }),
          task({ id: 'skip-future', dueDate: '2026-09-01', remindOffset: 0 }),
        ]),
      },
      {
        entry: { id: 'p2', name: 'Archived', archived: true },
        doc: doc([task({ id: 'hidden', dueDate: '2026-08-01', remindOffset: 0 })]),
      },
    ];
    expect(collectReminders(sources, TODAY).map((r) => `${r.projectName}:${r.task.id}`))
      .toEqual(['Launch:b', 'Launch:a']);
  });

  it('ignores projects that are not loaded', () => {
    expect(collectReminders([{ entry: { id: 'p1' }, doc: null }], TODAY)).toEqual([]);
  });
});
