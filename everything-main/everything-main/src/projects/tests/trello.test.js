import { describe, it, expect } from 'vitest';
import { looksLikeTrello, trelloToProject } from '../src/lib/trello.js';
import { prepareImportedProject } from '../src/lib/backup.js';

const board = () => ({
  name: 'Marketing site',
  desc: 'Relaunch the site by October.',
  lists: [
    { id: 'l1', name: 'To Do', pos: 1, closed: false },
    { id: 'l2', name: 'Doing', pos: 2, closed: false },
    { id: 'l3', name: 'Done', pos: 3, closed: false },
    { id: 'l4', name: 'Old ideas', pos: 4, closed: true },
  ],
  labels: [
    { id: 'lb1', name: 'Design', color: 'purple' },
    { id: 'lb2', name: '', color: 'green' },
  ],
  members: [
    { id: 'm1', fullName: 'Maya Chen', username: 'maya' },
    { id: 'm2', username: 'leo' },
  ],
  cards: [
    {
      id: 'c1', name: 'Wireframes', desc: 'Sketch the flows', idList: 'l1', pos: 100,
      due: '2026-08-25T10:00:00.000Z', start: '2026-08-20T00:00:00.000Z', dueComplete: true,
      idLabels: ['lb1'], idMembers: ['m1', 'ghost'], closed: false,
      dateLastActivity: '2026-08-19T08:00:00.000Z',
      attachments: [
        { id: 'a1', name: 'brief.pdf', url: 'https://trello.com/1/cards/c1/brief.pdf', isUpload: true },
        { id: 'a2', name: 'bad', url: 'javascript:alert(1)' },
      ],
      cover: { color: 'blue' },
    },
    { id: 'c2', name: 'Copy review', idList: 'l2', pos: 200, closed: false, idLabels: [], idMembers: [] },
    { id: 'c3', name: 'Old thing', idList: 'l1', pos: 300, closed: true, idLabels: [], idMembers: [] },
    { id: 'c4', name: 'From an archived list', idList: 'l4', pos: 400, closed: false, idLabels: [], idMembers: [] },
  ],
  checklists: [
    {
      id: 'ck1', idCard: 'c1', name: 'Screens', pos: 1,
      checkItems: [
        { id: 'ci1', name: 'Home', state: 'complete', pos: 1 },
        { id: 'ci2', name: 'Pricing', state: 'incomplete', pos: 2 },
      ],
    },
    {
      id: 'ck2', idCard: 'c1', name: 'Sign-off', pos: 2,
      checkItems: [{ id: 'ci3', name: 'Legal', state: 'incomplete', pos: 1 }],
    },
  ],
  actions: [
    {
      type: 'commentCard', date: '2026-08-18T10:00:00.000Z',
      memberCreator: { fullName: 'Leo Park' },
      data: { text: 'Second comment', card: { id: 'c1' } },
    },
    {
      type: 'commentCard', date: '2026-08-17T10:00:00.000Z',
      memberCreator: { username: 'maya' },
      data: { text: 'First comment', card: { id: 'c1' } },
    },
    { type: 'updateCard', data: { card: { id: 'c1' } } },
  ],
});

describe('looksLikeTrello', () => {
  it('recognizes a board export and nothing else', () => {
    expect(looksLikeTrello(board())).toBe(true);
    expect(looksLikeTrello({ app: 'project-management', projects: [] })).toBe(false);
    expect(looksLikeTrello([])).toBe(false);
    expect(looksLikeTrello(null)).toBe(false);
    expect(looksLikeTrello({ lists: [] })).toBe(false);
  });
});

