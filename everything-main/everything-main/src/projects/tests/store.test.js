import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installPuterMock } from './helpers/puter-mock.js';
import { Store, colorName, PROJECT_COLORS, LABEL_COLORS } from '../src/lib/store.js';
import { mirror } from '../src/lib/mirror.js';
import { columnTasks, projectProgress } from '../src/lib/board.js';
import { orderedProjects, projectGroups } from '../src/lib/projects.js';
import { planColumnSort } from '../src/lib/columns.js';

let mock;
let store;

beforeEach(async () => {
  vi.useFakeTimers();
  mock = installPuterMock({ username: 'nadia' });
  store = new Store();
  await store.init();
});

/** Run pending debounced saves and let the async writes settle. */
async function settle() {
  await vi.runAllTimersAsync();
}

async function makeProject(name = 'Test project') {
  const doc = await store.createProject({ name, color: '#4f63f0' });
  return doc;
}

/**
 * Stand in for the IndexedDB mirror, which Node has not got — so the paths
 * that only run when this device has a cached copy can be tested at all.
 * Values are cloned in and out, as a real object store does.
 */
function installMirrorStub() {
  const kept = new Map();
  const real = { available: mirror.available, get: mirror.get, set: mirror.set, del: mirror.del, keys: mirror.keys };
  mirror.available = () => true;
  mirror.get = async (key) => (kept.has(key) ? structuredClone(kept.get(key)) : null);
  mirror.set = async (key, value) => { kept.set(key, structuredClone(value)); return null; };
  mirror.del = async (key) => { kept.delete(key); return null; };
  mirror.keys = async () => [...kept.keys()];
  return { kept, restore: () => Object.assign(mirror, real) };
}

describe('init', () => {
  it('loads the user and defaults on a fresh account', () => {
    expect(store.user.username).toBe('nadia');
    expect(store.projects).toEqual([]);
    expect(store.settings.theme).toBe('system');
  });

  it('restores persisted settings and projects on next boot', async () => {
    await store.updateSettings({ theme: 'dark' });
    await makeProject('Persisted');

    const second = new Store();
    await second.init();
    expect(second.settings.theme).toBe('dark');
    expect(second.projects).toHaveLength(1);
    expect(second.projects[0].name).toBe('Persisted');

    const doc = await second.loadProject(second.projects[0].id);
    expect(doc.columns).toHaveLength(3);
    expect(doc.members[0].name).toBe('nadia');
  });
});

