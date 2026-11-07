import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createDraftStore } from '../src/lib/drafts.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * The shell over the sample mailbox, with sending switched on so the Drafts
 * folder exists. Only the search path is exercised here: it is the one part of
 * the shell that runs over a folder the filesystem knows nothing about.
 */

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

const A_DRAFT = {
  id: 'd1',
  domain: 'puter.email',
  to: 'Ana Petrova <ana@example.com>',
  cc: '',
  subject: 'Quarter close',
  body: 'Numbers for the quarter close are in the sheet.',
  inReplyTo: '',
  references: '',
  attachments: 0,
};

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  const drafts = createDraftStore('test', memoryStorage());
  drafts.save(A_DRAFT);
  renderApp(root, {
    fs,
    mailPath,
    objectsPath,
    sample: true,
    account: { username: 'sample' },
    drafts,
    onCompose: () => {},
  });
  return { drafts };
};

const click = (label) => {
  const node = [...root.querySelectorAll('button')]
    .find((button) => button.textContent.trim().startsWith(label));
  node.click();
  return node;
};

const search = async (text) => {
  const input = root.querySelector('.search-input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(400);
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  // The toast region is created once and kept on the body, so clear the
  // toasts inside it rather than removing it.
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('deleting for good', () => {
  const trashOne = async () => {
    const row = [...root.querySelectorAll('.row')][0];
    const subject = row.querySelector('.row-subject').textContent;
    [...row.querySelectorAll('.row-action')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('Delete'))
      .click();
    await settle(150);
    click('Trash');
    await settle(200);
    return subject;
  };

  it('asks with a dialog of its own, and keeps the message on cancel', async () => {
    mount();
    await settle(200);
    const subject = await trashOne();
    expect(root.querySelectorAll('.row')).toHaveLength(1);

    [...root.querySelectorAll('.row-action')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('Delete forever'))
      .click();
    await settle(80);

    // window.confirm answers false in the cross-origin iframe a Puter app runs
    // in, so the guard has to be a dialog this app draws itself.
    const panel = document.querySelector('.modal-panel');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.modal-title').textContent).toBe('Delete forever?');

    [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    await settle(150);
    expect(document.querySelector('.modal-panel')).toBeNull();
    expect([...root.querySelectorAll('.row')].map((r) => r.querySelector('.row-subject').textContent))
      .toEqual([subject]);
  });

  it('deletes when the dialog is confirmed', async () => {
    mount();
    await settle(200);
    await trashOne();

    [...root.querySelectorAll('.row-action')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('Delete forever'))
      .click();
    await settle(80);
    [...document.querySelector('.modal-panel').querySelectorAll('button')]
      .find((b) => b.textContent === 'Delete forever').click();
    await settle(250);

    expect(root.querySelectorAll('.row')).toHaveLength(0);
    expect(root.querySelector('.center').textContent).toContain('Trash is empty');
  });
});

describe('undoing a move', () => {
  const bulk = (label) => {
    const all = root.querySelector('.select-all');
    all.checked = true;
    all.dispatchEvent(new Event('change', { bubbles: true }));
    [...root.querySelectorAll('.list-actions .icon-btn')]
      .find((button) => button.getAttribute('aria-label') === label)
      .click();
  };

  it('puts the rows back on screen after the folder has been emptied', async () => {
    mount();
    await settle(250);
    const before = root.querySelectorAll('.row').length;
    expect(before).toBeGreaterThan(1);

    bulk('Archive');
    await settle(1500);
    expect(root.querySelectorAll('.row')).toHaveLength(0);
    expect(root.querySelector('.center')).not.toBeNull();

    document.querySelector('.toast-action').click();
    await settle(1200);

    // The empty panel replaces the whole scroller, so restoring into it has to
    // rebuild the list rather than filter one that is no longer in the page.
    expect(root.querySelectorAll('.row')).toHaveLength(before);
    expect(rows()).toHaveLength(before);
    // Fourteen messages in twelve rows: the sample inbox holds one
    // conversation of three, and the rows are conversations.
    expect(root.querySelector('.list-meta').textContent)
      .toBe(`14 messages in ${before} conversations, 14 unread`);
  });
});

describe('searching a folder', () => {
  it('keeps selective search counts and candidates correct through archive and undo', async () => {
    mount();
    await settle(200);
    await search('subject:Q3 from:petrova');
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 14 messages');
    const row = rows()[0];
    row.querySelector('[aria-label^="Archive"]').click();
    await settle(200);
    expect(root.querySelector('.list-meta').textContent).toBe('0 results in 13 messages');
    const undo = [...document.querySelectorAll('.toast button')].find(button => button.textContent === 'Undo');
    undo.click();
    await settle(200);
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 14 messages');
    expect(rows()[0].querySelector('.row-subject').textContent).toBe('Q3 usage report attached');
  });

  it('retries failed headers on a repeated search without rereading successful ones', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let fail = false;
    const reads = new Map();
    const interrupted = { ...fs, read: async (path, ...args) => {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      if (fail) throw new Error('offline');
      return fs.read(path, ...args);
    } };
    renderApp(root, {
      fs: interrupted, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 3,
    });
    await settle(400);
    const successful = new Map(reads);
    expect(successful.size).toBeGreaterThan(0);
    fail = true;
    await search('from:petrova');
    expect(rows()).toHaveLength(0);
    fail = false;
    root.querySelector('.search-input').dispatchEvent(new Event('search', { bubbles: true }));
    await settle(400);
    expect(rows().map((row) => row.querySelector('.row-subject').textContent))
      .toEqual(['Q3 usage report attached']);
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 14 messages');
    for (const [path, count] of successful) expect(reads.get(path)).toBe(count);
  });

  it('keeps the loading view while the next folder is still being listed', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let readGate = null;
    let releaseReads;
    let releaseListing;
    const listingGate = new Promise((resolve) => { releaseListing = resolve; });
    const slow = { ...fs,
      read: async (...args) => { if (readGate) await readGate; return fs.read(...args); },
      readdir: async (path) => {
        if (path === `${mailPath}/archive`) { await listingGate; return []; }
        return fs.readdir(path);
      },
    };
    renderApp(root, {
      fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 5,
    });
    await settle(400);
    readGate = new Promise((resolve) => { releaseReads = resolve; });
    try {
      await search('zzzzqqq');
      click('Archive');
      expect(root.querySelector('.loading-list')).not.toBeNull();
      releaseReads();
      await settle(600);
      expect(root.querySelector('.loading-list')).not.toBeNull();
      expect(rows()).toHaveLength(0);
      releaseListing();
      await settle(400);
      expect(root.querySelector('.loading-list')).toBeNull();
      expect(root.querySelector('.list-meta').textContent).toBe('0 results in 0 messages');
    } finally {
      releaseReads();
      releaseListing();
    }
  });

  it('keeps a search failure visible when reads from the previous folder finish', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let gate = null;
    let release;
    const slow = { ...fs,
      read: async (...args) => { if (gate) await gate; return fs.read(...args); },
      readdir: async (path) => {
        if (path === `${mailPath}/archive`) throw new Error('offline');
        return fs.readdir(path);
      },
    };
    renderApp(root, {
      fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 5,
    });
    await settle(400);
    gate = new Promise((resolve) => { release = resolve; });
    try {
      await search('zzzzqqq');
      expect(root.querySelector('.list-meta').textContent).toMatch(/searching \d+ of 14/);
      click('Archive');
      await settle(200);
      expect(root.querySelector('.center').textContent).toContain('Could not search this folder: offline');
      release();
      await settle(600);
      expect(root.querySelector('.center').textContent).toContain('Could not search this folder: offline');
      expect(root.querySelector('.list-meta').textContent).toBe('Search unavailable');
      expect(rows()).toHaveLength(0);
    } finally {
      release();
    }
    click('Inbox');
    await settle(400);
    expect(root.querySelector('.list-meta').textContent).toBe('0 results in 14 messages');
  });

  it('reports a failed day listing and retries the complete folder on the next search', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let fail = false;
    const interrupted = { ...fs, readdir: async (path) => {
      if (fail && path.startsWith(`${objectsPath}/`)) throw new Error('offline');
      return fs.readdir(path);
    } };
    renderApp(root, {
      fs: interrupted, mailPath, objectsPath, sample: true, account: { username: 'sample' },
    });
    await settle(300);
    fail = true;
    await search('from:petrova');
    expect(root.querySelector('.center').textContent).toContain('Could not search this folder: offline');
    expect(root.querySelector('.list-meta').textContent).toBe('Search unavailable');
    fail = false;
    await search('from:petrova subject:Q3');
    expect(rows().map((row) => row.querySelector('.row-subject').textContent))
      .toEqual(['Q3 usage report attached']);
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 14 messages');
  });

  it('empties the field on Escape, whatever the browser would do', async () => {
    mount();
    await settle(200);
    const all = rows().length;
    await search('from:petrova');
    expect(rows()).toHaveLength(1);

    const input = root.querySelector('.search-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(200);

    expect(input.value).toBe('');
    expect(rows()).toHaveLength(all);
  });

  it('finds a message by sender across the whole folder', async () => {
    mount();
    await settle(200);
    await search('from:petrova');
    await settle(400);
    expect(rows().map((row) => row.querySelector('.row-subject').textContent))
      .toEqual(['Q3 usage report attached']);
  });

  it('waits for search completion before showing an empty result', async () => {
    // A small page, so the search lists more of the folder than the rows
    // have read; and reads that wait until they are let through, so the
    // moment between "nothing yet" and "nothing at all" can be looked at.
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let release = null;
    let gate = null;
    const slow = { ...fs, read: async (...args) => { if (gate) await gate; return fs.read(...args); } };
    renderApp(root, {
      fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 5,
    });
    await settle(400);
    gate = new Promise((resolve) => { release = resolve; });

    await search('zzzzqqq');
    const note = () => root.querySelector('.center-note')?.textContent ?? '';
    expect(root.querySelector('.list-meta').textContent).toMatch(/^0 results · searching \d+ of 14$/);
    expect(note()).toBe('');
    expect(root.querySelector('.loading-list')?.getAttribute('aria-label')).toBe('Searching your messages');
    expect(root.textContent).not.toContain('No messages match your search.');

    release();
    await settle(600);
    expect(root.querySelector('.list-meta').textContent).toBe('0 results in 14 messages');
    expect(root.querySelector('.loading-list')).toBeNull();
    // The result set did not change -- there is still nothing -- but what the
    // panel says about the reading has to.
    expect(note()).toBe('Search covers the sender, subject, and preview line of every message in this folder.');
  });

  it('leaves a draft row intact: there is no file to read behind one', async () => {
    mount();
    await settle(200);
    click('Drafts');
    await settle(100);

    const before = rows()[0];
    expect(before.querySelector('.row-sender').textContent).toBe('Ana Petrova');
    expect(before.querySelector('.row-snippet').textContent)
      .toBe('Numbers for the quarter close are in the sheet.');

    // A full-text query is the case that used to queue every draft for a
    // header read of a path that does not exist.
    await search('quarter');
    await settle(400);

    const row = rows()[0];
    expect(rows()).toHaveLength(1);
    expect(row.querySelector('.row-sender').textContent).toBe('Ana Petrova');
    expect(row.querySelector('.row-snippet').textContent)
      .toBe('Numbers for the quarter close are in the sheet.');
    // And the folder does not claim to still be reading something.
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 1 message');
  });
});
