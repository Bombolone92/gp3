import { describe, it, expect } from 'vitest';
import {
  projectMarkdown, projectCsv, csvCell, CSV_COLUMNS,
} from '../src/lib/exportdocs.js';

const NOW = new Date('2026-08-20T09:00:00');

const doc = () => ({
  v: 1,
  id: 'p1',
  name: 'Launch',
  brief: 'Ship **v1** to both stores.',
  columns: [
    { id: 'c1', name: 'To do' },
    { id: 'c2', name: 'Done', done: true },
  ],
  labels: [{ id: 'l1', name: 'Design' }],
  members: [{ id: 'm1', name: 'Maya Chen' }],
  milestones: [
    { id: 'ms2', name: 'Public launch', date: '2026-10-01' },
    { id: 'ms1', name: 'Beta', date: '2026-09-01', description: 'First 50 customers' },
  ],
  tasks: [
    {
      id: 't1', title: 'Wireframes', columnId: 'c1', order: 1024,
      description: 'Sketch it\n\nThen review', priority: 'high',
      startDate: '2026-08-18', dueDate: '2026-08-25',
      assigneeIds: ['m1'], labelIds: ['l1'], milestoneId: 'ms1',
      checklist: [{ id: 'i1', text: 'Home', done: true }, { id: 'i2', text: 'Pricing', done: false }],
      attachments: [{ id: 'a1', name: 'spec.pdf' }],
      createdAt: 1600000000000, updatedAt: 1600000600000,
    },
    {
      id: 't2', title: 'Ship, "quoted"', columnId: 'c2', order: 1024,
      assigneeIds: [], labelIds: [], checklist: [], attachments: [],
      createdAt: 1600000000000, updatedAt: 1600000000000,
    },
    {
      id: 't3', title: 'Second in column', columnId: 'c1', order: 2048,
      assigneeIds: [], labelIds: [], checklist: [], attachments: [],
      createdAt: 1600000000000, updatedAt: 1600000000000,
    },
  ],
});

describe('projectMarkdown', () => {
  const md = (patch = {}) => projectMarkdown(doc(), { now: NOW, ...patch });

  it('leads with the name, the brief, and where things stand', () => {
    const out = md();
    expect(out.startsWith('# Launch\n')).toBe(true);
    expect(out).toContain('Ship **v1** to both stores.');
    expect(out).toContain('*3 tasks, 1 done. Exported ');
  });

  it('lists milestones by date, with progress and description', () => {
    const out = md();
    const beta = out.indexOf('**Beta**');
    const launch = out.indexOf('**Public launch**');
    expect(beta).toBeGreaterThan(-1);
    expect(beta).toBeLessThan(launch);
    // Beta has one task, still open; Public launch has none assigned to it.
    expect(out).toContain('**Beta** — Sep 1 · 0/1 done');
    expect(out).toContain('**Public launch** — Oct 1 · 0/0 done');
    expect(out).toContain('  First 50 customers');
  });

  it('groups tasks by column, in board order, with a done box', () => {
    const out = md();
    expect(out).toContain('## To do (2)');
    expect(out).toContain('## Done (1)');
    expect(out.indexOf('Wireframes')).toBeLessThan(out.indexOf('Second in column'));
    expect(out).toContain('- [x] **Ship, "quoted"**');
    expect(out).toContain('- [ ] **Wireframes**');
  });

  it('puts the meta a status update needs on the task line', () => {
    expect(md()).toContain('starts Aug 18 · due Aug 25 · High · @Maya Chen · #Design '
      + '· milestone: Beta');
  });

  it('indents the description and the checklist under their task', () => {
    const out = md();
    expect(out).toContain('  Sketch it');
    expect(out).toContain('  Then review');
    expect(out).toContain('  Checklist 1/2:');
    expect(out).toContain('    - [x] Home');
    expect(out).toContain('    - [ ] Pricing');
  });

  it('names attachments rather than pretending to carry them', () => {
    expect(md()).toContain('  Attachments: spec.pdf');
  });

  it('exports only the tasks it is given, and says how many', () => {
    const one = projectMarkdown(doc(), { tasks: [doc().tasks[0]], now: NOW });
    expect(one).toContain('*1 task, 0 done.');
    expect(one).toContain('## To do (1)');
    expect(one).not.toContain('Ship, "quoted"');
    expect(one).not.toContain('## Done');
  });

  it('copes with a project that has nothing in it', () => {
    const bare = {
      name: 'Empty', columns: [{ id: 'c1', name: 'To do' }],
      labels: [], members: [], milestones: [], tasks: [],
    };
    const out = projectMarkdown(bare, { now: NOW });
    expect(out).toContain('# Empty');
    expect(out).toContain('*0 tasks, 0 done.');
    expect(out).not.toContain('## Milestones');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('uses the name it is handed rather than the one in the document', () => {
    expect(projectMarkdown(doc(), { name: 'Renamed', now: NOW }).startsWith('# Renamed')).toBe(true);
  });
});

describe('projectCsv', () => {
  it('writes the header, then one row per task in board order', () => {
    const rows = projectCsv(doc()).trim().split('\n');
    expect(rows[0]).toBe(CSV_COLUMNS.join(','));
    expect(rows).toHaveLength(4);
    expect(rows[1].startsWith('Launch,Wireframes,To do,no,High,Maya Chen,Design,Beta,'
      + '2026-08-18,2026-08-25,')).toBe(true);
    expect(rows[2].startsWith('Launch,Second in column,To do,no,,,,,,,')).toBe(true);
    expect(rows[3]).toContain('"Ship, ""quoted"""');
    expect(rows[3]).toContain(',Done,yes,');
  });

  it('ends with a newline, as every reader of CSV expects', () => {
    expect(projectCsv(doc()).endsWith('\n')).toBe(true);
  });

  it('exports only the tasks it is given', () => {
    const csv = projectCsv(doc(), { tasks: [doc().tasks[1]] });
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  it('writes timestamps as ISO so a spreadsheet can sort them', () => {
    const row = projectCsv(doc()).trim().split('\n')[1];
    expect(row).toContain('2020-09-13T12:26:40.000Z');
  });
});

describe('csvCell', () => {
  it('quotes only what has to be quoted', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
});