describe('colorName', () => {
  it('names every colour a swatch can show', () => {
    for (const hex of [...PROJECT_COLORS, ...LABEL_COLORS]) {
      const name = colorName(hex);
      expect(name).not.toBe(hex);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('falls back to the value for a colour that is not ours', () => {
    expect(colorName('#123456')).toBe('#123456');
    expect(colorName('#8833EB')).toBe('Purple');
    expect(colorName(null)).toBe('');
  });
});

describe('projects', () => {
  it('creates with default columns, the last flagged done', async () => {
    const doc = await makeProject();
    expect(doc.columns.map((c) => c.name)).toEqual(['To do', 'In progress', 'Done']);
    expect(doc.columns.map((c) => !!c.done)).toEqual([false, false, true]);
  });

  it('starts with an empty brief and saves the one it is given', async () => {
    const doc = await makeProject('Briefed');
    expect(doc.brief).toBe('');

    store.setProjectBrief(doc.id, '# Goals\n\nShip the beta');
    await settle();

    const fresh = new Store();
    await fresh.init();
    expect((await fresh.loadProject(doc.id)).brief).toBe('# Goals\n\nShip the beta');
  });

  // The agenda, search, the palette and the reminder pass all want every
  // project, and two of them overlapping must not mean two documents.
  it('shares one read between callers that ask at the same time', async () => {
    const doc = await makeProject('Shared');
    await settle();

    const fresh = new Store();
    await fresh.init();
    const reads = [];
    const original = mock.fs.read;
    mock.fs.read = (path) => { reads.push(path); return original(path); };

    const loaded = await Promise.all([
      fresh.loadProject(doc.id), fresh.loadProject(doc.id), fresh.loadProject(doc.id),
    ]);
    mock.fs.read = original;

    expect(reads.filter((p) => p.endsWith(`project-${doc.id}.json`))).toHaveLength(1);
    expect(loaded[0]).toBe(loaded[1]);
    expect(loaded[1]).toBe(loaded[2]);
    expect(loaded[0]).toBe(fresh.getDoc(doc.id));
  });

  it('updates index and doc together on rename', async () => {
    const doc = await makeProject('Old name');
    await store.updateProjectMeta(doc.id, { name: 'New name' });
    expect(store.projectEntry(doc.id).name).toBe('New name');
    expect(store.getDoc(doc.id).name).toBe('New name');
  });

  it('persists a rename into a doc that was never opened', async () => {
    const doc = await makeProject('Old name');
    await settle();

    // Fresh store: the doc is not in memory when the rename happens.
    const second = new Store();
    await second.init();
    await second.updateProjectMeta(doc.id, { name: 'New name' });
    await settle();

    const saved = JSON.parse(await (mock._fs.get(`projects-data/project-${doc.id}.json`)).text());
    expect(saved.name).toBe('New name');
  });

  it('moves a deleted project to the trash, keeping its file for a restore', async () => {
    const doc = await makeProject('Trashed');
    await store.deleteProject(doc.id);
    await settle();
    expect(store.projects).toEqual([]);
    expect(store.deletedProjects.map((p) => p.name)).toEqual(['Trashed']);
    expect(mock._fs.has(`projects-data/project-${doc.id}.json`)).toBe(true);

    await store.restoreProject(doc.id);
    expect(store.projects.map((p) => p.name)).toEqual(['Trashed']);
    expect(store.deletedProjects).toEqual([]);
    expect((await store.loadProject(doc.id)).name).toBe('Trashed');
  });

  it('purges a project for good, with its file and attachments', async () => {
    const doc = await makeProject();
    await store.deleteProject(doc.id);
    await store.purgeProject(doc.id);
    await settle();
    expect(store.projects).toEqual([]);
    expect(store.deletedProjects).toEqual([]);
    expect(mock._fs.has(`projects-data/project-${doc.id}.json`)).toBe(false);
  });

  it('purges trashed projects past the grace period on boot', async () => {
    const kept = await makeProject('Recent');
    const old = await makeProject('Ancient');
    await store.deleteProject(kept.id);
    await store.deleteProject(old.id);
    // Backdate one deletion past the window.
    store.deletedProjects = store.deletedProjects.map((p) => (p.id === old.id
      ? { ...p, deletedAt: Date.now() - 31 * 24 * 3600 * 1000 } : p));

    const purged = await store.purgeOldDeletedProjects();
    expect(purged).toBe(1);
    expect(store.deletedProjects.map((p) => p.name)).toEqual(['Recent']);
    expect(mock._fs.has(`projects-data/project-${old.id}.json`)).toBe(false);
    expect(mock._fs.has(`projects-data/project-${kept.id}.json`)).toBe(true);
  });

  it('reloads the trash index on the next boot', async () => {
    const doc = await makeProject('Trashed');
    await store.deleteProject(doc.id);
    const second = new Store();
    await second.init();
    expect(second.deletedProjects.map((p) => p.name)).toEqual(['Trashed']);
  });

  it('leaves no phantom project when the document write fails', async () => {
    mock.fs.write = async () => { throw new Error('network down'); };
    await expect(makeProject('Doomed')).rejects.toThrow();
    expect(store.projects).toEqual([]);
    expect(store.getDoc('Doomed')).toBeNull();
  });

  it('rolls back memory and the file when the index write fails', async () => {
    mock.kv.set = async () => { throw new Error('network down'); };
    await expect(makeProject('Doomed')).rejects.toThrow();
    await settle();
    expect(store.projects).toEqual([]);
    expect([...mock._fs.keys()].some((k) => k.startsWith('projects-data/project-'))).toBe(false);
  });
});

describe('loadAllProjects', () => {
  it('can leave archived projects unread, since the agenda discards them', async () => {
    const live = await makeProject('Live');
    const shelved = await makeProject('Shelved');
    await store.setProjectArchived(shelved.id, true);
    await settle();

    // A fresh store so nothing is cached from creating them.
    const next = new Store();
    await next.init();
    const reads = [];
    const read = mock.fs.read;
    mock.fs.read = (path, ...rest) => { reads.push(path); return read(path, ...rest); };

    const { docs } = await next.loadAllProjects({ archived: false });
    expect(docs.map((d) => d.entry.name)).toEqual(['Live']);
    expect(reads.some((p) => p.includes(shelved.id))).toBe(false);

    // The default still reads everything: search must be able to find work
    // inside a project that was put away.
    const all = await next.loadAllProjects();
    expect(all.docs).toHaveLength(2);
    mock.fs.read = read;
  });

  it('reads a project as it comes out of the archive', async () => {
    const doc = await makeProject('Shelved');
    await store.setProjectArchived(doc.id, true);
    await settle();

    const next = new Store();
    await next.init();
    await next.loadAllProjects({ archived: false });
    expect(next.getDoc(doc.id)).toBeNull();

    await next.setProjectArchived(doc.id, false);
    await settle();
    expect(next.getDoc(doc.id)).not.toBeNull();
  });
});

describe('pinning and ordering projects', () => {
  it('pins on the index entry alone, and persists it', async () => {
    const a = await makeProject('A');
    await store.setProjectPinned(a.id, true);
    expect(store.projectEntry(a.id).pinned).toBe(true);

    const fresh = new Store();
    await fresh.init();
    expect(fresh.projectEntry(a.id).pinned).toBe(true);
    // A flag on the entry: the document never had to be opened or written.
    expect(fresh.getDoc(a.id)).toBe(null);
  });

  it('writes an order per entry, so a reorder survives a reload', async () => {
    await makeProject('A');
    await makeProject('B');
    await makeProject('C');
    // Three projects created inside one frozen millisecond tie-break by id,
    // so the test moves whatever is last rather than assuming a name.
    const before = orderedProjects(store.projects);
    const last = before[before.length - 1];

    expect(await store.moveProject(last.id, 0)).toBe(true);

    const fresh = new Store();
    await fresh.init();
    const { pinned, rest } = projectGroups(fresh.projects);
    expect(pinned).toEqual([]);
    expect(rest.map((p) => p.id))
      .toEqual([last.id, ...before.slice(0, -1).map((p) => p.id)]);
  });

  it('reports a move that changes nothing rather than writing', async () => {
    await makeProject('A');
    await makeProject('B');
    const first = orderedProjects(store.projects)[0];
    expect(await store.moveProject(first.id, 0)).toBe(false);
    expect(await store.moveProject('nope', 1)).toBe(false);
  });

  it('keeps a project another window created while this one reordered', async () => {
    const a = await makeProject('A');
    const b = await makeProject('B');

    const other = new Store();
    await other.init();
    const c = await other.createProject({ name: 'C', color: '#000' });

    await store.moveProject(b.id, 0);
    const reloaded = new Store();
    await reloaded.init();
    // The reorder wrote an order per entry, so the project this window never
    // saw is merged in rather than dropped.
    expect(reloaded.projects.map((p) => p.id).sort())
      .toEqual([a.id, b.id, c.id].sort());
    const order = orderedProjects(reloaded.projects).map((p) => p.id);
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(a.id));
  });
});

describe('tasks', () => {
  it('adds tasks in order and persists after the debounce', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    store.addTask(doc.id, col, { title: 'First' });
    store.addTask(doc.id, col, { title: 'Second' });
    expect(store.dirty).toBe(true);

    await settle();
    expect(store.dirty).toBe(false);

    const saved = JSON.parse(await (mock._fs.get(`projects-data/project-${doc.id}.json`)).text());
    expect(columnTasks(saved.tasks, col).map((t) => t.title)).toEqual(['First', 'Second']);
  });

  it('moves a task across columns to a given position', async () => {
    const doc = await makeProject();
    const [c1, c2] = doc.columns.map((c) => c.id);
    store.addTask(doc.id, c1, { title: 'A' });
    const b = store.addTask(doc.id, c1, { title: 'B' });
    store.addTask(doc.id, c2, { title: 'X' });

    store.moveTask(doc.id, b.id, c2, 0);
    expect(columnTasks(doc.tasks, c1).map((t) => t.title)).toEqual(['A']);
    expect(columnTasks(doc.tasks, c2).map((t) => t.title)).toEqual(['B', 'X']);
  });

  it('emits a change event for every mutation', async () => {
    const doc = await makeProject();
    const events = [];
    store.addEventListener('change', (e) => events.push(e.detail.scope));
    store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    expect(events).toContain('doc');
  });
});

describe('bulk edits', () => {
  async function withTasks() {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const a = store.addTask(doc.id, col, { title: 'A', priority: 'low', dueDate: '2026-08-01' });
    const b = store.addTask(doc.id, col, { title: 'B' });
    const c = store.addTask(doc.id, col, { title: 'C', priority: 'high' });
    return { doc, col, a, b, c };
  }

  it('applies one patch to a selection in a single change event', async () => {
    const { doc, a, b } = await withTasks();
    const events = [];
    store.addEventListener('change', () => events.push(1));

    const touched = store.bulkUpdateTasks(doc.id, [a.id, b.id], { priority: 'urgent' });

    expect(touched).toEqual([a.id, b.id]);
    expect(doc.tasks.map((t) => t.priority)).toEqual(['urgent', 'urgent', 'high']);
    expect(events).toHaveLength(1);
  });

  it('restores the value each task had of its own through bulkPatchTasks', async () => {
    const { doc, a, b, c } = await withTasks();
    const before = doc.tasks.map((t) => ({ id: t.id, priority: t.priority ?? null }));

    store.bulkUpdateTasks(doc.id, [a.id, b.id, c.id], { priority: 'medium' });
    store.bulkPatchTasks(doc.id, before);

    expect(doc.tasks.map((t) => t.priority)).toEqual(['low', null, 'high']);
  });

  it('ignores ids that are not in the project', async () => {
    const { doc, a } = await withTasks();
    expect(store.bulkUpdateTasks(doc.id, [a.id, 'ghost'], { priority: 'low' })).toEqual([a.id]);
  });

  it('adds and removes one label across a selection', async () => {
    const { doc, a, b } = await withTasks();
    const label = store.addLabel(doc.id, { name: 'Design', color: '#000' });

    store.bulkToggleTaskRef(doc.id, [a.id, b.id], 'labelIds', label.id, true);
    expect(a.labelIds).toEqual([label.id]);
    // Already-on tasks are left alone rather than doubled up.
    expect(store.bulkToggleTaskRef(doc.id, [a.id, b.id], 'labelIds', label.id, true)).toEqual([]);

    store.bulkToggleTaskRef(doc.id, [a.id, b.id], 'labelIds', label.id, false);
    expect(a.labelIds).toEqual([]);
    expect(b.labelIds).toEqual([]);
  });

  it('moves a selection to the end of a column, keeping their order', async () => {
    const { doc, a, c } = await withTasks();
    const target = doc.columns[1].id;
    store.addTask(doc.id, target, { title: 'Already there' });

    const moved = store.bulkMoveTasks(doc.id, [a.id, c.id], target);

    expect(moved).toEqual([a.id, c.id]);
    expect(columnTasks(doc.tasks, target).map((t) => t.title))
      .toEqual(['Already there', 'A', 'C']);
  });

  it('still spawns the next occurrence when a bulk move completes a task', async () => {
    const { doc, a } = await withTasks();
    store.setRecurrence(doc.id, a.id, { freq: 'weekly', interval: 1 });

    store.bulkMoveTasks(doc.id, [a.id], doc.columns[2].id);

    expect(doc.tasks).toHaveLength(4);
    expect(a.recurrenceClosed).toBe(true);
  });

  it('stamps a raised reminder without touching updatedAt', async () => {
    const { doc, a, b } = await withTasks();
    const before = a.updatedAt;
    a.updatedAt = before - 100000;
    b.updatedAt = before - 100000;

    const touched = store.markRemindersShown(doc.id, [a.id, b.id], '2026-08-20');

    expect(touched).toEqual([a.id, b.id]);
    expect(a.remindedOn).toBe('2026-08-20');
    expect(a.updatedAt).toBe(before - 100000);
    expect(b.updatedAt).toBe(before - 100000);

    // Nothing left to stamp: a second pass the same day costs no write.
    expect(store.markRemindersShown(doc.id, [a.id, b.id], '2026-08-20')).toEqual([]);
  });

  it('names the task that handed over when a bulk move completes a series', async () => {
    const { doc, a } = await withTasks();
    store.setRecurrence(doc.id, a.id, { freq: 'weekly', interval: 1 });
    const events = [];
    store.addEventListener('recurrence-spawned', (e) => events.push(e.detail));

    store.bulkMoveTasks(doc.id, [a.id], doc.columns[2].id);

    // The successor alone is not enough to undo the completion: an inverse
    // has to reopen the series on the task that gave it up.
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe(a.id);
    expect(events[0].next.id).not.toBe(a.id);
  });

  it('archives and deletes a selection, and puts it back', async () => {
    const { doc, a, b, c } = await withTasks();

    expect(store.bulkArchiveTasks(doc.id, [a.id, b.id])).toEqual([a.id, b.id]);
    expect(doc.tasks.map((t) => t.title)).toEqual(['C']);
    store.bulkRestoreTasks(doc.id, [a.id, b.id], 'archive');
    expect(doc.archive).toEqual([]);
    expect(doc.tasks).toHaveLength(3);

    expect(store.bulkDeleteTasks(doc.id, [c.id])).toEqual([c.id]);
    expect(doc.trash.map((t) => t.title)).toEqual(['C']);
    store.bulkRestoreTasks(doc.id, [c.id], 'trash');
    expect(doc.trash).toEqual([]);
    expect(doc.tasks).toHaveLength(3);
  });

  it('re-homes a restored task whose column is gone', async () => {
    const { doc, a } = await withTasks();
    store.bulkDeleteTasks(doc.id, [a.id]);
    store.deleteColumn(doc.id, doc.columns[0].id);

    store.bulkRestoreTasks(doc.id, [a.id], 'trash');
    expect(doc.tasks.find((t) => t.id === a.id).columnId).toBe(doc.columns[0].id);
  });
});

describe('columns', () => {
  it('re-homes tasks when their column is deleted', async () => {
    const doc = await makeProject();
    const [c1, , c3] = doc.columns.map((c) => c.id);
    store.addTask(doc.id, c3, { title: 'Done task' });
    store.deleteColumn(doc.id, c3);
    expect(doc.columns).toHaveLength(2);
    expect(columnTasks(doc.tasks, c1).map((t) => t.title)).toEqual(['Done task']);
  });

  it('refuses to delete the last column', async () => {
    const doc = await makeProject();
    for (const c of [...doc.columns]) store.deleteColumn(doc.id, c.id);
    expect(doc.columns).toHaveLength(1);
  });

  it('reorders columns', async () => {
    const doc = await makeProject();
    const names = () => doc.columns.map((c) => c.name);
    store.moveColumn(doc.id, doc.columns[2].id, 0);
    expect(names()).toEqual(['Done', 'To do', 'In progress']);
  });
});

describe('milestones, members, labels', () => {
  it('unsets milestoneId on tasks when a milestone is deleted', async () => {
    const doc = await makeProject();
    const m = store.addMilestone(doc.id, { name: 'Beta', date: '2026-09-01' });
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T', milestoneId: m.id });
    store.deleteMilestone(doc.id, m.id);
    expect(doc.milestones).toEqual([]);
    expect(task.milestoneId).toBeNull();
  });

  it('unassigns removed members from tasks', async () => {
    const doc = await makeProject();
    const member = store.addMember(doc.id, { name: 'Maya', color: '#0d9488' });
    const task = store.addTask(doc.id, doc.columns[0].id, {
      title: 'T', assigneeIds: [member.id],
    });
    store.removeMember(doc.id, member.id);
    expect(task.assigneeIds).toEqual([]);
  });

  it('strips deleted labels from tasks', async () => {
    const doc = await makeProject();
    const label = store.addLabel(doc.id, { name: 'Bug', color: '#dc4b6a' });
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T', labelIds: [label.id] });
    store.removeLabel(doc.id, label.id);
    expect(task.labelIds).toEqual([]);
  });
});

describe('trash', () => {
  it('moves a deleted task to the trash and restores it in place', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const task = store.addTask(doc.id, col, { title: 'Oops' });
    store.deleteTask(doc.id, task.id);
    expect(doc.tasks).toEqual([]);
    expect(doc.trash.map((t) => t.title)).toEqual(['Oops']);
    expect(doc.trash[0].deletedAt).toBeTypeOf('number');

    store.restoreTask(doc.id, task.id);
    expect(doc.trash).toEqual([]);
    expect(columnTasks(doc.tasks, col).map((t) => t.title)).toEqual(['Oops']);
  });

  it('keeps attachment blobs until a trashed task is purged', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'With file' });
    const att = await store.addAttachment(doc.id, task.id, new File(['x'], 'a.txt', { type: 'text/plain' }));
    const path = `projects-data/attachments/${doc.id}/${task.id}/${att.id}-a.txt`;

    store.deleteTask(doc.id, task.id);
    await settle();
    expect(mock._fs.has(path)).toBe(true);

    store.purgeTask(doc.id, task.id);
    await settle();
    expect(doc.trash).toEqual([]);
    expect(mock._fs.has(path)).toBe(false);
  });

  it('re-homes a restored task whose column, milestone, or label went away', async () => {
    const doc = await makeProject();
    const [c1, , c3] = doc.columns.map((c) => c.id);
    const m = store.addMilestone(doc.id, { name: 'Beta', date: '2026-09-01' });
    const label = store.addLabel(doc.id, { name: 'Bug', color: '#000' });
    const task = store.addTask(doc.id, c3, { title: 'Stray', milestoneId: m.id, labelIds: [label.id] });

    store.deleteTask(doc.id, task.id);
    store.deleteColumn(doc.id, c3);
    store.deleteMilestone(doc.id, m.id);
    store.removeLabel(doc.id, label.id);

    const restored = store.restoreTask(doc.id, task.id);
    expect(restored.columnId).toBe(c1);
    expect(restored.milestoneId).toBeNull();
    expect(restored.labelIds).toEqual([]);
  });

  it('empties the trash and purges expired items on load', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const a = store.addTask(doc.id, col, { title: 'A' });
    const b = store.addTask(doc.id, col, { title: 'B' });
    store.deleteTask(doc.id, a.id);
    store.deleteTask(doc.id, b.id);
    doc.trash = doc.trash.map((t) => (t.id === a.id
      ? { ...t, deletedAt: Date.now() - 31 * 24 * 3600 * 1000 } : t));

    expect(store.purgeOldTrash(doc.id)).toBe(1);
    expect(doc.trash.map((t) => t.title)).toEqual(['B']);

    store.emptyTrash(doc.id);
    expect(doc.trash).toEqual([]);
  });

  it('empties the whole trash in one mutation', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    for (const title of ['A', 'B', 'C', 'D']) {
      const t = store.addTask(doc.id, col, { title });
      store.deleteTask(doc.id, t.id);
    }
    await settle();

    let renders = 0;
    store.addEventListener('change', (e) => {
      if (e.detail?.scope === 'doc') renders++;
    });

    expect(store.emptyTrash(doc.id)).toHaveLength(4);
    expect(doc.trash).toEqual([]);
    // Four purges used to mean four rebuilds of every view on screen.
    expect(renders).toBe(1);
    // And nothing at all once there is nothing left to purge.
    expect(store.emptyTrash(doc.id)).toEqual([]);
    expect(renders).toBe(1);
  });

  it('restores a deleted column with its tasks where they were', async () => {
    const doc = await makeProject();
    const [c1, c2] = doc.columns.map((c) => c.id);
    const task = store.addTask(doc.id, c2, { title: 'Mid' });
    const order = task.order;

    const removed = store.deleteColumn(doc.id, c2);
    expect(removed.moved.map((m) => m.id)).toEqual([task.id]);
    expect(task.columnId).toBe(c1);

    store.restoreColumn(doc.id, removed);
    expect(doc.columns.map((c) => c.id)).toEqual([c1, c2, doc.columns[2].id]);
    expect(task.columnId).toBe(c2);
    expect(task.order).toBe(order);
  });

  it('restores a deleted milestone and re-attaches its tasks', async () => {
    const doc = await makeProject();
    const m = store.addMilestone(doc.id, { name: 'Beta', date: '2026-09-01' });
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T', milestoneId: m.id });

    const removed = store.deleteMilestone(doc.id, m.id);
    expect(task.milestoneId).toBeNull();
    store.restoreMilestone(doc.id, removed);
    expect(doc.milestones.map((x) => x.id)).toEqual([m.id]);
    expect(task.milestoneId).toBe(m.id);
  });

  it('restores a deleted comment at its original position', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    store.addComment(doc.id, task.id, 'first');
    const second = store.addComment(doc.id, task.id, 'second');
    store.addComment(doc.id, task.id, 'third');

    const removed = store.deleteComment(doc.id, task.id, second.id);
    expect(task.comments.map((c) => c.text)).toEqual(['first', 'third']);
    store.restoreComment(doc.id, task.id, removed);
    expect(task.comments.map((c) => c.text)).toEqual(['first', 'second', 'third']);
  });
});

