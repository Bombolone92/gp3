import { describe, it, expect } from 'vitest';
import {
  parseCsv, detectColumns, csvToProject, meansDone, readPriority, readDate,
} from '../src/lib/csvimport.js';
import { prepareImportedProject } from '../src/lib/backup.js';
import { todayISO } from '../src/lib/dates.js';

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads quoted cells with commas, quotes, and newlines in them', () => {
    const rows = parseCsv('name,note\n"Ship, then celebrate","He said ""hi""\nthen left"\n');
    expect(rows[1]).toEqual(['Ship, then celebrate', 'He said "hi"\nthen left']);
  });

  it('copes with CRLF, a BOM, and a missing trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops blank lines rather than making empty tasks of them', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty cells inside a row', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
});

describe('detectColumns', () => {
  it('recognizes an Asana export', () => {
    const headers = ['Task ID', 'Created At', 'Completed At', 'Name', 'Section/Column',
      'Assignee', 'Start Date', 'Due Date', 'Tags', 'Notes', 'Priority'];
    const mapping = detectColumns(headers);
    expect(mapping[headers.indexOf('Name')]).toBe('title');
    expect(mapping[headers.indexOf('Section/Column')]).toBe('column');
    expect(mapping[headers.indexOf('Assignee')]).toBe('assignee');
    expect(mapping[headers.indexOf('Start Date')]).toBe('start');
    expect(mapping[headers.indexOf('Due Date')]).toBe('due');
    expect(mapping[headers.indexOf('Tags')]).toBe('labels');
    expect(mapping[headers.indexOf('Notes')]).toBe('description');
    expect(mapping[headers.indexOf('Priority')]).toBe('priority');
    expect(mapping[headers.indexOf('Completed At')]).toBe('done');
  });

  it('gives one field to one column only', () => {
    const mapping = detectColumns(['Name', 'Task Name', 'Title']);
    expect(mapping.filter((m) => m === 'title')).toHaveLength(1);
  });

  it('leaves a column it cannot place alone', () => {
    const mapping = detectColumns(['Name', 'Sprint velocity', 'Blocked By']);
    expect(mapping).toEqual(['title', null, null]);
  });
});

describe('reading single values', () => {
  it('reads what "done" means in the wild', () => {
    expect(meansDone('yes')).toBe(true);
    expect(meansDone('TRUE')).toBe(true);
    expect(meansDone('2026-08-01T10:00:00Z')).toBe(true); // Asana's completion stamp
    expect(meansDone('')).toBe(false);
    expect(meansDone('no')).toBe(false);
    expect(meansDone(undefined)).toBe(false);
  });

  it('maps priorities onto the four this app has', () => {
    expect(readPriority('High')).toBe('high');
    expect(readPriority('critical')).toBe('urgent');
    expect(readPriority('P2')).toBe('medium');
    expect(readPriority('')).toBe(null);
    // Said something, but not something usable — the report counts these.
    expect(readPriority('Spicy')).toBe(false);
  });

  it('accepts only unambiguous dates', () => {
    expect(readDate('2026-08-25')).toBe('2026-08-25');
    expect(readDate('2026-08-25T10:00:00Z')).toBe('2026-08-25');
    expect(readDate('2026/08/25')).toBe('2026-08-25');
    expect(readDate('')).toBe(null);
    expect(readDate('03/04/26')).toBe(false);
    expect(readDate('next Tuesday')).toBe(false);
    expect(readDate('2026-02-31')).toBe(false);
  });
});

