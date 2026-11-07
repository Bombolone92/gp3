import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createDraftStore } from '../src/lib/drafts.js';
import { memoryStorage } from '../src/lib/readstate.js';
import { subjectFromFilename } from '../src/lib/mime.js';
import { locate, planChanges, mailSubject } from '../src/lib/watch.js';

/**
 * The mailbox watched through the Events API rather than polled. Mail that
 * lands shows up on its own, and so does what another device does to the
 * folders -- without a timer, and without the reader pressing Refresh.
 *
 * Mounted as a real account, because the sample inbox is static and never
 * watches. The Events API is a fake that hands the subscription's handler
 * back, so a test plays the server: it changes the fs the way emailrx or
 * another device would, then sends the event the server would have sent.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
// Past the half-second the shell gathers events for, plus a listing.
const acted = () => settle(900);

const MAIL = '/sample/.mail';

const LATE = [
  'From: Ana Petrova <ana@example.com>',
  'To: sample@puter.com',
  'Subject: Late arrival',
  'Date: Mon, 17 Aug 2026 10:30:00 GMT',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'One more thing before the quarter closes.',
].join('\r\n');

/** A fake `puter.events`: records subscriptions and lets a test fire events. */
const fakeEvents = () => {
  const calls = [];
  const events = {
    calls,
    failWith: null,
    async onLocal(subject, handler, options = {}) {
      if (events.failWith) throw events.failWith;
      const sub = { subId: `sub-${calls.length}`, subject, off: vi.fn(async () => {}) };
      calls.push({ subject, handler, options, sub });
      return sub;
    },
    /** What the server would deliver to the subscription standing now. */
    emit: (event) => calls.at(-1)?.handler({ event }),
  };
  return events;
};

let root;
let mailbox;
let events;

const mount = async ({ sample = false } = {}) => {
  mailbox = createSampleMailbox();
  events = fakeEvents();
  renderApp(root, {
    ...mailbox,
    sample,
    events,
    account: { username: sample ? 'sample' : 'tester' },
    ...(sample ? {} : {
      drafts: createDraftStore('tester', memoryStorage()),
      onCompose: () => {},
    }),
  });
  await settle();
};

// Subjects of single-message conversations in the sample inbox: the sample
// also carries a three-message thread, and a test that picked a row by
// position could land on it, where losing one message does not lose the row.
const RECEIPT = 'Your receipt from Nimbus Coffee';
const REPORT = 'Q3 usage report attached';
const NOTES = 'Notes from the roadmap session';

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const subjects = () => rows().map((row) => row.querySelector('.row-subject').textContent);
const rowFor = (subject) => rows().find((row) => row.querySelector('.row-subject').textContent === subject);
const pill = () => root.querySelector('.new-mail');

const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle(250);
};

const actOn = async (subject, label) => {
  [...rowFor(subject).querySelectorAll('.row-action')]
    .find((button) => (button.getAttribute('aria-label') || '').startsWith(label))
    .click();
  await settle(250);
};

/** Every message file in a folder, as the fs lists it. */
const filesIn = async (dir) => {
  const { fs } = mailbox;
  const days = (await fs.readdir(dir)).filter((item) => item.is_dir).map((item) => item.name).sort();
  const files = [];
  for (const day of days) {
    for (const item of await fs.readdir(`${dir}/${day}`)) if (!item.is_dir) files.push({ ...item, day });
  }
  return files;
};

const fileFor = async (subject, dir = mailbox.objectsPath) =>
  (await filesIn(dir)).find((item) => subjectFromFilename(item.name) === subject);

// Delivered the way emailrx does it: a file that sorts above every real uuid
// v7, in the newest day folder. Returns the path, without telling anyone.
const land = async (raw = LATE, subject = 'Late arrival') => {
  const { fs, objectsPath } = mailbox;
  const days = (await fs.readdir(objectsPath))
    .filter((item) => item.is_dir).map((item) => item.name).sort();
  const name = `ffffffff-ffff-7fff-8fff-ffffffffffff--${btoa(subject).replace(/=+$/, '')}`;
  const path = `${objectsPath}/${days.at(-1)}/${name}`;
  await fs.write(path, new Blob([raw]));
  return path;
};