describe('recurring tasks', () => {
  const weekly = { freq: 'weekly', interval: 1 };

  it('spawns the next occurrence when the task reaches a done column', async () => {
    const doc = await makeProject();
    const [first, , done] = doc.columns.map((c) => c.id);
    const task = store.addTask(doc.id, doc.columns[1].id, {
      title: 'Weekly review', dueDate: '2026-08-06', priority: 'medium',
    });
    store.setRecurrence(doc.id, task.id, weekly);
    store.addChecklistItem(doc.id, task.id, 'Skim the board');
    store.updateChecklistItem(doc.id, task.id, task.checklist[0].id, { done: true });

    const events = [];
    store.addEventListener('recurrence-spawned', (e) => events.push(e.detail));

    store.moveTask(doc.id, task.id, done, 0);

    expect(doc.tasks).toHaveLength(2);
    const next = doc.tasks.find((t) => t.id !== task.id);
    expect(next.title).toBe('Weekly review');
    expect(next.columnId).toBe(first);
    expect(next.priority).toBe('medium');
    expect(next.checklist.map((i) => i.done)).toEqual([false]); // unticked
    expect(next.recurrence).toEqual(weekly);
    expect(events).toHaveLength(1);

    // The completed task hands the series over rather than repeating again.
    expect(task.recurrenceClosed).toBe(true);
    store.moveTask(doc.id, task.id, doc.columns[0].id, 0);
    store.moveTask(doc.id, task.id, done, 0);
    expect(doc.tasks).toHaveLength(2);
  });

  it('does not spawn on a reorder inside a done column', async () => {
    const doc = await makeProject();
    const done = doc.columns[2].id;
    const a = store.addTask(doc.id, done, { title: 'A', dueDate: '2026-08-06' });
    store.setRecurrence(doc.id, a.id, weekly);
    store.addTask(doc.id, done, { title: 'B' });

    store.moveTask(doc.id, a.id, done, 1);
    expect(doc.tasks).toHaveLength(2);
  });

  it('does not copy comments or attachments into the next occurrence', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'Chore' });
    store.setRecurrence(doc.id, task.id, weekly);
    store.addComment(doc.id, task.id, 'done for this week');
    store.moveTask(doc.id, task.id, doc.columns[2].id, 0);
    const next = doc.tasks.find((t) => t.id !== task.id);
    expect(next.comments).toEqual([]);
    expect(next.attachments).toEqual([]);
  });

  it('clearing the rule stops the series', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'Chore' });
    store.setRecurrence(doc.id, task.id, weekly);
    store.setRecurrence(doc.id, task.id, null);
    store.moveTask(doc.id, task.id, doc.columns[2].id, 0);
    expect(doc.tasks).toHaveLength(1);
  });

  it('a copy of a finished recurring task does not restart the series', async () => {
    const doc = await makeProject();
    const done = doc.columns[2].id;
    const task = store.addTask(doc.id, doc.columns[0].id, {
      title: 'Weekly review', dueDate: '2026-08-06',
    });
    store.setRecurrence(doc.id, task.id, weekly);
    store.moveTask(doc.id, task.id, done, 0);
    expect(doc.tasks).toHaveLength(2);

    // The copy sits in the done column too, and its series is already spent:
    // the catch-up pass on the next project open must find nothing to do.
    const copy = store.duplicateTask(doc.id, task.id);
    expect(copy.recurrenceClosed).toBe(true);
    expect(store.catchUpRecurring(doc.id)).toBe(0);
    expect(doc.tasks).toHaveLength(3);
  });

  it('a copy of a live recurring task keeps repeating', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, {
      title: 'Water plants', dueDate: '2026-08-06',
    });
    store.setRecurrence(doc.id, task.id, weekly);

    const copy = store.duplicateTask(doc.id, task.id);
    expect(copy.recurrenceClosed).toBe(false);
    store.moveTask(doc.id, copy.id, doc.columns[2].id, 0);
    expect(doc.tasks).toHaveLength(3);
  });

  it('catches up a done recurring task whose successor was never written', async () => {
    const doc = await makeProject();
    const done = doc.columns[2].id;
    // Simulate the crash case: in a done column, series still open.
    const task = store.addTask(doc.id, done, { title: 'Missed', dueDate: '2026-08-06' });
    task.recurrence = weekly;

    expect(store.catchUpRecurring(doc.id)).toBe(1);
    expect(doc.tasks).toHaveLength(2);
    // Idempotent: a second pass has nothing left to do.
    expect(store.catchUpRecurring(doc.id)).toBe(0);
  });
});

