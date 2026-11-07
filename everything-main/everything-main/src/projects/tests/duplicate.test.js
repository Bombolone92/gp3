import { describe, it, expect } from 'vitest';
import { cloneTaskFields, cloneProjectDoc, templateFromDoc } from '../src/lib/duplicate.js';

const sourceDoc = () => ({
  v: 1,
  id: 'p1',
  name: 'Launch',
  color: '#4f63f0',
  brief: 'Relaunch the marketing site. Done means it is live.',
  members: [{ id: 'm1', name: 'Maya', color: '#0d9488' }, { id: 'm2', name: 'Leo', color: '#d97706' }],
  labels: [{ id: 'l1', name: 'Design', color: '#7c53c9' }],
  columns: [
    { id: 'c1', name: 'To do', done: false },
    { id: 'c2', name: 'Done', done: true },
  ],
  milestones: [{ id: 'ms1', name: 'Beta', date: '2026-09-01', done: false }],
  tasks: [
    {
      id: 't1', title: 'Wireframes', description: 'Sketch it', columnId: 'c1', order: 1024,
      assigneeIds: ['m1', 'gone'], labelIds: ['l1'], priority: 'high',
      startDate: '2026-08-01', dueDate: '2026-08-09', milestoneId: 'ms1',
      checklist: [{ id: 'i1', text: 'Home', done: true }],
      comments: [{ id: 'cm1', author: 'Maya', text: 'nice', createdAt: 1 }],
      attachments: [{ id: 'a1', name: 'spec.pdf', size: 10, type: 'application/pdf' }],
      createdAt: 1, updatedAt: 2,
    },
    { id: 't2', title: 'Ship', columnId: 'c2', order: 2048, assigneeIds: [], labelIds: [], comments: [], attachments: [] },
  ],
  archive: [{ id: 'old', title: 'Archived thing' }],
  trash: [{ id: 'dead', title: 'Deleted thing' }],
});

describe('cloneTaskFields', () => {
  it('carries the plan but not the conversation', () => {
    const fields = cloneTaskFields(sourceDoc().tasks[0]);
    expect(fields).toMatchObject({
      description: 'Sketch it', priority: 'high', dueDate: '2026-08-09', milestoneId: 'ms1',
    });
    expect(fields.comments).toBeUndefined();
    expect(fields.attachments).toBeUndefined();
    expect(fields.checklist[0]).toMatchObject({ text: 'Home', done: true });
    expect(fields.checklist[0].id).not.toBe('i1');
  });

  it('can reset checklist ticks for a fresh run', () => {
    const fields = cloneTaskFields(sourceDoc().tasks[0], { resetChecklist: true });
    expect(fields.checklist.map((i) => i.done)).toEqual([false]);
  });

  it('carries whether a repeat series has already handed over', () => {
    const spent = { title: 'Chore', recurrence: { freq: 'weekly', interval: 1 }, recurrenceClosed: true };
    expect(cloneTaskFields(spent).recurrenceClosed).toBe(true);
    expect(cloneTaskFields({ title: 'Chore' }).recurrenceClosed).toBe(false);
  });

  it('copies arrays instead of sharing them', () => {
    const task = sourceDoc().tasks[0];
    const fields = cloneTaskFields(task);
    fields.labelIds.push('l2');
    expect(task.labelIds).toEqual(['l1']);
  });

  it('tolerates a task written before checklists existed', () => {
    expect(cloneTaskFields({ title: 'Old' }).checklist).toEqual([]);
  });
});

describe('cloneProjectDoc', () => {
  it('remaps every id and reference', () => {
    const copy = cloneProjectDoc(sourceDoc(), { name: 'Launch (copy)' });
    expect(copy.name).toBe('Launch (copy)');
    expect(copy.id).not.toBe('p1');
    expect(copy.members.map((m) => m.id)).not.toContain('m1');
    expect(copy.columns.map((c) => c.name)).toEqual(['To do', 'Done']);

    const task = copy.tasks.find((t) => t.title === 'Wireframes');
    expect(task.columnId).toBe(copy.columns[0].id);
    expect(task.milestoneId).toBe(copy.milestones[0].id);
    expect(task.assigneeIds).toEqual([copy.members[0].id]); // 'gone' dropped
    expect(task.labelIds).toEqual([copy.labels[0].id]);
    expect(task.id).not.toBe('t1');
  });

  it('drops comments, attachments, archive, and trash', () => {
    const copy = cloneProjectDoc(sourceDoc());
    expect(copy.tasks.every((t) => t.comments.length === 0)).toBe(true);
    expect(copy.tasks.every((t) => t.attachments.length === 0)).toBe(true);
    expect(copy.archive).toEqual([]);
    expect(copy.trash).toEqual([]);
  });

  it('keeps board order intact', () => {
    const copy = cloneProjectDoc(sourceDoc());
    expect(copy.tasks.map((t) => t.order)).toEqual([1024, 2048]);
  });

  it('can copy the structure only', () => {
    const copy = cloneProjectDoc(sourceDoc(), { includeTasks: false });
    expect(copy.tasks).toEqual([]);
    expect(copy.columns).toHaveLength(2);
    expect(copy.labels).toHaveLength(1);
    expect(copy.milestones).toHaveLength(1);
  });

  it('leaves the source untouched', () => {
    const source = sourceDoc();
    cloneProjectDoc(source);
    expect(source.tasks[0].id).toBe('t1');
    expect(source.tasks[0].comments).toHaveLength(1);
  });
});

describe('the brief', () => {
  it('travels with a duplicated project', () => {
    expect(cloneProjectDoc(sourceDoc()).brief)
      .toBe('Relaunch the marketing site. Done means it is live.');
  });

  it('is part of what a template carries, since it is the ground rules', () => {
    expect(templateFromDoc(sourceDoc(), 'Site launch').doc.brief)
      .toBe('Relaunch the marketing site. Done means it is live.');
  });

  it('defaults to empty for a document written before briefs existed', () => {
    const { brief, ...old } = sourceDoc();
    expect(cloneProjectDoc(old).brief).toBe('');
  });
});

describe('templateFromDoc', () => {
  it('stores a task-free structure with counts for the picker', () => {
    const template = templateFromDoc(sourceDoc(), 'Client engagement');
    expect(template.name).toBe('Client engagement');
    expect(template.doc.tasks).toEqual([]);
    expect(template.columnCount).toBe(2);
    expect(template.labelCount).toBe(1);
    expect(template.milestoneCount).toBe(1);
  });
});