beforeEach(() => {
  window.localStorage.clear();
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
  window.localStorage.clear();
});

describe('locate', () => {
  it('names the folder, day and file of a message path', () => {
    expect(locate(MAIL, `${MAIL}/objects/2026-08-17/abc--U3Vi`))
      .toEqual({ box: 'inbox', day: '2026-08-17', name: 'abc--U3Vi' });
    expect(locate(MAIL, `${MAIL}/trash/2026-08-17/abc--U3Vi`).box).toBe('trash');
  });

  it('knows a folder-level path from a message', () => {
    expect(locate(MAIL, `${MAIL}/objects`)).toEqual({ box: 'inbox', day: null, name: null });
    expect(locate(MAIL, `${MAIL}/archive/2026-08-17`)).toEqual({ box: 'archive', day: '2026-08-17', name: null });
    // Deeper than a message can be is not a message either.
    expect(locate(MAIL, `${MAIL}/objects/2026-08-17/dir/file`).name).toBeNull();
  });

  it('is null outside the mailbox, and in a directory that is not a folder', () => {
    expect(locate(MAIL, '/sample/Documents/x')).toBeNull();
    expect(locate(MAIL, `${MAIL}/attachments/x`)).toBeNull();
    expect(locate(MAIL, MAIL)).toBeNull();
    expect(locate(MAIL, undefined)).toBeNull();
  });
});

describe('planChanges', () => {
  const at = (box, day, name) => `${MAIL}/${{ inbox: 'objects' }[box] ?? box}/${day}/${name}`;

  it('reads a write into a folder as mail arriving there', () => {
    const plan = planChanges(MAIL, [{ op: 'add', path: at('inbox', '2026-08-17', 'a--x') }]);
    expect([...plan.arrived.get('inbox')]).toEqual([at('inbox', '2026-08-17', 'a--x')]);
    expect(plan.filed.size).toBe(0);
    expect(plan.gap).toBe(false);
  });

  it('reads a move as leaving one folder and being filed in another', () => {
    const from = at('inbox', '2026-08-17', 'a--x');
    const to = at('archive', '2026-08-17', 'a--x');
    const plan = planChanges(MAIL, [{ op: 'move', from, path: to }]);
    expect([...plan.left.get('inbox')]).toEqual([from]);
    expect([...plan.filed.get('archive')]).toEqual([to]);
    expect(plan.arrived.size).toBe(0);
  });

  it('reads a removal as leaving', () => {
    const path = at('trash', '2026-08-17', 'a--x');
    const plan = planChanges(MAIL, [{ op: 'remove', path }]);
    expect([...plan.left.get('trash')]).toEqual([path]);
  });

  it('makes nothing of a new day folder, and re-reads a folder that lost one', () => {
    const quiet = planChanges(MAIL, [{ op: 'add', path: `${MAIL}/objects/2026-08-18` }]);
    expect(quiet.arrived.size + quiet.filed.size + quiet.disturbed.size).toBe(0);
    const gone = planChanges(MAIL, [{ op: 'remove', path: `${MAIL}/objects/2026-08-18` }]);
    expect([...gone.disturbed]).toEqual(['inbox']);
    const moved = planChanges(MAIL, [{ op: 'move', from: `${MAIL}/trash/2026-08-18`, path: `${MAIL}/archive/2026-08-18` }]);
    expect([...moved.disturbed].sort()).toEqual(['archive', 'trash']);
  });

  it('reads a gap as a gap, whatever else came with it', () => {
    const plan = planChanges(MAIL, [
      { op: 'add', path: at('inbox', '2026-08-17', 'a--x') },
      { op: 'gap', reason: 'coalesce_limit' },
    ]);
    expect(plan.gap).toBe(true);
  });

  it('reads a home-relative path as the absolute one', () => {
    const plan = planChanges(MAIL, [{ op: 'add', path: '~/.mail/objects/2026-08-17/a--x' }]);
    expect([...plan.arrived.get('inbox')]).toEqual([at('inbox', '2026-08-17', 'a--x')]);
  });

  it('ignores what is not the mailbox, not a change, or not an event', () => {
    const plan = planChanges(MAIL, [
      { op: 'add', path: '/sample/Documents/notes.txt' },
      { op: 'meta', path: at('inbox', '2026-08-17', 'a--x') },
      { op: 'write', path: `${MAIL}/objects` },
      null,
      'nonsense',
    ]);
    expect(plan.arrived.size + plan.filed.size + plan.left.size + plan.disturbed.size).toBe(0);
    expect(plan.gap).toBe(false);
  });
});