describe('duplication and templates', () => {
  it('places a duplicated task right below the original', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    store.addTask(doc.id, col, { title: 'First' });
    const source = store.addTask(doc.id, col, { title: 'Second', priority: 'high' });
    store.addTask(doc.id, col, { title: 'Third' });

    const copy = store.duplicateTask(doc.id, source.id);
    expect(copy.title).toBe('Second (copy)');
    expect(copy.priority).toBe('high');
    expect(columnTasks(doc.tasks, col).map((t) => t.title))
      .toEqual(['First', 'Second', 'Second (copy)', 'Third']);
  });

  it('does not copy comments or attachments into a duplicated task', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    store.addComment(doc.id, task.id, 'hi');
    const copy = store.duplicateTask(doc.id, task.id);
    expect(copy.comments).toEqual([]);
    expect(copy.attachments).toEqual([]);
  });

  it('duplicates a project with fresh ids, optionally without tasks', async () => {
    const doc = await makeProject('Original');
    store.addTask(doc.id, doc.columns[0].id, { title: 'Task' });
    await settle();

    const full = await store.duplicateProject(doc.id, { name: 'Copy' });
    expect(full.id).not.toBe(doc.id);
    expect(full.tasks).toHaveLength(1);
    expect(store.projects.map((p) => p.name)).toEqual(['Original', 'Copy']);

    const bare = await store.duplicateProject(doc.id, { name: 'Shell', includeTasks: false });
    expect(bare.tasks).toEqual([]);
    expect(bare.columns).toHaveLength(3);
  });

  it('saves a template and creates independent projects from it', async () => {
    const doc = await makeProject('Client work');
    store.addLabel(doc.id, { name: 'Billable', color: '#000' });
    store.addTask(doc.id, doc.columns[0].id, { title: 'Kickoff' });
    await settle();

    const template = await store.saveTemplate(doc.id, 'Client engagement');
    expect(template.doc.tasks).toEqual([]);
    expect(store.templates).toHaveLength(1);

    const a = await store.createFromTemplate(template.id, { name: 'Client A', color: '#111' });
    const b = await store.createFromTemplate(template.id, { name: 'Client B', color: '#222' });
    expect(a.labels[0].name).toBe('Billable');
    expect(a.labels[0].id).not.toBe(b.labels[0].id);
    expect(a.tasks).toEqual([]);

    const second = new Store();
    await second.init();
    expect(second.templates.map((t) => t.name)).toEqual(['Client engagement']);

    await store.deleteTemplate(template.id);
    expect(store.templates).toEqual([]);
    await expect(store.createFromTemplate(template.id, { name: 'X' })).rejects.toThrow();
  });
});

