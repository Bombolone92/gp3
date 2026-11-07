import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installPuterMock } from './helpers/puter-mock.js';
import { Store } from '../src/lib/store.js';
import {
  validateBackup, prepareImportedProject, describeBackup, parseBackupFile,
  BACKUP_APP, BACKUP_VERSION,
} from '../src/lib/backup.js';
import { zipFiles } from '../src/lib/zip.js';

let mock;
let store;

beforeEach(async () => {
  vi.useFakeTimers();
  mock = installPuterMock({ username: 'nadia' });
  store = new Store();
  await store.init();
});

const settle = () => vi.runAllTimersAsync();

describe('validateBackup', () => {
  const good = { app: BACKUP_APP, version: 1, projects: [] };

  it('accepts our own envelopes', () => {
    expect(validateBackup(good).version).toBe(1);
    expect(validateBackup({ ...good, version: BACKUP_VERSION }).version).toBe(BACKUP_VERSION);
  });

  it('rejects foreign, malformed, and future files with a readable reason', () => {
    expect(() => validateBackup(null)).toThrow(/not a Project Management backup/);
    expect(() => validateBackup({ app: 'trello', version: 1, projects: [] })).toThrow(/not exported by this app/);
    expect(() => validateBackup({ ...good, version: 'x' })).toThrow(/no readable version/);
    expect(() => validateBackup({ ...good, version: BACKUP_VERSION + 1 })).toThrow(/newer version/);
    expect(() => validateBackup({ app: BACKUP_APP, version: 1 })).toThrow(/no projects/);
  });
});