describe('the subscription', () => {
  it('covers the whole mailbox, once, with somewhere to report a lapse', async () => {
    await mount();
    expect(events.calls).toHaveLength(1);
    expect(events.calls[0].subject).toBe(mailSubject(MAIL));
    expect(events.calls[0].subject).toBe('fs:/sample/.mail');
    expect(typeof events.calls[0].options.onError).toBe('function');
  });

  it('is never made for the sample inbox', async () => {
    await mount({ sample: true });
    expect(events.calls).toHaveLength(0);
  });

  it('ends when the shell is replaced', async () => {
    await mount();
    const { sub } = events.calls[0];
    // Signing out renders the gate over the same root.
    root.replaceChildren();
    await settle(50);
    expect(sub.off).toHaveBeenCalledTimes(1);
  });

  it('is asked for again when the connection comes back after a lapse', async () => {
    await mount();
    events.calls[0].options.onError({ message: 'gone', code: 'events_connection_failed' });
    window.dispatchEvent(new Event('online'));
    await settle(50);
    expect(events.calls).toHaveLength(2);
    expect(events.calls[1].subject).toBe('fs:/sample/.mail');
  });

  it('leaves the app working when it cannot be had', async () => {
    mailbox = createSampleMailbox();
    events = fakeEvents();
    events.failWith = Object.assign(new Error('Events are not enabled'), { code: 'events_disabled' });
    renderApp(root, {
      ...mailbox, sample: false, events, account: { username: 'tester' },
      drafts: createDraftStore('tester', memoryStorage()), onCompose: () => {},
    });
    await settle();
    const before = subjects().length;
    expect(before).toBeGreaterThan(0);
    // The tab coming back is still a moment the inbox is checked.
    await land();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(600);
    expect(subjects()[0]).toBe('Late arrival');
    expect(subjects()).toHaveLength(before + 1);
  });
});

describe('mail that lands', () => {
  it('appears on its own, with no timer and no refresh', async () => {
    await mount();
    const before = rows();
    const path = await land();
    events.emit({ op: 'add', path, uid: 'u1', self: false, ts: Date.now(), seq: 0 });
    await acted();

    expect(subjects()[0]).toBe('Late arrival');
    expect(subjects()).toHaveLength(before.length + 1);
    // Prepended, not rebuilt: the rows that were there are the same nodes.
    for (const row of before) expect(row.isConnected).toBe(true);
    expect(document.title).toMatch(/\(\d+\)$/);
  });

  it('is understood by a home-relative path too', async () => {
    await mount();
    const path = await land();
    events.emit({ op: 'add', path: path.replace('/sample/', '~/') });
    await acted();
    expect(subjects()[0]).toBe('Late arrival');
  });

  it('is announced when it lands under another folder', async () => {
    await mount();
    await openFolder('Trash');
    const path = await land();
    events.emit({ op: 'add', path });
    await acted();
    expect(pill().hidden).toBe(false);
    expect(pill().textContent).toBe('1 new message');
  });

  it('is one listing for a burst of events', async () => {
    await mount();
    const first = await land();
    const second = await land(LATE.replace('Late arrival', 'Later still'), 'Later still');
    const readdir = vi.spyOn(mailbox.fs, 'readdir');
    events.emit({ op: 'add', path: first });
    events.emit({ op: 'add', path: second });
    events.emit({ op: 'write', path: second });
    await acted();
    expect(subjects().slice(0, 2).sort()).toEqual(['Late arrival', 'Later still']);
    // The folder list plus the newest day: one check, not three.
    expect(readdir).toHaveBeenCalledTimes(2);
  });
});