describe('archive', () => {
  it('takes a task out of the board without losing anything', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const task = store.addTask(doc.id, col, { title: 'Finished', priority: 'high' });
    store.addComment(doc.id, task.id, 'note');

    store.archiveTask(doc.id, task.id);
    expect(doc.tasks).toEqual([]);
    expect(doc.archive).toHaveLength(1);
    expect(doc.archive[0].comments).toHaveLength(1);
    expect(doc.archive[0].archivedAt).toBeTypeOf('number');

    store.unarchiveTask(doc.id, task.id);
    expect(doc.archive).toEqual([]);
    expect(columnTasks(doc.tasks, col).map((t) => t.title)).toEqual(['Finished']);
  });

  it('archives a whole done column in one action', async () => {
    const doc = await makeProject();
    const done = doc.columns[2].id;
    store.addTask(doc.id, done, { title: 'A' });
    store.addTask(doc.id, done, { title: 'B' });
    store.addTask(doc.id, doc.columns[0].id, { title: 'Keep' });

    const ids = store.archiveTasksIn(doc.id, done);
    expect(ids).toHaveLength(2);
    expect(doc.tasks.map((t) => t.title)).toEqual(['Keep']);
    expect(doc.archive.map((t) => t.title).sort()).toEqual(['A', 'B']);
  });

  it('keeps archived tasks out of progress and out of the trash', async () => {
    const doc = await makeProject();
    const done = doc.columns[2].id;
    const task = store.addTask(doc.id, done, { title: 'Done thing' });
    store.addTask(doc.id, doc.columns[0].id, { title: 'Open thing' });
    expect(projectProgress(doc)).toEqual({ total: 2, done: 1 });

    store.archiveTask(doc.id, task.id);
    expect(projectProgress(doc)).toEqual({ total: 1, done: 0 });
    expect(doc.trash).toEqual([]);
  });

  it('moves an archived task to the trash on demand', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'Old' });
    store.archiveTask(doc.id, task.id);
    store.trashArchivedTask(doc.id, task.id);
    expect(doc.archive).toEqual([]);
    expect(doc.trash.map((t) => t.title)).toEqual(['Old']);
    expect(doc.trash[0].archivedAt).toBeUndefined();
  });

  it('flags an archived project on its index entry only', async () => {
    const doc = await makeProject('Shipped');
    await store.setProjectArchived(doc.id, true);
    expect(store.projectEntry(doc.id).archived).toBe(true);

    const second = new Store();
    await second.init();
    expect(second.projectEntry(doc.id).archived).toBe(true);

    await store.setProjectArchived(doc.id, false);
    expect(store.projectEntry(doc.id).archived).toBe(false);
  });
});

describe('column settings', () => {
  const DAY = 24 * 3600 * 1000;

  it('stamps when a task reaches a done column, and clears it when it leaves', async () => {
    const doc = await makeProject();
    const [todo, , done] = doc.columns;
    const task = store.addTask(doc.id, todo.id, { title: 'Ship' });
    expect(task.doneAt).toBe(undefined);

    store.moveTask(doc.id, task.id, done.id, 0);
    const stamped = task.doneAt;
    expect(stamped).toBeGreaterThan(0);

    // Moving within the same done column is not a fresh arrival.
    store.moveTask(doc.id, task.id, done.id, 0);
    expect(task.doneAt).toBe(stamped);

    store.moveTask(doc.id, task.id, todo.id, 0);
    expect(task.doneAt).toBe(null);
  });

  it('archives what has sat in a done column past the age it was given', async () => {
    const doc = await makeProject();
    const [todo, , done] = doc.columns;
    store.updateColumn(doc.id, done.id, { autoArchiveDays: 7 });

    const old = store.addTask(doc.id, done.id, { title: 'Old' });
    const fresh = store.addTask(doc.id, done.id, { title: 'Fresh' });
    const open = store.addTask(doc.id, todo.id, { title: 'Still open' });
    old.doneAt = Date.now() - 8 * DAY;
    fresh.doneAt = Date.now() - 2 * DAY;
    open.doneAt = Date.now() - 40 * DAY; // not in a done column: never touched

    const ids = store.autoArchiveDone(doc.id);
    expect(ids).toEqual([old.id]);
    expect(doc.tasks.map((t) => t.title).sort()).toEqual(['Fresh', 'Still open']);
    expect(doc.archive.map((t) => t.title)).toEqual(['Old']);

    // Idempotent, and it costs no write when there is nothing to do.
    expect(store.autoArchiveDone(doc.id)).toEqual([]);
  });

  it('leaves a column alone with no rule, or with a rule on a non-done column', async () => {
    const doc = await makeProject();
    const [todo, , done] = doc.columns;
    store.updateColumn(doc.id, todo.id, { autoArchiveDays: 1 });
    const backlog = store.addTask(doc.id, todo.id, { title: 'Backlog' });
    const finished = store.addTask(doc.id, done.id, { title: 'Finished' });
    backlog.updatedAt = Date.now() - 30 * DAY;
    finished.updatedAt = Date.now() - 30 * DAY;

    expect(store.autoArchiveDone(doc.id)).toEqual([]);
    expect(doc.tasks).toHaveLength(2);
  });

  it('falls back to the last edit for work finished before there was a rule', async () => {
    const doc = await makeProject();
    const done = doc.columns[2];
    store.updateColumn(doc.id, done.id, { autoArchiveDays: 3 });
    const legacy = store.addTask(doc.id, done.id, { title: 'Legacy' });
    delete legacy.doneAt;
    legacy.updatedAt = Date.now() - 10 * DAY;

    expect(store.autoArchiveDone(doc.id)).toEqual([legacy.id]);
  });

  it('does not sweep a task straight back out after an undo', async () => {
    const doc = await makeProject();
    const done = doc.columns[2];
    store.updateColumn(doc.id, done.id, { autoArchiveDays: 3 });
    const task = store.addTask(doc.id, done.id, { title: 'Swept' });
    task.doneAt = Date.now() - 30 * DAY;

    const ids = store.autoArchiveDone(doc.id);
    store.bulkRestoreTasks(doc.id, ids, 'archive');
    expect(doc.tasks.map((t) => t.title)).toEqual(['Swept']);
    // Restored means it arrived again now, so the rule leaves it alone.
    expect(store.autoArchiveDone(doc.id)).toEqual([]);
  });

  it('rewrites order for a one-shot sort and puts it back on undo', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const a = store.addTask(doc.id, col, { title: 'A', dueDate: '2026-09-01' });
    const b = store.addTask(doc.id, col, { title: 'B', dueDate: '2026-08-01' });
    const before = [{ id: a.id, order: a.order }, { id: b.id, order: b.order }];

    const rewrites = planColumnSort(doc.tasks, col, 'due');
    const touched = store.setTaskOrders(doc.id, rewrites);
    expect(touched.sort()).toEqual([a.id, b.id].sort());
    expect(columnTasks(doc.tasks, col).map((t) => t.title)).toEqual(['B', 'A']);

    store.setTaskOrders(doc.id, before);
    expect(columnTasks(doc.tasks, col).map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('leaves updatedAt alone when it only rearranges cards', async () => {
    const doc = await makeProject();
    const col = doc.columns[0].id;
    const a = store.addTask(doc.id, col, { title: 'A', dueDate: '2026-09-01' });
    const b = store.addTask(doc.id, col, { title: 'B', dueDate: '2026-08-01' });
    a.updatedAt = 111;
    b.updatedAt = 222;

    store.setTaskOrders(doc.id, planColumnSort(doc.tasks, col, 'due'));
    expect([a.updatedAt, b.updatedAt]).toEqual([111, 222]);
  });
});

describe('checklists', () => {
  it('adds, toggles, reorders, and deletes items', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });

    const a = store.addChecklistItem(doc.id, task.id, 'Draft');
    const b = store.addChecklistItem(doc.id, task.id, 'Review');
    expect(task.checklist.map((i) => i.text)).toEqual(['Draft', 'Review']);

    store.updateChecklistItem(doc.id, task.id, a.id, { done: true });
    expect(task.checklist[0].done).toBe(true);

    store.moveChecklistItem(doc.id, task.id, b.id, 0);
    expect(task.checklist.map((i) => i.text)).toEqual(['Review', 'Draft']);

    store.deleteChecklistItem(doc.id, task.id, a.id);
    expect(task.checklist.map((i) => i.text)).toEqual(['Review']);
  });

  it('backfills the field on documents written before checklists existed', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    delete task.checklist;
    const item = store.addChecklistItem(doc.id, task.id, 'Step');
    expect(task.checklist).toEqual([item]);
  });

  it('persists items with the document', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    store.addChecklistItem(doc.id, task.id, 'Persisted step');
    await settle();
    const saved = JSON.parse(await (mock._fs.get(`projects-data/project-${doc.id}.json`)).text());
    expect(saved.tasks[0].checklist.map((i) => i.text)).toEqual(['Persisted step']);
  });
});

