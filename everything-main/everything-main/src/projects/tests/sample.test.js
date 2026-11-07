import { describe, it, expect } from 'vitest';
import { sampleProjectDoc } from '../src/lib/sample.js';
import { columnTasks, taskSpan } from '../src/lib/board.js';
import { isValidISO } from '../src/lib/dates.js';

describe('sampleProjectDoc', () => {
  const doc = sampleProjectDoc('Nadia', '2026-08-05');

  it('has every task in an existing column', () => {
    const colIds = new Set(doc.columns.map((c) => c.id));
    for (const t of doc.tasks) expect(colIds.has(t.columnId)).toBe(true);
  });

  it('references only existing members, labels, and milestones', () => {
    const memberIds = new Set(doc.members.map((m) => m.id));
    const labelIds = new Set(doc.labels.map((l) => l.id));
    const milestoneIds = new Set(doc.milestones.map((m) => m.id));
    for (const t of doc.tasks) {
      for (const id of t.assigneeIds) expect(memberIds.has(id)).toBe(true);
      for (const id of t.labelIds) expect(labelIds.has(id)).toBe(true);
      if (t.milestoneId) expect(milestoneIds.has(t.milestoneId)).toBe(true);
    }
  });

  it('has unique, collision-free ordering within each column', () => {
    for (const col of doc.columns) {
      const orders = columnTasks(doc.tasks, col.id).map((t) => t.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('uses valid ISO dates everywhere', () => {
    for (const m of doc.milestones) expect(isValidISO(m.date)).toBe(true);
    for (const t of doc.tasks) {
      if (t.startDate) expect(isValidISO(t.startDate)).toBe(true);
      if (t.dueDate) expect(isValidISO(t.dueDate)).toBe(true);
    }
  });

  it('shows a lively board: work in every column, dated and overdue tasks', () => {
    for (const col of doc.columns) {
      expect(columnTasks(doc.tasks, col.id).length).toBeGreaterThan(0);
    }
    expect(doc.tasks.some((t) => taskSpan(t))).toBe(true);
    expect(doc.tasks.some((t) => t.dueDate && t.dueDate < '2026-08-05')).toBe(true);
    expect(doc.tasks.some((t) => t.comments.length)).toBe(true);
    expect(doc.milestones.length).toBeGreaterThanOrEqual(2);
  });

  it('names the first member after the owner', () => {
    expect(doc.members[0].name).toBe('Nadia');
  });
});