describe('csvToProject', () => {
  const rows = () => parseCsv([
    'Name,Section/Column,Assignee,Due Date,Priority,Tags,Notes,Completed At,Milestone',
    'Wireframes,Design,Maya Chen,2026-08-25,High,"design, ux",Sketch the flows,,Beta',
    'Ship it,Engineering,Leo Park,2026-09-01,Spicy,,,2026-08-01,Beta',
    ',Design,,,,,orphan row,,',
    'No dates,Design,Maya Chen,next week,,,,,',
  ].join('\n'));

  const build = () => {
    const parsed = rows();
    return csvToProject(parsed, detectColumns(parsed[0]), { name: 'From CSV', now: 1000 });
  };

  it('turns rows into tasks, skipping the ones with no title', () => {
    const { doc, report } = build();
    expect(doc.tasks.map((t) => t.title)).toEqual(['Wireframes', 'Ship it', 'No dates']);
    expect(report.skippedRows).toBe(1);
    expect(report.tasks).toBe(3);
  });

  /* A finished row goes to a Done column rather than the section it names:
     in this app the column is what "done" means, and a task cannot be both
     in Engineering and finished. */
  it('puts a finished row in a Done column of its own', () => {
    const { doc } = build();
    const done = doc.columns.find((c) => c.done);
    expect(done.name).toBe('Done');
    expect(doc.columns.map((c) => c.name)).toEqual(['Design', 'Done']);
    expect(doc.tasks.find((t) => t.title === 'Ship it').columnId).toBe(done.id);
    expect(doc.tasks.find((t) => t.title === 'Wireframes').columnId).not.toBe(done.id);
  });

  it('keeps a section that has unfinished work in it', () => {
    const parsed = parseCsv('Name,Section,Completed\nOne,Engineering,\nTwo,Design,yes\n');
    const { doc } = csvToProject(parsed, detectColumns(parsed[0]), { name: 'x' });
    expect(doc.columns.map((c) => c.name)).toEqual(['Engineering', 'Done']);
  });

  it('collects members, labels, and milestones by name', () => {
    const { doc, report } = build();
    expect(doc.members.map((m) => m.name).sort()).toEqual(['Leo Park', 'Maya Chen']);
    expect(doc.labels.map((l) => l.name)).toEqual(['design', 'ux']);
    expect(report.labels).toBe(2);
    expect(doc.milestones).toHaveLength(1);
    expect(doc.milestones[0].name).toBe('Beta');
    // A milestone here is a dated target: it takes the latest date pointing at it.
    expect(doc.milestones[0].date).toBe('2026-09-01');
  });

  it('dates a milestone that has no dated work today, and says so', () => {
    const parsed = parseCsv('Name,Milestone\nOne,Later\n');
    const { doc, report } = csvToProject(parsed, detectColumns(parsed[0]), { name: 'x' });
    expect(doc.milestones[0].date).toBe(todayISO());
    expect(report.notes.join(' ')).toContain('dated today');
  });

  it('counts what it could not read rather than guessing', () => {
    const { report } = build();
    expect(report.unreadableDates).toBe(1);
    expect(report.unreadablePriorities).toBe(1);
    expect(report.notes.join(' ')).toContain('could not be read');
    expect(report.notes.join(' ')).toContain('did not match Urgent');
  });

  it('says how many columns of the file were left behind', () => {
    const parsed = parseCsv('Name,Sprint,Velocity\nOne,3,8\n');
    const { report } = csvToProject(parsed, detectColumns(parsed[0]), { name: 'x' });
    expect(report.notes.join(' ')).toContain('2 columns in the file were not imported');
  });

  it('says it in the singular when there is one of something', () => {
    const parsed = parseCsv('Name,Sprint\nOne,3\n');
    const { report } = csvToProject(parsed, detectColumns(parsed[0]), { name: 'x' });
    expect(report.notes.join(' ')).toContain('1 column in the file was not imported');
  });

  it('writes a document the store will accept as it is', () => {
    const { doc } = build();
    const { doc: prepared } = prepareImportedProject(doc, { entry: { name: doc.name } });
    expect(prepared.tasks).toHaveLength(doc.tasks.length);
    expect(prepared.tasks.every((t) => prepared.columns.some((c) => c.id === t.columnId)))
      .toBe(true);
    expect(prepared.tasks[0].id).not.toBe(doc.tasks[0].id);
    expect(prepared.name).toBe('From CSV');
  });

  it('works with nothing but a title column', () => {
    const parsed = parseCsv('Task\nOne\nTwo\n');
    const { doc, report } = csvToProject(parsed, ['title'], { name: 'Bare' });
    expect(doc.tasks).toHaveLength(2);
    expect(doc.columns).toHaveLength(1);
    expect(doc.columns[0].name).toBe('Imported');
    expect(report.skippedRows).toBe(0);
  });
});