describe('comments', () => {
  it('attributes comments to the signed-in user', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    const c = store.addComment(doc.id, task.id, 'Looks good');
    expect(c.author).toBe('nadia');
    expect(task.comments).toHaveLength(1);

    store.deleteComment(doc.id, task.id, c.id);
    expect(task.comments).toHaveLength(0);
  });
});

describe('attachments', () => {
  it('writes the blob before recording metadata, and cleans up on delete', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    const att = await store.addAttachment(doc.id, task.id, file);
    expect(task.attachments).toHaveLength(1);
    const path = `projects-data/attachments/${doc.id}/${task.id}/${att.id}-notes.txt`;
    expect(mock._fs.has(path)).toBe(true);
    expect(await (await store.readAttachment(doc.id, task.id, att)).text()).toBe('hello');

    store.deleteAttachment(doc.id, task.id, att);
    await settle();
    expect(task.attachments).toHaveLength(0);
    expect(mock._fs.has(path)).toBe(false);
  });

  it('sanitizes hostile filenames into the fs path', async () => {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    const file = new File(['x'], '../../escape.txt', { type: 'text/plain' });
    const att = await store.addAttachment(doc.id, task.id, file);
    expect(att.name).not.toContain('/');
    expect(mock._fs.has(`projects-data/attachments/${doc.id}/${task.id}/${att.id}-${att.name}`)).toBe(true);
  });
});

describe('linked attachments', () => {
  async function taskWithDriveFile() {
    const doc = await makeProject();
    const task = store.addTask(doc.id, doc.columns[0].id, { title: 'Spec review' });
    await mock.fs.write('/demo/Desktop/spec.pdf', new Blob(['pdf bytes']));
    return { doc, task };
  }

  it('references a Drive file instead of copying it', async () => {
    const { doc, task } = await taskWithDriveFile();
    const att = store.addLinkedAttachment(doc.id, task.id, {
      path: '/demo/Desktop/spec.pdf', name: 'spec.pdf', size: 9, type: 'application/pdf',
    });

    expect(att.kind).toBe('link');
    expect(task.attachments).toEqual([att]);
    // Nothing was written into the app's attachment area.
    expect([...mock._fs.keys()].some((k) => k.includes('/attachments/'))).toBe(false);
    // ...and reading it goes to the Drive path.
    expect(await (await store.readAttachment(doc.id, task.id, att)).text()).toBe('pdf bytes');
  });

  it('reports a link whose file has moved', async () => {
    const { doc, task } = await taskWithDriveFile();
    const att = store.addLinkedAttachment(doc.id, task.id,
      { path: '/demo/Desktop/spec.pdf', name: 'spec.pdf' });
    expect(await store.attachmentExists(doc.id, task.id, att)).toBe(true);

    await mock.fs.delete('/demo/Desktop/spec.pdf');
    expect(await store.attachmentExists(doc.id, task.id, att)).toBe(false);
  });

  it('removing a link never deletes the file it points at', async () => {
    const { doc, task } = await taskWithDriveFile();
    const att = store.addLinkedAttachment(doc.id, task.id,
      { path: '/demo/Desktop/spec.pdf', name: 'spec.pdf' });

    store.deleteAttachment(doc.id, task.id, att);

    expect(task.attachments).toEqual([]);
    expect(mock._fs.has('/demo/Desktop/spec.pdf')).toBe(true);
  });

  it('turns a link into a copy when a backup carried the bytes', async () => {
    const { doc, task } = await taskWithDriveFile();
    store.addLinkedAttachment(doc.id, task.id,
      { path: '/demo/Desktop/spec.pdf', name: 'spec.pdf', size: 9, type: 'application/pdf' });
    await settle();

    const { data } = await store.exportBundle([doc.id]);
    const files = new Map();
    for (const p of data.projects) {
      for (const t of p.tasks) {
        for (const a of t.attachments) {
          files.set(`attachments/${p.id}/${t.id}/${a.id}-${a.name}`, new Blob(['pdf bytes']));
        }
      }
    }
    const summary = await store.importBackup({ data, files });

    expect(summary.projects).toBe(1);
    const imported = store.getDoc(store.projects.at(-1).id);
    const att = imported.tasks[0].attachments[0];
    // The bytes travelled, so the copy is the truth — a Drive path from
    // another account would not resolve.
    expect(att.kind).toBeUndefined();
    expect(att.path).toBeUndefined();
  });

  it('keeps a link that a backup could not carry', async () => {
    const { doc, task } = await taskWithDriveFile();
    store.addLinkedAttachment(doc.id, task.id,
      { path: '/demo/Desktop/spec.pdf', name: 'spec.pdf' });
    await settle();

    const { data } = await store.exportBundle([doc.id]);
    const summary = await store.importBackup({ data, files: new Map() });

    expect(summary.missingAttachments).toBe(0);
    const imported = store.getDoc(store.projects.at(-1).id);
    expect(imported.tasks[0].attachments[0]).toMatchObject({
      kind: 'link', path: '/demo/Desktop/spec.pdf',
    });
  });
});

describe('flushAll', () => {
  it('writes pending changes immediately and resolves when they land', async () => {
    const doc = await makeProject();
    store.addTask(doc.id, doc.columns[0].id, { title: 'Rushed' });
    expect(store.dirty).toBe(true);

    // No timer advance: flushAll itself must run the debounced write.
    await store.flushAll();
    expect(store.dirty).toBe(false);
    const saved = JSON.parse(await (mock._fs.get(`projects-data/project-${doc.id}.json`)).text());
    expect(saved.tasks.map((t) => t.title)).toEqual(['Rushed']);
  });

  it('answers "is this one unsaved" per project, not for the account', async () => {
    const a = await makeProject('A');
    const b = await makeProject('B');
    await settle();

    store.addTask(b.id, b.columns[0].id, { title: 'Only in B' });
    expect(store.dirty).toBe(true);
    expect(store.hasPendingSave(b.id)).toBe(true);
    expect(store.hasPendingSave(a.id)).toBe(false);

    await settle();
    expect(store.hasPendingSave(b.id)).toBe(false);
  });
});