describe('trelloToProject', () => {
  const built = () => trelloToProject(board(), { now: 5000 });

  it('takes the board name and its description as the brief', () => {
    const { doc } = built();
    expect(doc.name).toBe('Marketing site');
    expect(doc.brief).toBe('Relaunch the site by October.');
  });

  it('turns open lists into columns, in board order', () => {
    const { doc } = built();
    expect(doc.columns.map((c) => c.name)).toEqual(['To Do', 'Doing', 'Done']);
  });

  it('reads "Done" as a done column, and says that it guessed', () => {
    const { doc, report } = built();
    expect(doc.columns.map((c) => c.done)).toEqual([false, false, true]);
    expect(report.notes.join(' ')).toContain('Done treated as done column, from the name');
  });

  it('keeps cards on the board and archived ones in the archive', () => {
    const { doc, report } = built();
    expect(doc.tasks.map((t) => t.title)).toEqual(['Wireframes', 'Copy review']);
    expect(doc.archive.map((t) => t.title)).toEqual(['Old thing', 'From an archived list']);
    expect(report.tasks).toBe(2);
    expect(report.archived).toBe(2);
  });

  it('maps dates to days, labels, and known members only', () => {
    const { doc } = built();
    const [wire] = doc.tasks;
    expect(wire.dueDate).toBe('2026-08-25');
    expect(wire.startDate).toBe('2026-08-20');
    expect(wire.labelIds).toEqual([doc.labels[0].id]);
    expect(doc.labels[0].name).toBe('Design');
    // A label with no name keeps its colour as a name rather than being blank.
    expect(doc.labels[1].name).toBe('green');
    expect(wire.assigneeIds).toEqual([doc.members[0].id]);
    expect(doc.members.map((m) => m.name)).toEqual(['Maya Chen', 'leo']);
  });

  it('merges several checklists into one, keeping their names', () => {
    const { doc, report } = built();
    expect(doc.tasks[0].checklist.map((i) => i.text)).toEqual([
      'Screens: Home', 'Screens: Pricing', 'Sign-off: Legal',
    ]);
    expect(doc.tasks[0].checklist[0].done).toBe(true);
    expect(report.checklistItems).toBe(3);
    expect(report.notes.join(' ')).toContain('more than one checklist');
  });

  it('takes comments out of the action log, oldest first', () => {
    const { doc, report } = built();
    expect(doc.tasks[0].comments.map((c) => c.text)).toEqual(['First comment', 'Second comment']);
    expect(doc.tasks[0].comments[0].author).toBe('maya');
    expect(report.comments).toBe(2);
  });

  it('brings attachments across as web links, and skips unusable ones', () => {
    const { doc, report } = built();
    const [att] = doc.tasks[0].attachments;
    expect(att).toMatchObject({ kind: 'url', name: 'brief.pdf' });
    expect(att.url).toBe('https://trello.com/1/cards/c1/brief.pdf');
    expect(doc.tasks[0].attachments).toHaveLength(1);
    expect(report.skippedAttachments).toBe(1);
    expect(report.notes.join(' ')).toContain('a link to Trello, not a copy');
    expect(report.notes.join(' ')).toContain('no usable web address');
  });

  it('says what Trello has that this app does not', () => {
    const { report } = built();
    const notes = report.notes.join(' ');
    expect(notes).toContain('due complete');
    expect(notes).toContain('card covers');
    expect(notes).toContain('unknown members');
    expect(notes).toContain('no priorities or milestones');
  });

  it('leaves priorities and milestones empty, since Trello has none', () => {
    const { doc } = built();
    expect(doc.milestones).toEqual([]);
    expect(doc.tasks.every((t) => t.priority === null)).toBe(true);
  });

  it('writes a document the store will accept as it is', () => {
    const { doc } = built();
    const { doc: prepared } = prepareImportedProject(doc);
    expect(prepared.tasks).toHaveLength(2);
    expect(prepared.archive).toHaveLength(2);
    expect(prepared.tasks[0].id).not.toBe(doc.tasks[0].id);
    expect(prepared.tasks[0].labelIds).toEqual([prepared.labels[0].id]);
    expect(prepared.tasks[0].attachments[0].kind).toBe('url');
    expect(prepared.brief).toBe('Relaunch the site by October.');
  });

  it('copes with a board that is nothing but lists', () => {
    const { doc, report } = trelloToProject({ name: 'Empty', lists: [], cards: [] });
    expect(doc.columns.map((c) => c.name)).toEqual(['Imported']);
    expect(doc.tasks).toEqual([]);
    expect(report.tasks).toBe(0);
  });
});
