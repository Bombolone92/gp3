/**
 * Twenty-seventh review pass, the shell and its dialogs, driven in node
 * through tests/helpers/dom.js (a small DOM: elements, selectors, bubbling
 * events, focus with the focus fixup rule; no CSS). Every test boots a
 * fresh DOM and a fresh module registry, with a small workspace open in the
 * store and Puter faked at `puter.workers.exec`, as tests/ui-conv-pass23.test.js
 * has it; the modal layer, the toasts and the router are the real ones.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.js';

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store: two channels the member is in and two teammates. */
async function boot({ width = 1280, role = 'member', ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  // The app's root, which every dialog makes inert while it stands (see openModal).
  document.body.append(document.createElement('div'));
  document.body.lastChild.id = 'app';
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  const { api } = await import('../src/lib/api.js');
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: role === 'owner' ? 'u-me' : 'u2',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 }, c2: { id: 'c2', name: 'random', count: 3 } },
    members: {
      'u-me': { role, name: 'Me', username: 'me', color: 1 },
      u2: { role: role === 'owner' ? 'member' : 'owner', name: 'Ana Rocha', username: 'ana', color: 2 },
      u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 },
    },
  };
  store.me = { role, channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
  return { store, api, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

/** The dialog on top, its form, and the first visible error under a field. */
const topDialog = () => [...document.querySelectorAll('.modal-root:not(.closing)')].pop() || null;
const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text) || null;
/** Wait for a condition a timer brings about (a dialog's 200 ms leave), bounded, rather than pausing a fixed time that a loaded machine may not honour in order. */
const until = async (fn, ms = 4000) => {
  const from = Date.now();
  while (!fn()) {
    if (Date.now() - from > ms) throw new Error('Waited too long');
    await dom.tick(10);
  }
};

describe('Enter in the Edit channel dialog’s topic while the save is out', () => {
  it('does not send the save a second time (the button is disabled, and a form submitted by name skips that check)', async () => {
    const { dom: d, api } = await boot();
    let settle = null;
    const update = vi.spyOn(api, 'updateChannel').mockImplementation(() => new Promise((r) => { settle = r; }));
    const { editChannelDialog } = await import('../src/ui/dialogs.js');
    editChannelDialog(store.ws.channels.c2);
    await d.tick(1);
    const form = topDialog().querySelector('form');
    const topic = form.querySelector('textarea');
    d.type(topic, 'What we ship this week');
    const first = d.key(topic, 'Enter');
    expect(first.defaultPrevented).toBe(true);
    await d.tick(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(form.querySelector('button[type="submit"]').disabled).toBe(true);
    // Enter again, before the worker has answered: the topic box takes no
    // line break for it, and the save is not sent again.
    const second = d.key(topic, 'Enter');
    expect(second.defaultPrevented).toBe(true);
    await d.tick(1);
    expect(update).toHaveBeenCalledTimes(1);
    settle({ channel: { ...store.ws.channels.c2, topic: 'What we ship this week' } });
    await d.tick(5);
    expect(topDialog()).toBeNull();
    expect(document.querySelectorAll('.toast').length).toBe(1);
  }, 15_000); // the file's first test pays the imports, seconds under a loaded machine
});

describe('a dialog opened from the answer to another’s form (Create a channel → Add people, New webhook → its token)', () => {
  /**
   * A browser will not focus a control inside an inert subtree (the app
   * behind a dialog, see openModal): the fake DOM has no inert, so the rule
   * is put on the one control the test hands focus back to.
   */
  const inertAware = (btn) => {
    const focus = btn.focus.bind(btn);
    btn.focus = (...a) => { if (!btn.closest('[inert]')) focus(...a); };
  };

  it('hands the keyboard back to where the first dialog was opened from when the last one closes, rather than to the page', async () => {
    const { dom: d, api } = await boot({ role: 'admin' });
    const app = document.getElementById('app');
    const opener = document.createElement('button');
    opener.textContent = 'Add channels';
    app.append(opener);
    inertAware(opener);
    opener.focus();
    let settle = null;
    vi.spyOn(api, 'createChannel').mockImplementation(() => new Promise((r) => { settle = r; }));
    const { createChannelDialog } = await import('../src/ui/dialogs.js');
    createChannelDialog();
    await d.tick(1);
    const form = topDialog().querySelector('form');
    d.type(form.querySelector('input.input'), 'design');
    const submit = form.querySelector('button[type="submit"]');
    submit.focus();
    submit.click();
    await d.tick(1);
    // The press disabled the button under the keyboard, which fell to the page (the focus fixup rule).
    expect(document.activeElement).toBe(document.body);
    store.ws.channels.c9 = { id: 'c9', name: 'design', count: 1, members: [] };
    settle({ channel: store.ws.channels.c9 });
    await d.tick(5);
    const second = topDialog();
    expect(second.querySelector('.modal-title').textContent).toBe('Add people to #design');
    // The first dialog's own restore fires meanwhile (its root leaves the
    // page with it); the app is inert under the second, so it lands nowhere.
    // Waited for rather than timed: under load a fixed pause raced the timer.
    await until(() => document.querySelectorAll('.modal-root').length === 1);
    expect(document.activeElement).not.toBe(opener);
    const skip = buttonNamed(second, 'Skip for now');
    skip.focus();
    skip.click();
    expect(topDialog()).toBeNull();
    await until(() => document.activeElement === opener);
    expect(document.querySelectorAll('.modal-root').length).toBe(0);
  }, 15_000);
});

describe('the colour picker of a new webhook or bot', () => {
  it('is named as the profile’s is ("Color", "Color 3"), one spelling for the same eight dots across the app', async () => {
    const { dom: d } = await boot({ role: 'admin' });
    const { integrationsDialog, settingsDialog } = await import('../src/ui/dialogs.js');
    integrationsDialog();
    await d.tick(2);
    buttonNamed(topDialog(), 'New webhook').click();
    await d.tick(1);
    const create = topDialog();
    expect(create.querySelector('.modal-title').textContent).toBe('New incoming webhook');
    const row = create.querySelector('.color-row');
    expect(row.getAttribute('aria-label')).toBe('Color');
    expect([...row.querySelectorAll('[role="radio"]')].map((b) => b.getAttribute('aria-label'))).toEqual(Array.from({ length: 8 }, (_, i) => `Color ${i + 1}`));
    expect([...create.querySelectorAll('.field-label')].map((n) => n.textContent)).toContain('Color');
    // The profile's own picker, whose spelling this follows.
    create.querySelector('.icon-btn').click();
    await d.tick(250);
    settingsDialog();
    await d.tick(1);
    expect(topDialog().querySelector('.color-row').getAttribute('aria-label')).toBe('Avatar color');
  });
});
describe('a name written right to left in the sidebar', () => {
  /** The sidebar drawn for the open workspace, with a Hebrew-named teammate and a direct message with them. */
  async function sidebar() {
    const { dom: d } = await boot();
    store.ws.members.u4 = { role: 'member', name: 'אביגיל כהן-לוינשטיין', username: 'avigail', color: 4 };
    store.me.dms = { dm_a: { members: ['u-me', 'u4'], createdAt: 3 } };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const host = document.createElement('nav');
    document.body.append(host);
    renderSidebar(host);
    await d.tick(1);
    return { d, host };
  }

  it('is laid out in its own direction, so a long one is cut at its end, not at its start (the section titles’ rule)', async () => {
    const { d, host } = await sidebar();
    // The conversations' rows (in the full list, wrapped for their menu; bare in the filtered list): the view rows' fixed words need no direction.
    const labels = () => [...host.querySelectorAll('.side-row .side-item .side-label, .side-results .side-item .side-label')];
    expect(labels().length).toBeGreaterThan(2);
    // Every row's label, not the Hebrew one alone: which way a name runs is the browser's to read from the name.
    expect(labels().every((n) => n.getAttribute('dir') === 'auto')).toBe(true);
    expect(labels().find((n) => n.textContent === 'אביגיל כהן-לוינשטיין')).toBeTruthy();
    // The filtered list's rows, and a person without a conversation yet, the same.
    const box = host.querySelector('.side-filter-input');
    d.type(box, 'a');
    await d.tick(1);
    const filtered = labels();
    expect(filtered.length).toBeGreaterThan(1);
    expect(filtered.every((n) => n.getAttribute('dir') === 'auto')).toBe(true);
  });

  it('still starts beside the row’s icon: the row aligns its text to the left, which the label inherits whatever its direction', () => {
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    const row = /\.side-item \{([^}]*)\}/.exec(css);
    expect(row).toBeTruthy();
    expect(row[1]).toMatch(/text-align:\s*left/);
    const label = /\.side-item \.side-label \{([^}]*)\}/.exec(css);
    expect(label[1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(label[1]).not.toMatch(/text-align/);
  });
});
describe('the Shared channels dialog with none yet', () => {
  it('says what to do next in plain words (not "add one another workspace shared with you")', async () => {
    const { dom: d } = await boot({ role: 'admin' });
    const { sharedChannelsDialog } = await import('../src/ui/dialogs.js');
    sharedChannelsDialog();
    await d.tick(1);
    const empty = topDialog().querySelector('.empty');
    expect(empty.querySelector('h3').textContent).toBe('No shared channels yet');
    const next = empty.querySelector('p').textContent;
    expect(next).not.toMatch(/one another/);
    expect(next).toBe('Share one of your channels from its details, or add a channel another workspace shared with you.');
  });
});

describe('a right-to-left name everywhere else it is cut short or stands beside a chip', () => {
  const HEB = 'אביגיל כהן-לוינשטיין';
  /** A Hebrew-named teammate with a status, and a direct message with them. */
  async function withAvigail(opts) {
    const ctx = await boot(opts);
    store.ws.members.u4 = { role: 'member', name: HEB, username: 'avigail', color: 4, status: { emoji: '🎯', text: 'Focusing' } };
    store.me.dms = { dm_a: { members: ['u-me', 'u4'], createdAt: 3 } };
    return ctx;
  }
  /** The one name span of a label that also holds chips: its own direction, the chips after it untouched. */
  const nameOf = (line) => {
    expect(line.classList.contains('name-line')).toBe(true);
    // The name is the line's own first child (the fake DOM has no :scope).
    const name = [...line.children].find((n) => n.classList.contains('name-text'));
    expect(name).toBe(line.firstElementChild);
    expect(name.getAttribute('dir')).toBe('auto');
    return name;
  };

  it('the DMs pane row: the name in its own span before the status chip', async () => {
    const { dom: d } = await withAvigail();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(1);
    const strong = pane.el.querySelector('.pane-row-head strong');
    expect(nameOf(strong).textContent).toBe(HEB);
    expect(strong.querySelector('.status-chip')).toBeTruthy();
    expect([...strong.children].map((n) => n.className.split(' ')[0])).toEqual(['name-text', 'status-chip']);
    pane.destroy();
  });

  it('the sidebar footer (your own name beside the Guest pill) and the workspace name', async () => {
    const { dom: d } = await withAvigail({ role: 'guest' });
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const host = document.createElement('nav');
    document.body.append(host);
    renderSidebar(host);
    await d.tick(1);
    const me = host.querySelector('.side-me strong');
    expect(nameOf(me).textContent).toBe('Me');
    expect(me.querySelector('.pill-guest')).toBeTruthy();
    expect(host.querySelector('.ws-name').getAttribute('dir')).toBe('auto');
  });

  it('the Members dialog rows and a new message’s people picker', async () => {
    const { dom: d } = await withAvigail();
    const { membersDialog, newDmDialog } = await import('../src/ui/dialogs.js');
    membersDialog();
    await d.tick(1);
    const rows = [...topDialog().querySelectorAll('.pick-item strong')];
    expect(rows.length).toBe(4);
    for (const r of rows) nameOf(r);
    expect(rows.map((r) => r.querySelector('.name-text').textContent)).toContain('Me (you)');
    expect(rows.map((r) => r.querySelector('.name-text').textContent)).toContain(HEB);
    topDialog().querySelector('.icon-btn').click();
    await d.tick(250);
    newDmDialog();
    await d.tick(1);
    const picks = [...topDialog().querySelectorAll('.pick-item strong')];
    expect(picks.length).toBe(3);
    for (const r of picks) nameOf(r);
    expect(picks.find((r) => r.querySelector('.name-text').textContent === HEB).querySelector('.status-chip')).toBeTruthy();
  });

  it('the details dialog of a direct message: its title and the People tab’s rows', async () => {
    const { dom: d } = await withAvigail();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const details = openDetailsDialog('dm_a');
    await d.tick(1);
    const dialog = topDialog();
    expect(dialog.querySelector('.details-name h3').getAttribute('dir')).toBe('auto');
    [...dialog.querySelectorAll('.details-tab')].find((t) => t.textContent.startsWith('People')).click();
    await d.tick(2);
    const rows = [...dialog.querySelectorAll('.member-row strong')];
    expect(rows.length).toBe(2);
    for (const r of rows) nameOf(r);
    details.close();
  });

  it('the Later view: where a saved message is (a person’s name for a direct message) and who wrote it', async () => {
    const { dom: d } = await withAvigail();
    vi.spyOn(store, 'loadSaved').mockResolvedValue([{ c: 'dm_a', s: 1, ts: 1000, done: false, message: { seq: 1, user: 'u4', text: 'שלום', ts: 900, kind: 'msg' } }]);
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await d.tick(5);
    const row = view.el.querySelector('.later-row');
    expect(row).toBeTruthy();
    expect(row.querySelector('.later-where').getAttribute('dir')).toBe('auto');
    expect(row.querySelector('.later-where').textContent).toBe(HEB);
    expect(row.querySelector('.view-row-head strong').getAttribute('dir')).toBe('auto');
    view.destroy();
  });

  it('the Directory’s cards: the name (and "(you)") in its own span before the status chip', async () => {
    const { dom: d } = await withAvigail();
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const dir = createDirectoryView();
    document.body.append(dir.el);
    await d.tick(1);
    const names = [...dir.el.querySelectorAll('.dir-card-name')];
    expect(names.length).toBe(4);
    for (const n of names) expect(n.firstElementChild.getAttribute('dir')).toBe('auto');
    const her = names.find((n) => n.firstElementChild.textContent === HEB);
    expect(her.querySelector('.status-chip')).toBeTruthy();
    dir.destroy();
  });

  it('the stylesheet: the name of such a line is the part cut short, its chips keep their room; the free-standing places stay left', () => {
    const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    expect(components).toMatch(/\.name-line \{[^}]*display: flex/);
    expect(components).toMatch(/\.name-line > \.name-text \{[^}]*text-overflow: ellipsis/);
    expect(components).toMatch(/\.name-line > :not\(\.name-text\) \{[^}]*flex: none/);
    const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(/\.thread-card-who \{([^}]*)\}/.exec(app)[1]).toMatch(/text-align: left/);
    expect(/\.later-where \{([^}]*)\}/.exec(app)[1]).toMatch(/text-align: left/);
    // The small grey second line of these rows is styled as the text's own
    // child, not as any span below it: as a descendant rule it reached the
    // name span inside the strong (12px, grey) and the pills beside it.
    expect(components).toMatch(/\.pick-item \.pick-text > span \{/);
    expect(components).not.toMatch(/\.pick-item \.pick-text span \{/);
    expect(app).toMatch(/\.member-row \.pick-text > span \{/);
    expect(app).not.toMatch(/\.member-row \.pick-text span \{/);
    expect(app).toMatch(/\.side-me \.me-text > span \{/);
    expect(app).not.toMatch(/\.side-me \.me-text span \{/);
  });
});

describe('Join a workspace with a code for a workspace that has moved', () => {
  it('opens the workspace at its new address and says so, as a followed link does (not "Joined" onto the read-only copy)', async () => {
    const { dom: d } = await boot();
    vi.spyOn(store, 'join').mockResolvedValue({ movedTo: 'ffeeddcc00@other-server', workspace: { id: 'abc123def0@teamchat-test', name: 'Globex' } });
    const { joinWorkspaceDialog } = await import('../src/ui/dialogs.js');
    joinWorkspaceDialog({ code: 'ABCD-EFGH-IJKL@teamchat-test' });
    await d.tick(1);
    const form = topDialog().querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(topDialog()).toBeNull();
    expect(location.hash).toBe(`#/ws/${encodeURIComponent('ffeeddcc00@other-server')}`);
    const words = [...document.querySelectorAll('.toast')].map((t) => t.textContent);
    expect(words).toEqual(['Globex moved to another server; opening it there']);
  });

  it('shows a refused code’s words under the field, as before', async () => {
    const { dom: d } = await boot();
    const { ApiError } = await import('../src/lib/api.js');
    vi.spyOn(store, 'join').mockRejectedValue(new ApiError(404, 'invite_not_found', 'Invite not found'));
    const { joinWorkspaceDialog } = await import('../src/ui/dialogs.js');
    joinWorkspaceDialog({ code: 'ABCD-EFGH-IJKL@teamchat-test' });
    await d.tick(1);
    const form = topDialog().querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(topDialog()).not.toBeNull();
    expect([...form.querySelectorAll('.field-error')].find((n) => !n.hidden).textContent).toBe('That invite is not valid or has expired. Ask for a new link.');
    expect(form.querySelector('button[type="submit"]').disabled).toBe(false);
  });
});

describe('Edit channel opened by a member on the default channel', () => {
  it('says why the name box is off, under it, rather than a disabled box with the naming rule for a hint', async () => {
    const { dom: d } = await boot();
    const { editChannelDialog } = await import('../src/ui/dialogs.js');
    editChannelDialog(store.ws.channels.c1);
    await d.tick(1);
    const form = topDialog().querySelector('form');
    const name = form.querySelector('input.input');
    expect(name.disabled).toBe(true);
    const hint = form.querySelector(`#${name.id}-hint`);
    expect(hint.textContent).toBe('Only an admin can rename the default channel.');
    expect(name.getAttribute('aria-describedby')).toContain(hint.id);
    // The topic is theirs to edit, and the hint stands whatever is typed elsewhere.
    d.type(form.querySelector('textarea'), 'Plans');
    expect(hint.textContent).toBe('Only an admin can rename the default channel.');
  });

  it('an admin keeps the naming rule and the live preview of the saved name', async () => {
    const { dom: d } = await boot({ role: 'admin' });
    const { editChannelDialog } = await import('../src/ui/dialogs.js');
    editChannelDialog(store.ws.channels.c1);
    await d.tick(1);
    const form = topDialog().querySelector('form');
    const name = form.querySelector('input.input');
    expect(name.disabled).toBe(false);
    const hint = form.querySelector(`#${name.id}-hint`);
    expect(hint.textContent).toBe('Lowercase letters, numbers, hyphens, and underscores.');
    d.type(name, 'General Chat');
    expect(hint.textContent).toBe('Will be saved as #general-chat');
  });
});

describe('the Later view, a saved row removed from the keyboard', () => {
  it('hands the keyboard to the row that took its place, not to the page', async () => {
    const { dom: d } = await boot();
    const saved = (s) => ({ c: 'c1', s, ts: 1000 + s, done: false, message: { seq: s, user: 'u2', text: `m${s}`, ts: 900 + s, kind: 'msg' } });
    vi.spyOn(store, 'loadSaved').mockResolvedValue([saved(3), saved(2), saved(1)]);
    vi.spyOn(store, 'unsave').mockResolvedValue();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await d.tick(5);
    const rows = () => [...view.el.querySelectorAll('.later-row')];
    expect(rows().length).toBe(3);
    const remove = rows()[1].querySelector('button[aria-label="Remove from Later"]');
    remove.focus();
    remove.click();
    await until(() => rows().length === 2);
    expect(document.activeElement).not.toBe(document.body);
    expect(rows()[1].contains(document.activeElement)).toBe(true);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Remove from Later');
    view.destroy();
  });
});

describe('the Invite people dialog’s Email tab', () => {
  /** The dialog on its Email tab, with a live invite link, and the email worker answered by `answer`. */
  async function emailTab(answer) {
    const ctx = await boot({ role: 'admin' });
    store.ws.invite = 'ABCD-EFGH-IJKL';
    store.ws.inviteExp = Date.now() + 3 * 3600_000;
    const sends = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (String(url).endsWith('/invites')) {
        sends.push(JSON.parse(init.body));
        return answer(sends.length);
      }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const { inviteDialog } = await import('../src/ui/dialogs.js');
    inviteDialog();
    await ctx.dom.tick(1);
    const dialog = topDialog();
    [...dialog.querySelectorAll('.seg [role="radio"]')].find((b) => b.textContent.trim() === 'Email').click();
    await ctx.dom.tick(1);
    const form = dialog.querySelector('form');
    return { ...ctx, dialog, form, box: form.querySelector('textarea'), send: form.querySelector('button[type="submit"]'), sends };
  }
  const shownError = (form) => [...form.querySelectorAll('.field-error')].find((n) => !n.hidden)?.textContent;
  const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  it('refuses a paste of more than ten addresses under the field, sends nothing, and reads duplicates, display names and stray commas as the addresses they are', async () => {
    const { dom: d, form, box, sends } = await emailTab(() => json({ ok: true, sent: 0, results: [] }));
    const many = Array.from({ length: 60 }, (_, i) => `p${i}@x.io`).join(', ');
    d.type(box, many);
    submit(form);
    await d.tick(2);
    expect(shownError(form)).toBe('Send to 10 people at a time');
    expect(sends.length).toBe(0);
    // Enter in the box is a line break, not a send (addresses go one per line too).
    const enter = d.key(box, 'Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(sends.length).toBe(0);
    d.type(box, 'a@x.io, Ann Lee <ann@x.io>,\n A@X.IO ,\n\n');
    submit(form);
    await d.tick(2);
    expect(sends.length).toBe(1);
    // The two addresses, once each (the bracketed one is read out first).
    expect([...sends[0].emails].sort()).toEqual(['a@x.io', 'ann@x.io']);
  });

  it('keeps Send disabled while the request is out, and after a partial send leaves only the addresses that did not go, with why', async () => {
    let settle = null;
    const { dom: d, dialog, form, box, send, sends } = await emailTab(() => new Promise((r) => { settle = r; }));
    d.type(box, 'a@x.io, ann@x.io');
    submit(form);
    await d.tick(1);
    expect(sends.length).toBe(1);
    // Disabled, which is what keeps Enter in the note box from sending the
    // form again (a form is not submitted implicitly through a disabled button).
    expect(send.disabled).toBe(true);
    settle(json({ ok: true, sent: 1, results: [{ email: 'a@x.io', status: 'sent' }, { email: 'ann@x.io', status: 'failed' }] }));
    await d.tick(5);
    expect(topDialog()).toBe(dialog);
    expect(send.disabled).toBe(false);
    expect(box.value).toBe('ann@x.io');
    expect(shownError(form)).toBe('Could not send to ann@x.io — still here to try again.');
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toContain('Sent 1 of 2');
  });
});

describe('the page shown when the Puter script did not load', () => {
  it('says what failed and what to try (a content blocker as well as the connection), and keeps Try again', () => {
    // main.js starts the app as it loads, so its words are read from the file.
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    expect(main).toContain("showError('Could not reach Puter', 'The Puter script (js.puter.com) did not load. Check your connection or a content blocker, then try again.', () => location.reload())");
    expect(main).not.toContain('The Puter SDK failed to load');
  });
});

describe('Save with nothing changed', () => {
  it('in Edit channel closes the dialog without a request or a "Channel updated"', async () => {
    const { dom: d, api } = await boot({ role: 'admin' });
    const update = vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: store.ws.channels.c2 });
    const { editChannelDialog } = await import('../src/ui/dialogs.js');
    editChannelDialog({ ...store.ws.channels.c2, topic: 'Plans', description: 'What we build' });
    await d.tick(1);
    const form = topDialog().querySelector('form');
    // Retyped as it was (a space at either end is trimmed off, as a save would).
    d.type(form.querySelector('input.input'), ' random ');
    d.type(form.querySelector('textarea'), 'Plans ');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(update).not.toHaveBeenCalled();
    expect(store.refreshAfterChange).not.toHaveBeenCalled();
    expect(topDialog()).toBeNull();
    expect(document.querySelectorAll('.toast').length).toBe(0);
    // A real change still saves and says so.
    editChannelDialog({ ...store.ws.channels.c2, topic: 'Plans' });
    await d.tick(1);
    const again = topDialog().querySelector('form');
    d.type(again.querySelector('textarea'), 'Plans for May');
    again.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(update).toHaveBeenCalledWith(REF, 'c2', { topic: 'Plans for May' });
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toEqual(['Channel updated']);
  });

  it('in the profile settings sends nothing and says there was nothing to save, rather than "Profile saved"', async () => {
    const { dom: d } = await boot();
    store.profile = { ...store.profile, title: 'Designer', color: 3 };
    const update = vi.spyOn(store, 'updateProfile').mockResolvedValue();
    const { settingsDialog } = await import('../src/ui/dialogs.js');
    settingsDialog();
    await d.tick(1);
    const form = topDialog().querySelector('form');
    const [name, title] = form.querySelectorAll('input.input');
    expect([name.value, title.value]).toEqual(['Me', 'Designer']);
    d.type(title, ' Designer ');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(update).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toEqual(['No changes to save']);
    expect(topDialog()).not.toBeNull();
    d.type(title, 'Product designer');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(5);
    expect(update).toHaveBeenCalledWith({ name: 'Me', title: 'Product designer', color: 3 });
  });
});

describe('the rail’s workspace menu', () => {
  it('lists the workspaces as checked choices, an unreachable one with its word and still openable, and Escape hands the keyboard back to the mark', async () => {
    const { dom: d } = await boot();
    store.workspaces = [{ id: REF, name: 'Globex' }, { id: 'ffeeddcc00@far-server', name: 'Initech', unreachable: true }];
    const { renderRail } = await import('../src/ui/rail.js');
    const rail = document.createElement('nav');
    document.body.append(rail);
    renderRail(rail);
    await d.tick(1);
    const mark = rail.querySelector('.rail-mark');
    expect(mark.getAttribute('aria-haspopup')).toBe('menu');
    mark.focus();
    mark.click();
    await d.tick(1);
    const menu = document.querySelector('.menu[role="menu"]');
    expect(menu).toBeTruthy();
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    const items = [...menu.querySelectorAll('.menu-item')];
    // Each workspace's item leads with its mark (the name's first letter), then the name.
    const globex = items.find((b) => b.getAttribute('role') === 'menuitemradio' && b.textContent.includes('Globex'));
    const initech = items.find((b) => b.getAttribute('role') === 'menuitemradio' && b.textContent.includes('Initech'));
    expect(globex.getAttribute('aria-checked')).toBe('true');
    expect(initech.getAttribute('aria-checked')).toBe('false');
    expect(initech.querySelector('.menu-sub').textContent).toBe('Server not reachable');
    expect(initech.getAttribute('aria-disabled')).toBeNull();
    // The arrows walk the items, Home and End go to the ends.
    items[0].focus();
    d.key(items[0], 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    d.key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    d.key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    expect(document.querySelector('.menu')).toBeNull();
    expect(document.activeElement).toBe(mark);
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    // Picked, the unreachable workspace opens (onto its failure page), it is not refused here.
    mark.click();
    await d.tick(1);
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Initech')).click();
    await d.tick(1);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent('ffeeddcc00@far-server')}`);
  });
});

describe('the Directory’s Channels tab', () => {
  async function channelsTab() {
    const ctx = await boot();
    store.ws.channels.c4 = { id: 'c4', name: 'old-plans', archived: true, count: 2 };
    store.ws.channels.c5 = { id: 'c5', name: 'announce', postPolicy: 'admins', count: 3 };
    store.me.channels.push('c4');
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const dir = createDirectoryView();
    document.body.append(dir.el);
    await ctx.dom.tick(1);
    [...dir.el.querySelectorAll('.conv-tab')].find((t) => t.textContent.startsWith('Channels')).click();
    await ctx.dom.tick(1);
    return { ...ctx, dir };
  }
  const rowOf = (dir, name) => [...dir.el.querySelectorAll('.dir-row')].find((r) => r.querySelector('strong').textContent.startsWith(name));

  it('names the channel in every Join and Open, and says archived and admins-only in the row’s own name, as the sidebar’s rows do', async () => {
    const { dir } = await channelsTab();
    expect(rowOf(dir, 'general').querySelector('.btn').getAttribute('aria-label')).toBe('Open #general');
    expect(rowOf(dir, 'announce').querySelector('.btn').getAttribute('aria-label')).toBe('Join #announce');
    expect(rowOf(dir, 'old-plans').querySelector('.btn').getAttribute('aria-label')).toBe('Open #old-plans');
    expect(rowOf(dir, 'old-plans').querySelector('.pill').textContent).toBe('Archived');
    expect(rowOf(dir, 'old-plans').querySelector('.dir-row-main').getAttribute('aria-label')).toBe('#old-plans, archived, details');
    expect(rowOf(dir, 'announce').querySelector('.dir-row-main').getAttribute('aria-label')).toBe('#announce, admins post, details');
    expect(rowOf(dir, 'general').querySelector('.dir-row-main').getAttribute('aria-label')).toBe('#general, details');
    dir.destroy();
  });

  it('keeps the count on the tab in step with the workspace', async () => {
    const { dom: d, dir } = await channelsTab();
    const count = () => [...dir.el.querySelectorAll('.conv-tab')].find((t) => t.textContent.startsWith('Channels')).querySelector('.dir-tab-n').textContent;
    expect(count()).toBe('4');
    store.ws.channels.c6 = { id: 'c6', name: 'zeta', count: 1 };
    store.emit('workspace');
    await d.tick(1);
    expect(count()).toBe('5');
    expect(rowOf(dir, 'zeta')).toBeTruthy();
    dir.destroy();
  });
});

describe('Workspace settings, Save with the name as it is', () => {
  it('sends nothing and says there was nothing to save, as the profile’s Save does', async () => {
    const { dom: d, api } = await boot({ role: 'admin' });
    const update = vi.spyOn(api, 'updateWorkspace').mockResolvedValue({ workspace: store.ws });
    const { workspaceSettingsDialog } = await import('../src/ui/dialogs.js');
    workspaceSettingsDialog();
    await d.tick(1);
    const form = topDialog().querySelector('form');
    const name = form.querySelector('input.input');
    expect(name.value).toBe('Globex');
    d.type(name, ' Globex ');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(3);
    expect(update).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toEqual(['No changes to save']);
    expect(topDialog()).not.toBeNull();
    d.type(name, 'Globex Labs');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(3);
    expect(update).toHaveBeenCalledWith(REF, { name: 'Globex Labs' });
  });
});