describe('save races', () => {
  it('stays dirty when a mutation lands while a write is in flight', async () => {
    const doc = await makeProject();

    // Make fs.write hang so a mutation can race the in-flight write.
    const original = mock.fs.write;
    let releaseWrite;
    mock.fs.write = (path, data) => new Promise((resolve) => {
      releaseWrite = () => resolve(original(path, data));
    });

    store.addTask(doc.id, doc.columns[0].id, { title: 'First' });
    await vi.advanceTimersByTimeAsync(600); // debounce fires, write hangs
    expect(store.dirty).toBe(true);

    // This change is not in the hanging write's payload.
    store.addTask(doc.id, doc.columns[0].id, { title: 'Second' });

    mock.fs.write = original;
    releaseWrite();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // The stale write completing must not mark the store clean, or a
    // sign-out / tab-close flush would skip the newer change.
    expect(store.dirty).toBe(true);

    await store.flushAll();
    expect(store.dirty).toBe(false);
    const saved = JSON.parse(await (mock._fs.get(`projects-data/project-${doc.id}.json`)).text());
    expect(saved.tasks.map((t) => t.title)).toEqual(['First', 'Second']);
  });

  it('keeps the raced change in the outbox until it has actually gone out', async () => {
    const doc = await makeProject();
    await settle();

    const original = mock.fs.write;
    let releaseWrite;
    mock.fs.write = (path, data) => new Promise((resolve) => {
      releaseWrite = () => resolve(original(path, data));
    });

    store.addTask(doc.id, doc.columns[0].id, { title: 'First' });
    await vi.advanceTimersByTimeAsync(600);
    store.addTask(doc.id, doc.columns[0].id, { title: 'Second' });

    mock.fs.write = original;
    releaseWrite();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // 'Second' is not in what just landed, so this device is still ahead of
    // Puter: the mirror copy must stay marked as unsent.
    expect(store.pendingUploads).toBe(1);

    await store.flushAll();
    expect(store.pendingUploads).toBe(0);
  });

  // The debounce timer, the tab-hidden flush, and the online replay can each
  // start a save. Two in flight together must not check the file against
  // each other and call this tab's own write a conflict.
  it('queues a flush behind an in-flight write instead of raising a false conflict', async () => {
    const doc = await makeProject();
    store.addTask(doc.id, doc.columns[0].id, { title: 'First' });
    await settle();

    const path = `projects-data/project-${doc.id}.json`;
    const origWrite = mock.fs.write;
    const origStat = mock.fs.stat;
    // A stat takes a round trip; the timer save's write hangs until released.
    mock.fs.stat = (p) => new Promise((resolve, reject) => {
      setTimeout(() => origStat(p).then(resolve, reject), 10);
    });
    let releaseWrite;
    let writeCalls = 0;
    mock.fs.write = (p, data) => {
      writeCalls++;
      if (writeCalls === 1) {
        return new Promise((resolve) => { releaseWrite = () => resolve(origWrite(p, data)); });
      }
      return origWrite(p, data);
    };

    const conflicts = [];
    store.addEventListener('conflict', (e) => conflicts.push(e.detail.projectId));

    store.addTask(doc.id, doc.columns[0].id, { title: 'Second' });
    await vi.advanceTimersByTimeAsync(600); // debounce fires; the write hangs
    expect(writeCalls).toBe(1);

    const flush = store.flushAll(); // the tab went hidden mid-write
    await vi.advanceTimersByTimeAsync(5);
    releaseWrite();
    await vi.advanceTimersByTimeAsync(100);
    await flush;
    await settle();
    mock.fs.write = origWrite;
    mock.fs.stat = origStat;

    expect(conflicts).toEqual([]);
    expect(store.hasConflict(doc.id)).toBe(false);
    expect(store.dirty).toBe(false);
    const onDisk = JSON.parse(await mock._fs.get(path).text());
    expect(onDisk.tasks.map((t) => t.title)).toEqual(['First', 'Second']);
  });

  it('does not write a document back after its project was purged mid-save', async () => {
    const doc = await makeProject('Doomed');
    await settle();

    const origReaddir = mock.fs.readdir;
    let releaseSnapshot;
    // Hold the save inside its restore-point step, before the document write.
    mock.fs.readdir = (dir) => new Promise((resolve, reject) => {
      releaseSnapshot = () => origReaddir(dir).then(resolve, reject);
    });
    // A fresh store has no snapshot day recorded, so the first save looks.
    const fresh = new Store();
    await fresh.init();
    await fresh.loadProject(doc.id);
    fresh.addTask(doc.id, doc.columns[0].id, { title: 'Late' });
    await vi.advanceTimersByTimeAsync(600);
    expect(releaseSnapshot).toBeTypeOf('function');

    await fresh.purgeProject(doc.id);
    mock.fs.readdir = origReaddir;
    releaseSnapshot();
    await settle();

    expect(mock._fs.has(`projects-data/project-${doc.id}.json`)).toBe(false);
    expect(fresh.dirty).toBe(false);
    expect(fresh.pendingUploads).toBe(0);
  });
});

describe('stale overwrites', () => {
  /** Another window writing the same file, behind this store's back. */
  async function writeBehindOurBack(doc, mutate) {
    const path = `projects-data/project-${doc.id}.json`;
    const copy = JSON.parse(await mock._fs.get(path).text());
    mutate(copy);
    await mock.fs.write(path, JSON.stringify(copy));
  }

  it('refuses to overwrite a document that changed underneath it', async () => {
    const doc = await makeProject();
    store.addTask(doc.id, doc.columns[0].id, { title: 'Mine' });
    await settle();

    await writeBehindOurBack(doc, (d) => { d.name = 'Theirs'; });

    const conflicts = [];
    store.addEventListener('conflict', (e) => conflicts.push(e.detail.projectId));
    store.addTask(doc.id, doc.columns[0].id, { title: 'Also mine' });
    await settle();

    expect(conflicts).toEqual([doc.id]);
    expect(store.hasConflict(doc.id)).toBe(true);
    // The other window's file is untouched.
    const onDisk = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(onDisk.name).toBe('Theirs');
    // ...and the local work is still there, unsaved.
    expect(store.dirty).toBe(true);
  });

  it('stops writing while conflicted, however much is edited', async () => {
    const doc = await makeProject();
    await settle();
    await writeBehindOurBack(doc, (d) => { d.name = 'Theirs'; });
    store.addTask(doc.id, doc.columns[0].id, { title: 'One' });
    await settle();

    store.addTask(doc.id, doc.columns[0].id, { title: 'Two' });
    await settle();
    const onDisk = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(onDisk.tasks).toHaveLength(0);
    expect(store.hasConflict(doc.id)).toBe(true);
  });

  it('"keep mine" overwrites deliberately and clears the conflict', async () => {
    const doc = await makeProject();
    await settle();
    await writeBehindOurBack(doc, (d) => { d.name = 'Theirs'; });
    store.addTask(doc.id, doc.columns[0].id, { title: 'Mine' });
    await settle();
    expect(store.hasConflict(doc.id)).toBe(true);

    await store.forceSave(doc.id);

    expect(store.hasConflict(doc.id)).toBe(false);
    const onDisk = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(onDisk.tasks.map((t) => t.title)).toEqual(['Mine']);
    // The stamp is current again, so the next save goes through.
    store.addTask(doc.id, doc.columns[0].id, { title: 'Next' });
    await settle();
    const later = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(later.tasks).toHaveLength(2);
  });

  it('"reload" takes the other version and drops the local one', async () => {
    const doc = await makeProject();
    await settle();
    await writeBehindOurBack(doc, (d) => { d.name = 'Theirs'; d.tasks.push({ id: 'x', title: 'Theirs too', columnId: d.columns[0].id, order: 1, assigneeIds: [], labelIds: [], comments: [], attachments: [], checklist: [] }); });
    store.addTask(doc.id, doc.columns[0].id, { title: 'Mine' });
    await settle();

    const fresh = await store.reloadProject(doc.id);

    expect(store.hasConflict(doc.id)).toBe(false);
    expect(store.dirty).toBe(false);
    expect(fresh.name).toBe('Theirs');
    expect(fresh.tasks.map((t) => t.title)).toEqual(['Theirs too']);
  });

  it('a first write needs no stamp — there is nothing to overwrite', async () => {
    const doc = await makeProject('Brand new');
    expect(store.hasConflict(doc.id)).toBe(false);
    store.addTask(doc.id, doc.columns[0].id, { title: 'First' });
    await settle();
    expect(store.dirty).toBe(false);
  });
});