describe('prepareImportedProject', () => {
  const raw = () => ({
    v: 1,
    id: 'old-p',
    name: 'Imported',
    color: '#123456',
    members: [{ id: 'm1', name: 'Maya', color: '#000' }],
    labels: [{ id: 'l1', name: 'Bug', color: '#f00' }],
    columns: [{ id: 'c1', name: 'To do', done: false }, { id: 'c2', name: 'Done', done: true }],
    milestones: [{ id: 'ms1', name: 'Beta', date: '2026-09-01' }],
    tasks: [{
      id: 't1', title: 'Task', columnId: 'c2', order: 2048,
      assigneeIds: ['m1', 'ghost'], labelIds: ['l1'], milestoneId: 'ms1',
      checklist: [{ id: 'i1', text: 'Step', done: true }],
      comments: [{ id: 'cm1', author: 'Maya', text: 'hi', createdAt: 5 }],
      attachments: [{ id: 'a1', name: 'notes.txt', size: 3, type: 'text/plain' }],
      createdAt: 1, updatedAt: 2,
    }],
    archive: [{ id: 't2', title: 'Old', columnId: 'c1', attachments: [] }],
    trash: [{ id: 't3', title: 'Gone', columnId: 'c1', attachments: [], deletedAt: 9 }],
  });

  it('regenerates every id while keeping comments and attachment metadata', () => {
    const { doc, taskIdMap } = prepareImportedProject(raw());
    expect(doc.id).not.toBe('old-p');
    expect(doc.tasks[0].id).not.toBe('t1');
    expect(taskIdMap.get('t1')).toBe(doc.tasks[0].id);
    expect(doc.tasks[0].comments[0].text).toBe('hi');
    expect(doc.tasks[0].comments[0].id).not.toBe('cm1');
    expect(doc.tasks[0].attachments[0].id).toBe('a1'); // blob path key
    expect(doc.tasks[0].checklist[0]).toMatchObject({ text: 'Step', done: true });
  });

  it('rewires references and drops the ones that do not resolve', () => {
    const { doc } = prepareImportedProject(raw());
    expect(doc.tasks[0].columnId).toBe(doc.columns[1].id);
    expect(doc.tasks[0].milestoneId).toBe(doc.milestones[0].id);
    expect(doc.tasks[0].assigneeIds).toEqual([doc.members[0].id]);
    expect(doc.tasks[0].labelIds).toEqual([doc.labels[0].id]);
  });

  it('carries the archive and trash across', () => {
    const { doc } = prepareImportedProject(raw());
    expect(doc.archive.map((t) => t.title)).toEqual(['Old']);
    expect(doc.trash.map((t) => t.title)).toEqual(['Gone']);
  });

  it('repairs a document missing whole sections', () => {
    const { doc } = prepareImportedProject({ name: 'Bare' });
    expect(doc.columns).toHaveLength(1);
    expect(doc.tasks).toEqual([]);
    expect(doc.members).toEqual([]);
  });

  it('carries the project brief, and copes with a document written before it', () => {
    expect(prepareImportedProject({ ...raw(), brief: '# Goals\n\nShip it' }).doc.brief)
      .toBe('# Goals\n\nShip it');
    expect(prepareImportedProject(raw()).doc.brief).toBe('');
  });

  // A backup is a file, and files arrive edited or written by something else.
  // Every field a view reads without checking has to come out typed, or one
  // bad task takes the board, Today and All tasks down with it.
  it('drops fields a renderer would choke on, and keeps the task', () => {
    const { doc } = prepareImportedProject({
      ...raw(),
      color: 'url(https://attacker.example/beacon)',
      members: [{ id: 'm1', name: 'Maya', color: 'url(https://attacker.example/m)' }],
      labels: [{ id: 'l1', name: ['Bug'], color: 'red; background: url(x)' }, { id: 'l2', name: 'Ok', color: '#ABC' }],
      milestones: [{ id: 'ms1', name: 'Beta', date: 'soon' }],
      tasks: [{
        id: 't1', title: 'Task', columnId: 'c1', description: 5,
        dueDate: 'tomorrow', startDate: 20260901, priority: 'asap',
        assigneeIds: 'm1', labelIds: null, recurrence: { freq: 'yearly' },
        remindOffset: '2', remindedOn: 'yesterday', doneAt: 'now',
        attachments: [{ id: 'a1', name: 7, size: -4, type: ['text/html'], kind: 'evil', path: 3 }, 'junk'],
      }],
    });
    expect(doc.color).toBe('#8833eb');
    expect(doc.members[0].color).toBe('#8833eb');
    expect(doc.labels.map((l) => l.color)).toEqual(['#2382c4', '#ABC']);
    expect(doc.labels[0].name).toBe('');
    expect(doc.milestones[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [task] = doc.tasks;
    expect(task.description).toBe('');
    expect(task.dueDate).toBeNull();
    expect(task.startDate).toBeNull();
    expect(task.priority).toBeNull();
    expect(task.assigneeIds).toEqual([]);
    expect(task.labelIds).toEqual([]);
    expect(task).not.toHaveProperty('recurrence');
    expect(task).not.toHaveProperty('remindOffset');
    expect(task).not.toHaveProperty('remindedOn');
    expect(task).not.toHaveProperty('doneAt');
    expect(task.attachments).toHaveLength(1);
    expect(task.attachments[0]).toMatchObject({ id: 'a1', name: 'file', size: 0, type: '' });
    expect(task.attachments[0]).not.toHaveProperty('kind');
    expect(task.attachments[0]).not.toHaveProperty('path');
  });

  it('keeps well-formed optional fields exactly', () => {
    const { doc } = prepareImportedProject({
      ...raw(),
      tasks: [{
        id: 't1', title: 'Repeat', columnId: 'c1', description: 'Body', priority: 'high',
        startDate: '2026-09-01', dueDate: '2026-09-03', recurrence: { freq: 'weekly', interval: 2 },
        recurrenceClosed: false, remindOffset: 1, remindedOn: '2026-09-02', doneAt: 12345,
        attachments: [
          { id: 'a1', name: 'spec.txt', size: 3, type: 'text/plain', kind: 'link', path: '/u/spec.txt' },
          { id: 'a2', name: 'card', size: 0, type: '', kind: 'url', url: 'https://trello.com/c/x' },
        ],
      }],
    });
    const [task] = doc.tasks;
    expect(task).toMatchObject({
      description: 'Body', priority: 'high', startDate: '2026-09-01', dueDate: '2026-09-03',
      recurrence: { freq: 'weekly', interval: 2 }, recurrenceClosed: false,
      remindOffset: 1, remindedOn: '2026-09-02', doneAt: 12345,
    });
    expect(task.attachments[0]).toMatchObject({ kind: 'link', path: '/u/spec.txt' });
    expect(task.attachments[1]).toMatchObject({ kind: 'url', url: 'https://trello.com/c/x' });
  });

  it('refuses a document written by a newer schema', () => {
    expect(() => prepareImportedProject({ v: 2, name: 'Future' })).toThrow(/newer version/);
  });
});

describe('describeBackup', () => {
  it('counts what the confirmation dialog shows', () => {
    const info = describeBackup({
      projects: [
        { tasks: [{ attachments: [{}, {}] }, { attachments: [] }] },
        { tasks: [{}] },
      ],
      exportedAt: 1234,
    });
    expect(info).toEqual({ projects: 2, tasks: 3, attachments: 2, exportedAt: 1234 });
  });
});

describe('export and import round trip', () => {
  async function seed() {
    const doc = await store.createProject({ name: 'Roundtrip', color: '#4f63f0' });
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'Has a file', priority: 'high' });
    store.addComment(doc.id, task.id, 'keep me');
    store.addChecklistItem(doc.id, task.id, 'step one');
    await store.addAttachment(doc.id, task.id, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await settle();
    return { doc, task };
  }

  it('exports a zip that imports back with its attachment intact', async () => {
    const { doc } = await seed();
    const { blob } = await store.exportBundle();

    const parsed = await parseBackupFile(new File([blob], 'projects-backup.zip'));
    expect(parsed.files.size).toBe(1);

    const summary = await store.importBackup(parsed);
    await settle();
    expect(summary).toMatchObject({ projects: 1, tasks: 1, attachments: 1, missingAttachments: 0 });
    expect(summary.failed).toEqual([]);

    const copyEntry = store.projects.find((p) => p.id !== doc.id);
    const copy = await store.loadProject(copyEntry.id);
    expect(copy.id).not.toBe(doc.id);
    expect(copy.tasks[0].title).toBe('Has a file');
    expect(copy.tasks[0].comments[0].text).toBe('keep me');
    expect(copy.tasks[0].checklist[0].text).toBe('step one');

    const att = copy.tasks[0].attachments[0];
    expect(await (await store.readAttachment(copy.id, copy.tasks[0].id, att)).text()).toBe('hello');
  });

  it('imports a JSON-only backup, dropping attachment rows that have no file', async () => {
    await seed();
    const data = await store.exportAll();
    const summary = await store.importBackup({ data, files: new Map() });
    await settle();
    expect(summary).toMatchObject({ projects: 1, attachments: 0, missingAttachments: 1 });

    const copyEntry = store.projects[store.projects.length - 1];
    const copy = await store.loadProject(copyEntry.id);
    expect(copy.tasks[0].attachments).toEqual([]);
  });

  it('imports the same file twice as two independent projects', async () => {
    const { doc } = await seed();
    const data = await store.exportAll();
    await store.importBackup({ data, files: new Map() });
    await store.importBackup({ data, files: new Map() });
    await settle();
    expect(store.projects).toHaveLength(3);
    const ids = new Set(store.projects.map((p) => p.id));
    expect(ids.size).toBe(3);
    expect(store.projects.filter((p) => p.name === 'Roundtrip')).toHaveLength(3);
    expect((await store.loadProject(doc.id)).tasks).toHaveLength(1);
  });

  it('restores the archived flag from the index', async () => {
    const doc = await store.createProject({ name: 'Retired', color: '#000' });
    await store.setProjectArchived(doc.id, true);
    const data = await store.exportAll();
    await store.importBackup({ data, files: new Map() });
    await settle();
    const copy = store.projects.find((p) => p.id !== doc.id);
    expect(copy.archived).toBe(true);
  });

  it('skips a broken project and reports it instead of failing the file', async () => {
    await seed();
    const data = await store.exportAll();
    data.projects.push({ v: 3, name: 'From the future' });
    const summary = await store.importBackup({ data, files: new Map() });
    await settle();
    expect(summary.projects).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].name).toBe('From the future');
  });

  it('reads a bare .json backup file as well as a zip', async () => {
    await seed();
    const data = await store.exportAll();
    const file = new File([JSON.stringify(data)], 'backup.json', { type: 'application/json' });
    const parsed = await parseBackupFile(file);
    expect(parsed.data.app).toBe(BACKUP_APP);
    expect(parsed.files.size).toBe(0);
  });

  it('rejects a zip with no backup.json', async () => {
    const blob = await zipFiles([{ name: 'notes.txt', blob: new Blob(['x']) }]);
    await expect(parseBackupFile(new File([blob], 'x.zip'))).rejects.toThrow(/no backup.json/);
  });

  it('exports only the requested project', async () => {
    const { doc } = await seed();
    await store.createProject({ name: 'Other', color: '#000' });
    const data = await store.exportAll([doc.id]);
    expect(data.projects.map((p) => p.name)).toEqual(['Roundtrip']);
    expect(data.templates).toEqual([]);
  });

  // A backup is an untrusted file: both halves of an attachment's file name
  // come out of it, and the write creates any parent it needs.
  it('keeps a hostile attachment name inside the attachments directory', async () => {
    const evil = { id: '../../../..', name: '../../../../pwned.js', size: 1, type: 'text/plain' };
    const data = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      projects: [{
        v: 1,
        id: 'src-p',
        name: 'Hostile',
        color: '#000',
        members: [], labels: [], milestones: [],
        columns: [{ id: 'c1', name: 'To do', done: false }],
        tasks: [{ id: 'src-t', title: 'Boom', columnId: 'c1', attachments: [evil] }],
      }],
    };
    const files = new Map([
      [`attachments/src-p/src-t/${evil.id}-${evil.name}`, new Blob(['payload'])],
    ]);

    const summary = await store.importBackup({ data, files });
    await settle();
    expect(summary.projects).toBe(1);
    expect(summary.attachments).toBe(1);

    const written = [...mock._fs.keys()].filter((p) => p.includes('pwned') || p.includes('payload'));
    expect(written).toHaveLength(1);
    expect(written[0].startsWith('projects-data/attachments/')).toBe(true);
    expect(written[0].split('/')).not.toContain('..');

    // The row still opens: the doc records the name the blob was written under.
    const entry = store.projects.find((p) => p.name === 'Hostile');
    const copy = await store.loadProject(entry.id);
    const att = copy.tasks[0].attachments[0];
    expect(await (await store.readAttachment(copy.id, copy.tasks[0].id, att)).text()).toBe('payload');
  });
});