describe('what another device does', () => {
  it('takes a deleted message out of the list without re-listing it', async () => {
    await mount();
    const kept = rows().filter((row) => row !== rowFor(RECEIPT));
    const file = await fileFor(RECEIPT);
    await mailbox.fs.delete(file.path);
    events.emit({ op: 'remove', path: file.path });
    await acted();

    expect(subjects()).not.toContain(RECEIPT);
    expect(rows()).toEqual(kept);
  });

  it('files an archived message where the other device put it', async () => {
    await mount();
    const file = await fileFor(REPORT);
    const to = `${MAIL}/archive/${file.day}`;
    const { path } = await mailbox.fs.move(file.path, to);
    events.emit({ op: 'move', from: file.path, path });
    await acted();

    expect(subjects()).not.toContain(REPORT);
    await openFolder('Archive');
    expect(subjects()).toEqual([REPORT]);
  });

  it('shows a message restored into the inbox, without calling it new', async () => {
    await mount();
    const order = subjects();
    // Filed away here -- and the server says so, as it would ...
    const was = (await fileFor(REPORT)).path;
    await actOn(REPORT, 'Archive');
    expect(subjects()).not.toContain(REPORT);
    const file = await fileFor(REPORT, `${MAIL}/archive`);
    events.emit({ op: 'move', from: was, path: file.path, self: true });
    await acted();
    await openFolder('Trash');
    // ... and put back by another device.
    const { path } = await mailbox.fs.move(file.path, `${mailbox.objectsPath}/${file.day}`);
    events.emit({ op: 'move', from: file.path, path, self: true });
    await acted();

    expect(pill().hidden).toBe(true);
    await openFolder('Inbox');
    expect(subjects()).toEqual(order);
  });

  it('re-lists the folder on screen when told a gap was left', async () => {
    await mount();
    const before = subjects();
    // Gone from the filesystem with no event to say so.
    await mailbox.fs.delete((await fileFor(NOTES)).path);
    events.emit({ op: 'gap', reason: 'coalesce_limit' });
    await acted();
    expect(subjects()).toEqual(before.filter((subject) => subject !== NOTES));
  });
});

describe('what this shell does itself', () => {
  it('is not mistaken for another device when the events for it arrive', async () => {
    await mount();
    await actOn(NOTES, 'Archive');
    const after = rows();
    const file = await fileFor(NOTES, `${MAIL}/archive`);
    const from = `${mailbox.objectsPath}/${file.day}/${file.name}`;
    events.emit({ op: 'move', from, path: file.path, self: true });
    await acted();

    expect(rows()).toEqual(after);
    await openFolder('Archive');
    expect(subjects()).toEqual([NOTES]);
  });

  it('does not announce its own restore as new mail', async () => {
    await mount();
    const order = subjects();
    await actOn(RECEIPT, 'Delete');
    await openFolder('Trash');
    await actOn(RECEIPT, 'Restore');
    const file = await fileFor(RECEIPT);
    events.emit({ op: 'move', from: `${MAIL}/trash/${file.day}/${file.name}`, path: file.path, self: true });
    await acted();

    expect(pill().hidden).toBe(true);
    await openFolder('Inbox');
    expect(subjects()).toEqual(order);
  });
});