describe('restore points', () => {
  const snapDir = (id) => `projects-data/snapshots/project-${id}`;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    + `-${String(today.getDate()).padStart(2, '0')}`;

  it('keeps the version from before the first change of the day', async () => {
    const doc = await makeProject('Snapshotted');
    store.addTask(doc.id, doc.columns[0].id, { title: 'First' });
    await settle();

    const saved = JSON.parse(await mock._fs.get(`${snapDir(doc.id)}/${iso}.json`).text());
    // The snapshot holds the document as it was *before* the change.
    expect(saved.doc.tasks).toEqual([]);
    expect(saved.entry.name).toBe('Snapshotted');
    expect(saved.takenAt).toBeTypeOf('number');
  });

  it('takes one a day, not one a save', async () => {
    const doc = await makeProject();
    store.addTask(doc.id, doc.columns[0].id, { title: 'One' });
    await settle();
    store.addTask(doc.id, doc.columns[0].id, { title: 'Two' });
    await settle();

    const files = await store.listSnapshots(doc.id);
    expect(files).toHaveLength(1);
    expect(JSON.parse(await mock._fs.get(`${snapDir(doc.id)}/${iso}.json`).text()).doc.tasks)
      .toEqual([]);
  });

  it('restores the document, keeping the current state first', async () => {
    const doc = await makeProject();
    store.addTask(doc.id, doc.columns[0].id, { title: 'Yesterday' });
    await settle();                       // snapshot: no tasks
    store.addTask(doc.id, doc.columns[0].id, { title: 'A mistake' });
    await settle();

    await store.restoreSnapshot(doc.id, `${iso}.json`);

    expect(store.getDoc(doc.id).tasks).toEqual([]);
    const onDisk = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(onDisk.tasks).toEqual([]);
    // The state it replaced is itself a restore point now.
    const files = await store.listSnapshots(doc.id);
    expect(files.map((f) => f.name)).toContain(`${iso}-1.json`);
    const undo = JSON.parse(await mock._fs.get(`${snapDir(doc.id)}/${iso}-1.json`).text());
    expect(undo.doc.tasks.map((t) => t.title)).toEqual(['Yesterday', 'A mistake']);
  });

  it('brings back a project whose index entry is gone', async () => {
    const doc = await makeProject('Vanished');
    store.addTask(doc.id, doc.columns[0].id, { title: 'Work' });
    await settle();

    await store.deleteProject(doc.id);
    await store.purgeProject(doc.id);
    // Purging wipes the restore points too, so this test writes one back the
    // way a still-deleted-but-not-purged project would have kept it.
    await mock.fs.write(`${snapDir(doc.id)}/${iso}.json`, JSON.stringify({
      v: 1,
      takenAt: Date.now(),
      entry: { id: doc.id, name: 'Vanished', color: '#000', createdAt: 1 },
      doc: { ...doc, tasks: [] },
    }));

    expect(store.projectEntry(doc.id)).toBeNull();
    await store.restoreSnapshot(doc.id, `${iso}.json`);
    expect(store.projectEntry(doc.id)?.name).toBe('Vanished');
  });

  it('lists every project that has restore points', async () => {
    const a = await makeProject('A');
    const b = await makeProject('B');
    store.addTask(a.id, a.columns[0].id, { title: 'x' });
    store.addTask(b.id, b.columns[0].id, { title: 'y' });
    await settle();

    const rows = await store.listSnapshotProjects();
    expect(rows.map((r) => r.entry.name).sort()).toEqual(['A', 'B']);
    expect(rows.every((r) => r.listed && r.snapshots.length === 1)).toBe(true);
  });

  it('purges beyond the retention policy when a project is opened', async () => {
    const doc = await makeProject();
    // Twenty days of restore points, written directly.
    for (let i = 0; i < 20; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        + `-${String(d.getDate()).padStart(2, '0')}.json`;
      await mock.fs.write(`${snapDir(doc.id)}/${name}`, JSON.stringify({ v: 1, doc }));
    }
    expect(await store.listSnapshots(doc.id)).toHaveLength(20);

    await store.purgeSnapshots(doc.id);
    const left = await store.listSnapshots(doc.id);
    expect(left.length).toBeLessThanOrEqual(11);
    expect(left.length).toBeGreaterThanOrEqual(7);
  });
});

describe('project index', () => {
  it('merges instead of clobbering what another window added', async () => {
    const mine = await makeProject('Mine');
    // Another window creates a project and writes the index we never saw.
    const theirs = { id: 'other', name: 'Theirs', color: '#000', createdAt: 1 };
    await mock.kv.set('pm:projects:v1', JSON.stringify([
      ...JSON.parse(await mock.kv.get('pm:projects:v1')), theirs,
    ]));

    await makeProject('Second of mine');

    const index = JSON.parse(await mock.kv.get('pm:projects:v1'));
    expect(index.map((p) => p.name).sort())
      .toEqual(['Mine', 'Second of mine', 'Theirs']);
    expect(store.projects.map((p) => p.name)).toContain('Theirs');
    expect(mine.id).toBeTruthy();
  });

  it('still removes what this window deleted', async () => {
    const doomed = await makeProject('Doomed');
    await makeProject('Kept');
    await store.deleteProject(doomed.id);
    const index = JSON.parse(await mock.kv.get('pm:projects:v1'));
    expect(index.map((p) => p.name)).toEqual(['Kept']);
  });
});

describe('offline reads', () => {
  it('keeps the version its cached copy was based on', async () => {
    const stub = installMirrorStub();
    try {
      const first = new Store();
      await first.init();
      const doc = await first.createProject({ name: 'Cached', color: '#000000' });
      first.addTask(doc.id, doc.columns[0].id, { title: 'Mine' });
      await settle();

      // A later session on the same device, with no connection: the document
      // comes from the mirror rather than from Puter.
      const path = `projects-data/project-${doc.id}.json`;
      const read = mock.fs.read;
      mock.fs.read = async () => { throw new TypeError('Failed to fetch'); };
      const second = new Store();
      await second.init();
      const shown = await second.loadProject(doc.id);
      expect(shown.tasks.map((t) => t.title)).toEqual(['Mine']);
      expect(second.offline).toBe(true);
      mock.fs.read = read;

      // Somewhere else saved the project while this window was away.
      const theirs = JSON.parse(await mock._fs.get(path).text());
      theirs.name = 'Theirs';
      await mock.fs.write(path, JSON.stringify(theirs));

      // The next write has to ask which copy wins, not silently overwrite.
      const conflicts = [];
      second.addEventListener('conflict', (e) => conflicts.push(e.detail.projectId));
      second.addTask(doc.id, doc.columns[0].id, { title: 'Also mine' });
      await settle();

      expect(conflicts).toEqual([doc.id]);
      expect(JSON.parse(await mock._fs.get(path).text()).name).toBe('Theirs');
    } finally {
      stub.restore();
    }
  });
});

describe('save failures', () => {
  it('stays dirty and emits save-error when the write is refused', async () => {
    const doc = await makeProject();
    const errors = [];
    store.addEventListener('save-error', (e) => errors.push(e.detail));
    const original = mock.fs.write;
    // A refusal is an answer from the server, not a lost connection.
    mock.fs.write = async () => {
      const err = new Error('permission denied');
      err.code = 'forbidden';
      throw err;
    };

    store.addTask(doc.id, doc.columns[0].id, { title: 'T' });
    await settle();
    expect(errors).toHaveLength(1);
    expect(store.dirty).toBe(true);

    mock.fs.write = original;
    errors[0].retry();
    await settle();
    expect(store.dirty).toBe(false);
  });

  it('a replay still notices a document that changed while it was away', async () => {
    const doc = await makeProject();
    await settle();
    const original = mock.fs.write;
    mock.fs.write = async () => { throw new TypeError('Failed to fetch'); };
    store.addTask(doc.id, doc.columns[0].id, { title: 'Offline work' });
    await settle();
    expect(store.pendingUploads).toBe(1);

    // Another device saves in the meantime.
    mock.fs.write = original;
    const path = `projects-data/project-${doc.id}.json`;
    const theirs = JSON.parse(await mock._fs.get(path).text());
    theirs.name = 'Theirs';
    await mock.fs.write(path, JSON.stringify(theirs));

    const conflicts = [];
    store.addEventListener('conflict', (e) => conflicts.push(e.detail.projectId));
    await store.syncOutbox();

    expect(conflicts).toEqual([doc.id]);
    expect(JSON.parse(await mock._fs.get(path).text()).name).toBe('Theirs');
  });

  it('treats a lost connection as offline, and sends it when it returns', async () => {
    const doc = await makeProject();
    await settle();
    const errors = [];
    const states = [];
    store.addEventListener('save-error', (e) => errors.push(e.detail));
    store.addEventListener('connection', (e) => states.push(e.detail.offline));

    const original = mock.fs.write;
    mock.fs.write = async () => { throw new TypeError('Failed to fetch'); };
    store.addTask(doc.id, doc.columns[0].id, { title: 'Written on a train' });
    await settle();

    // No error toast for something that is not the user's problem yet.
    expect(errors).toEqual([]);
    expect(store.offline).toBe(true);
    expect(store.pendingUploads).toBe(1);

    mock.fs.write = original;
    await store.syncOutbox();
    await settle();

    expect(store.pendingUploads).toBe(0);
    expect(store.offline).toBe(false);
    expect(states).toEqual([true, false]);
    const onDisk = JSON.parse(await mock._fs.get(`projects-data/project-${doc.id}.json`).text());
    expect(onDisk.tasks.map((t) => t.title)).toEqual(['Written on a train']);
  });
});

describe('export & sample wipe', () => {
  it('exports every project document', async () => {
    const a = await makeProject('A');
    await makeProject('B');
    store.addTask(a.id, a.columns[0].id, { title: 'T' });
    const dump = await store.exportAll();
    expect(dump.projects.map((p) => p.name)).toEqual(['A', 'B']);
    expect(dump.projects[0].tasks).toHaveLength(1);
  });

  it('wipes only sample-flagged projects', async () => {
    await makeProject('Mine');
    await store.createProject({ name: 'Sample', color: '#000', sample: true });
    await store.updateSettings({ sampleData: true });

    await store.wipeSampleData();
    expect(store.projects.map((p) => p.name)).toEqual(['Mine']);
    expect(store.settings.sampleData).toBe(false);
  });
});
