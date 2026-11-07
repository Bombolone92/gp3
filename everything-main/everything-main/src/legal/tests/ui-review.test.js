// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (target, k, opts = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

beforeAll(() => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  Element.prototype.scrollIntoView ??= function () {};
});

beforeEach(async () => {
  document.body.replaceChildren();
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

describe('router', () => {
  it('treats a malformed percent-encoded parameter as an unknown page instead of throwing', async () => {
    const { route, parse } = await import('../src/ui/router.js');
    route('/review-things/:id', 'review-thing');
    expect(parse('#/review-things/a%20b').params.id).toBe('a b');
    expect(() => parse('#/review-things/%E0%A4%A')).not.toThrow();
    expect(parse('#/review-things/%E0%A4%A').name).toBe('not-found');
  });
});

describe('view host', () => {
  const state = { dirty: false, calls: 0 };
  let hostStore;
  let main;
  let navigate;
  const until = async (fn, n = 50) => {
    for (let i = 0; i < n && !fn(); i++) await tick(5);
    return fn();
  };

  beforeAll(async () => {
    const view = (title, extra = {}) => ({
      render: () => {
        const node = document.createElement('div');
        node.innerHTML = `<h1>${title}</h1>`;
        return { node, ...extra };
      },
    });
    vi.doMock('../src/views/settings.js', () => view('Mock settings', { dirty: () => state.dirty }));
    vi.doMock('../src/views/reports.js', () => view('Mock reports'));
    vi.doMock('../src/views/contacts.js', () => ({
      render: (ctx) => {
        // A card of task buttons that redraws when tasks change, like the dashboard's agenda.
        const node = ctx.live(() => {
          const ul = document.createElement('ul');
          for (const t of app.store.all('tasks').filter((x) => !x.done).slice(0, 4)) {
            const b = document.createElement('button');
            b.textContent = `Complete ${t.name}`;
            b.onclick = () => app.store.patch('tasks', t.id, { done: true });
            ul.append(b);
          }
          return ul;
        }, ['tasks']);
        return { node, title: 'Mock agenda' };
      },
    }));
    vi.doMock('../src/views/tasks.js', () => ({
      render: (ctx) => {
        // A region that subscribes while it draws, as the matter page's tabs do.
        const node = ctx.live((c) => {
          c.watch(['tasks'], () => state.calls++);
          return document.createElement('p');
        }, 'all');
        return { node, title: 'Mock tasks' };
      },
    }));
    vi.doMock('../src/views/communications.js', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
    await app.store.init();
    location.hash = '#/settings';
    await tick(5);
    ({ navigate } = await import('../src/ui/router.js'));
    const { startViews } = await import('../src/ui/viewhost.js');
    main = document.createElement('main');
    hostStore = app.store;
    startViews(main);
    await until(() => main.textContent.includes('Mock settings'));
  });

  beforeEach(() => document.body.append(main));

  it('keeps following links after "Keep editing" on a link to the same page', async () => {
    state.dirty = true;
    navigate('/settings');
    await until(() => document.querySelector('dialog[open]'));
    const keep = [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((b) => b.textContent === 'Keep editing');
    keep.click();
    await tick(10);
    state.dirty = false;
    location.hash = '#/reports';
    expect(await until(() => main.textContent.includes('Mock reports'))).toBe(true);
  });

  it('offers a reload, not "Page not found", when a screen fails to download', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    location.hash = '#/communications';
    await until(() => !main.textContent.includes('Mock reports'));
    err.mockRestore();
    expect(main.textContent).not.toContain('Page not found');
    expect([...main.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);
  });

  it('drops a live region\'s subscriptions when it redraws, instead of piling them up', async () => {
    app.store = hostStore;
    location.hash = '#/tasks';
    await until(() => document.title.startsWith('Mock tasks'));
    for (let i = 0; i < 3; i++) {
      app.store.put('notes', { subject: `n${i}` });
      await tick(20);
    }
    state.calls = 0;
    app.store.put('tasks', { name: 'Check' });
    await tick(20);
    expect(state.calls).toBe(1);
  });

  it('keeps keyboard focus in a live region when it redraws', async () => {
    app.store = hostStore;
    location.hash = '#/contacts';
    await until(() => document.title.startsWith('Mock agenda'));
    const buttons = () => [...main.querySelectorAll('ul button')];
    const second = buttons()[1];
    const third = buttons()[2].textContent;
    second.focus();
    second.click(); // completes it; the card redraws without it
    await tick(20);
    expect(document.activeElement.isConnected).toBe(true);
    expect(main.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.textContent).toBe(third);
  });

  it('asks before signing out over a form with unsaved edits', async () => {
    app.store = hostStore;
    location.hash = '#/settings';
    await until(() => main.textContent.includes('Mock settings'));
    globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
    const { buildShell } = await import('../src/ui/shell.js');
    try {
      app.demo = false;
      state.dirty = true;
      const shell = buildShell();
      document.body.append(shell.root);
      shell.root.querySelector('.account-btn').click();
      await tick(5);
      [...document.querySelectorAll('.account-pop button')].find((b) => b.textContent === 'Sign out').click();
      expect(await until(() => document.querySelector('dialog[open]'))).toBeTruthy();
      expect(document.querySelector('dialog[open]').textContent).toContain('This page has changes you have not saved');
      [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((b) => b.textContent === 'Cancel').click();
      await tick(5);
    } finally {
      state.dirty = false;
      app.demo = true;
    }
  });

  it('asks once, not again on reload, when signing out with unsent changes', async () => {
    app.store = hostStore;
    globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
    const pending = vi.spyOn(hostStore, 'pendingCount').mockReturnValue(2);
    const asked = [];
    const onUnload = (e) => asked.push(e.defaultPrevented);
    window.addEventListener('beforeunload', onUnload);
    const reload = vi.fn(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      asked.push(e.defaultPrevented);
    });
    const realLocation = window.location;
    const { buildShell } = await import('../src/ui/shell.js');
    try {
      app.demo = false;
      const shell = buildShell();
      document.body.append(shell.root);
      vi.stubGlobal('location', { reload, hash: realLocation.hash, href: realLocation.href });
      shell.root.querySelector('.account-btn').click();
      await tick(5);
      [...document.querySelectorAll('.account-pop button')].find((b) => b.textContent === 'Sign out').click();
      await until(() => document.querySelector('dialog[open]'));
      [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((b) => b.textContent === 'Sign out anyway').click();
      await until(() => reload.mock.calls.length);
      expect(reload).toHaveBeenCalled();
      expect(asked.at(-1)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      pending.mockRestore();
      window.removeEventListener('beforeunload', onUnload);
      app.demo = true;
    }
  });

  it('asks once when the address changes again while asking about unsaved changes, then opens the latest page', async () => {
    app.store = hostStore;
    location.hash = '#/settings';
    await until(() => main.textContent.includes('Mock settings'));
    state.dirty = true;
    location.hash = '#/reports';
    await until(() => document.querySelector('dialog[open]'));
    location.hash = '#/tasks'; // e.g. Back pressed twice
    await tick(20);
    expect(document.querySelectorAll('dialog[open]').length).toBe(1);
    state.dirty = false;
    [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((b) => b.textContent === 'Discard changes').click();
    expect(await until(() => document.title.startsWith('Mock tasks'))).toBe(true);
    await tick(20);
    expect(document.title.startsWith('Mock tasks')).toBe(true);
  });
});

describe('dialogs', () => {
  it('runs a form dialog\'s save once when Save is pressed twice while saving', async () => {
    const { formDialog } = await import('../src/ui/dialog.js');
    let release;
    const onSubmit = vi.fn(() => new Promise((r) => (release = r)));
    const done = formDialog({ title: 'Thing', body: () => document.createElement('input'), onSubmit });
    const form = document.querySelector('dialog form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
    expect(await done).toBe(true);
  });

  it('lets a form be submitted again after its save returns false', async () => {
    const { formDialog } = await import('../src/ui/dialog.js');
    let n = 0;
    const done = formDialog({ title: 'Thing', body: () => document.createElement('input'), onSubmit: async () => (++n === 1 ? false : 'ok') });
    const form = document.querySelector('dialog form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await done).toBe('ok');
  });

  it('starts a destructive confirmation on Cancel, so a stray Enter does not delete', async () => {
    const { confirmDialog } = await import('../src/ui/dialog.js');
    const done = confirmDialog({ title: 'Delete this task?', message: 'It cannot be recovered.', confirmLabel: 'Delete', danger: true });
    expect(document.activeElement.textContent).toBe('Cancel');
    document.activeElement.click();
    expect(await done).toBe(false);
    const ok = confirmDialog({ title: 'Join a firm?', message: 'x', confirmLabel: 'Join firm' });
    expect(document.activeElement.textContent).toBe('Join firm');
    document.activeElement.click();
    expect(await ok).toBe(true);
  });

  it('puts focus back on the page when the button that opened a dialog was redrawn while saving', async () => {
    const { formDialog } = await import('../src/ui/dialog.js');
    const page = document.createElement('main');
    page.id = 'main';
    page.tabIndex = -1;
    const card = document.createElement('div');
    const makeBtn = (text) => Object.assign(document.createElement('button'), { textContent: text, className: 'btn' });
    card.append(makeBtn('Add task'), makeBtn('Show all'));
    page.append(card);
    document.body.append(page);
    try {
      card.firstChild.focus();
      // The save changes data, so the card is drawn again before the dialog closes.
      const redraw = async () => {
        card.replaceChildren(makeBtn('Add task'), makeBtn('Show all'));
        await tick();
      };
      let done = formDialog({ title: 'Task', body: () => document.createElement('input'), onSubmit: redraw });
      document.querySelector('dialog form').dispatchEvent(new Event('submit', { cancelable: true }));
      await done;
      expect(document.activeElement).toBe(card.firstChild);
      // Nothing like it left: the page itself, not the document body.
      done = formDialog({ title: 'Task', body: () => document.createElement('input'), onSubmit: async () => (card.replaceChildren(), await tick()) });
      document.querySelector('dialog form').dispatchEvent(new Event('submit', { cancelable: true }));
      await done;
      expect(document.activeElement).toBe(page);
    } finally {
      page.remove();
    }
  });

  it('reads a confirmation\'s message to screen readers along with its title', async () => {
    const { confirmDialog } = await import('../src/ui/dialog.js');
    confirmDialog({ title: 'Void bill #12?', message: 'Its time entries return to unbilled.', confirmLabel: 'Void', danger: true });
    const dlg = document.querySelector('dialog[open]');
    const desc = document.getElementById(dlg.getAttribute('aria-describedby'));
    expect(desc?.textContent).toBe('Its time entries return to unbilled.');
    document.activeElement.click();
  });
});

describe('menus', () => {
  const anchorBtn = () => {
    const b = document.createElement('button');
    b.textContent = 'Open';
    document.body.append(b);
    b.focus();
    return b;
  };

  it('puts focus back on the menu button when an item is chosen, so a dialog it opens can return focus there', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const anchor = anchorBtn();
    let focusedDuringRun = null;
    openMenu(anchor, [{ label: 'Edit', run: () => (focusedDuringRun = document.activeElement) }]);
    const item = document.querySelector('[role=menuitem]');
    expect(document.activeElement).toBe(item);
    item.click();
    expect(focusedDuringRun).toBe(anchor);
  });

  it('puts focus back on the button when a popover closes from inside', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = anchorBtn();
    const pop = openPopover(anchor, () => {
      const a = document.createElement('a');
      a.href = '#/x';
      a.textContent = 'Go';
      return a;
    });
    pop.el.querySelector('a').focus();
    pop.close();
    expect(document.activeElement).toBe(anchor);
  });

  it('moves Tab on from the menu button rather than from the end of the page', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const anchor = anchorBtn();
    openMenu(anchor, [{ label: 'Edit', run() {} }, { label: 'Delete', run() {} }]);
    const tabbed = key(document.activeElement, 'Tab');
    expect(document.querySelector('[role=menu]')).toBe(null);
    expect(tabbed).toBe(true); // the browser still moves focus
    expect(document.activeElement).toBe(anchor);
  });

  it('closes only the suggestions, not the whole popover, on Escape in a combobox', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const { combobox } = await import('../src/ui/components.js');
    const anchor = anchorBtn();
    let cb;
    const pop = openPopover(anchor, () => (cb = combobox({ label: 'Pick', items: () => [{ id: 1, name: 'One' }], itemLabel: (r) => r.name, onSelect() {} })));
    cb.input.focus();
    cb.input.dispatchEvent(new Event('input'));
    expect(cb.input.getAttribute('aria-expanded')).toBe('true');
    key(cb.input, 'Escape');
    expect(cb.input.getAttribute('aria-expanded')).toBe('false');
    expect(pop.el.isConnected).toBe(true);
    key(cb.input, 'Escape');
    expect(pop.el.isConnected).toBe(false);
  });

  it('moves keyboard focus into a popover so its contents can be reached with Tab', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = anchorBtn();
    const pop = openPopover(anchor, () => {
      const b = document.createElement('button');
      b.textContent = 'Mark all read';
      return b;
    }, { label: 'Alerts' });
    expect(pop.el.contains(document.activeElement)).toBe(true);
    key(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(anchor);
  });

  it('does not leave a document listener behind when a popover closes right after opening', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const pop = openPopover(anchorBtn(), () => document.createElement('div'));
    pop.close(); // e.g. N pressed twice quickly: the next menu closes this one at once
    await tick(5);
    const added = add.mock.calls.filter(([type]) => type === 'pointerdown').map((c) => c[1]);
    const removed = remove.mock.calls.filter(([type]) => type === 'pointerdown').map((c) => c[1]);
    add.mockRestore();
    remove.mockRestore();
    expect(added.filter((fn) => !removed.includes(fn))).toEqual([]);
  });

  it('closes a menu when the table (or any box) it was opened from scrolls, but not when the menu itself scrolls', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const box = document.createElement('div');
    box.className = 'dt-scroll';
    const anchor = document.createElement('button');
    box.append(anchor);
    document.body.append(box);
    const menu = openMenu(anchor, [{ label: 'Download', run() {} }]);
    menu.el.dispatchEvent(new Event('scroll'));
    expect(menu.el.isConnected).toBe(true);
    box.dispatchEvent(new Event('scroll'));
    expect(menu.el.isConnected).toBe(false);
  });
});

describe('data table', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Row ${String(i).padStart(2, '0')}`, n: i }));
  const make = async (extra = {}) => {
    const { dataTable } = await import('../src/ui/components.js');
    const t = dataTable({
      caption: 'Things',
      columns: [
        { id: 'name', label: 'Name', render: (r) => r.name, sort: (r) => r.name },
        { id: 'n', label: 'Number', render: (r) => String(r.n), sort: (r) => r.n },
      ],
      rows,
      sort: { id: 'name', dir: 'asc' },
      onSort() {},
      rowHref: (r) => `#/things/${r.id}`,
      ...extra,
    });
    document.body.append(t.node);
    return t;
  };

  it('keeps focus on a column header after sorting with the keyboard', async () => {
    const t = await make();
    const btn = [...t.node.querySelectorAll('th button.sort')].find((b) => b.textContent === 'Number');
    btn.focus();
    btn.click();
    expect(document.activeElement.closest('th')?.textContent).toBe('Number');
    expect(document.activeElement.closest('th').getAttribute('aria-sort')).toBe('ascending');
  });

  it('keeps focus on the same row when the rows are refreshed', async () => {
    const t = await make();
    const link = [...t.node.querySelectorAll('a.row-link')].find((a) => a.textContent === 'Row 05');
    link.focus();
    t.setRows(rows.map((r) => ({ ...r })));
    expect(document.activeElement.textContent).toBe('Row 05');
    expect(document.activeElement.isConnected).toBe(true);
  });

  it('keeps focus on a row checkbox when the rows are refreshed', async () => {
    const t = await make({ selectable: true });
    const cb = t.node.querySelectorAll('tbody input[type=checkbox]')[3];
    cb.focus();
    cb.click();
    t.setRows(rows.map((r) => ({ ...r })));
    expect(document.activeElement.type).toBe('checkbox');
    expect(document.activeElement.checked).toBe(true);
    expect(document.activeElement.closest('tr').textContent).toContain('Row 03');
  });

  it('moves focus to the first newly shown item after "Show more" in the phone list', async () => {
    const { dataTable } = await import('../src/ui/components.js');
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, name: `Item ${i}` }));
    const t = dataTable({
      columns: [{ id: 'name', label: 'Name', render: (r) => r.name }],
      rows: many,
      mobile: (r) => {
        const a = document.createElement('a');
        a.href = `#/x/${r.id}`;
        a.textContent = r.name;
        return a;
      },
    });
    document.body.append(t.node);
    const more = t.node.querySelector('.dt-more button');
    more.focus();
    more.click();
    expect(document.activeElement.textContent).toBe('Item 50');
  });

  it('announces the Columns button as opening a dialog, which is what it opens', async () => {
    const t = await make();
    const btn = t.columnsButton();
    document.body.append(btn);
    btn.click();
    await tick();
    const pop = document.querySelector('.popover');
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('names the Columns button for screen readers when its text is hidden on phones', async () => {
    const t = await make();
    const btn = t.columnsButton();
    // .hide-sm is display: none on phones, which also hides the text from screen readers.
    expect(btn.querySelector(':scope > .hide-sm')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Columns');
  });

  it('opens a row in a new tab on Ctrl/Cmd+click, like its link, instead of leaving the list', async () => {
    const t = await make();
    location.hash = '#/things';
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const cell = t.node.querySelector('tbody tr:not(.dt-spacer) td:nth-child(2)');
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await tick();
    expect(location.hash).toBe('#/things');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatch(/#\/things\/r\d+$/);
    open.mockRestore();
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(location.hash).toMatch(/^#\/things\/r\d+$/);
  });
});

describe('toasts', () => {
  it('has its live region in the page before the first message', async () => {
    document.body.replaceChildren();
    await import('../src/ui/toast.js?fresh');
    const region = document.querySelector('.toast-region');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region.children.length).toBe(0);
  });

  it('shows a toast inside an open dialog, where it is visible and not inert, and keeps it when the dialog closes', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const { openDialog } = await import('../src/ui/dialog.js');
    const { dialog, close } = openDialog({ title: 'Time entry', body: document.createElement('input') });
    const region = dialog.querySelector('.toast-region');
    expect(region?.children.length).toBe(0); // there before the message
    toast('Enter how long the work took.', { type: 'error' });
    const node = document.querySelector('.toast.error');
    expect(node.closest('dialog')).toBe(dialog);
    close();
    expect(node.isConnected).toBe(true);
    expect(node.closest('dialog')).toBe(null);
  });

  it('moves toasts to the dialog underneath when a nested dialog closes', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const { openDialog } = await import('../src/ui/dialog.js');
    const outer = openDialog({ title: 'Bill', body: 'x' });
    const inner = openDialog({ title: 'Confirm', body: 'y' });
    toast('Payment recorded');
    inner.close();
    expect(document.querySelector('.toast').closest('dialog')).toBe(outer.dialog);
    outer.close();
  });

  it('does not time out a toast while keyboard focus is on its Undo button', async () => {
    const { toast } = await import('../src/ui/toast.js');
    vi.useFakeTimers();
    try {
      toast('Task deleted', { action: { label: 'Undo', run() {} } });
      const node = document.querySelector('.toast');
      node.querySelector('.toast-action').focus();
      vi.advanceTimersByTime(20000);
      expect(node.isConnected).toBe(true);
      node.querySelector('.toast-action').blur();
      vi.advanceTimersByTime(5000);
      expect(node.isConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('form fields', () => {
  it('drops required when a field is laid out again as optional', async () => {
    const { field, textInput } = await import('../src/ui/components.js');
    const { matterPicker } = await import('../src/views/common.js');
    const input = textInput({ name: 'x' });
    field('X', input, { required: true });
    expect(input.required).toBe(true);
    const again = field('X', input, { required: false });
    expect(input.required).toBe(false);
    expect(again.querySelector('.req')).toBeNull();
    // Left unsaid, the control keeps what it was given.
    const date = textInput({ name: 'd', type: 'date', required: true });
    field('Date', date);
    expect(date.required).toBe(true);
    const picker = matterPicker({ value: '' });
    field('Matter', picker, { required: true });
    field('Matter', picker, { required: false });
    expect(picker.input.required).toBe(false);
  });
});

describe('tabs', () => {
  it('names the panel each tab controls when given one', async () => {
    const { tabs } = await import('../src/ui/components.js');
    const list = tabs({ label: 'Sections', selected: 'a', panelId: 'sec-panel', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], onSelect() {} });
    const [a, b] = list.querySelectorAll('[role=tab]');
    expect(a.getAttribute('aria-controls')).toBe('sec-panel');
    expect(b.getAttribute('aria-controls')).toBe('sec-panel');
    expect(a.id).not.toBe(b.id);
    // Without a panel, nothing points at an element that does not exist.
    const plain = tabs({ selected: 'a', items: [{ id: 'a', label: 'A' }], onSelect() {} });
    expect(plain.querySelector('[role=tab]').hasAttribute('aria-controls')).toBe(false);
  });
});

describe('money inputs', () => {
  it('shows whole yen without ".00" in a firm that bills in yen', async () => {
    const { moneyInput } = await import('../src/ui/components.js');
    const { setMoneyDefaults } = await import('../src/core/money.js');
    setMoneyDefaults({ currency: 'JPY' });
    try {
      const input = moneyInput({ name: 'amount', cents: 150000 });
      expect(input.value).toBe('1500');
      expect(input.placeholder).toBe('0');
      input.value = '2,000';
      input.dispatchEvent(new Event('blur'));
      expect(input.value).toBe('2000');
      expect(input.cents).toBe(200000);
    } finally {
      setMoneyDefaults({ currency: 'USD' });
    }
    expect(moneyInput({ name: 'amount', cents: 150000 }).value).toBe('1500.00');
  });
});

describe('meter', () => {
  it('tells screen readers the real percentage when over 100', async () => {
    const { meter } = await import('../src/ui/components.js');
    const m = meter(140, { label: 'Budget used' });
    expect(m.getAttribute('aria-valuenow')).toBe('100');
    expect(m.getAttribute('aria-valuetext')).toBe('140%');
    expect(meter(42.4).getAttribute('aria-valuetext')).toBe('42%');
  });
});

import { readFileSync } from 'node:fs';

describe('theme styles', () => {
  const read = (f) => readFileSync(`${process.cwd()}/src/styles/${f}`, 'utf8');
  const tokens = read('tokens.css');
  const block = (sel) => tokens.slice(tokens.indexOf(sel)).split('}')[0];
  const vars = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = vars(block(':root {'));
  const dark = { ...light, ...vars(block("[data-theme='dark'] {")) };
  const resolve = (v, t) => (v.startsWith('var(') ? t[v.slice(4, -1)] : v);
  const lum = (hex) => {
    const h6 = hex.replace('#', '');
    const c = (h6.length === 3 ? [...h6].map((x) => x + x).join('') : h6).match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const blend = (fg, bg, a) => {
    const rgb = (hex) => hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    const [f, b] = [rgb(fg), rgb(bg)];
    return '#' + f.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
  };

  it('applies every dark-only override for the system dark preference too', () => {
    const missing = [];
    for (const f of ['components.css', 'shell.css']) {
      const css = read(f);
      for (const [, sel] of css.matchAll(/^\[data-theme='dark'\] ([^{]+?)\s*\{/gm)) {
        if (!css.includes(`:root:not([data-theme='light']) ${sel}`)) missing.push(`${f}: ${sel}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('draws the running timer\'s play/pause icon with enough contrast in both themes', () => {
    const rule = read('shell.css').split('.timer.running .timer-icon {')[1].split('}')[0];
    const prop = (name) => rule.match(new RegExp(`\\b${name}:\\s*([^;]+);`))[1].trim();
    for (const t of [light, dark]) expect(contrast(resolve(prop('color'), t), resolve(prop('background'), t))).toBeGreaterThanOrEqual(3);
  });

  it('shows placeholder text (such as "1.0, 1:30, or 45m") at AA contrast in both themes', () => {
    const rule = read('components.css').split('.textarea::placeholder {')[1].split('}')[0];
    const opacity = Number(rule.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
    const color = rule.match(/color:\s*([^;]+);/)[1].trim();
    for (const t of [light, dark]) {
      const bg = t['--surface'];
      expect(contrast(blend(resolve(color, t), bg, opacity), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('prints in the light palette even when the app is in dark mode', () => {
    // Paper is white and browsers drop backgrounds when printing, so dark
    // mode's near-white text would print invisibly.
    const print = read('print.css');
    const at = print.indexOf(":root:not([data-theme='light'])");
    expect(at).toBeGreaterThan(-1);
    const printed = vars(print.slice(at).split('}')[0]);
    const darkOnly = vars(block("[data-theme='dark'] {"));
    for (const name of Object.keys(darkOnly)) expect([name, printed[name]]).toEqual([name, light[name]]);
  });
});

describe('timer', () => {
  it('does not move time recorded on one matter to another when the timer is started there', async () => {
    const saved = [];
    vi.doMock('../src/views/dialogs.js', () => ({ openActivityDialog: async (o) => (saved.push(o), { id: 'a1' }) }));
    const { startTimerOn, getTimer, resetTimer, updateTimer } = await import('../src/ui/timer.js');
    const [a, b] = app.store.all('matters');
    resetTimer();
    updateTimer({ matterId: a.id, description: 'Drafting', accumulated: 45 * 60000 });

    // Cancel: nothing changes.
    let started = startTimerOn(b.id);
    await tick();
    let cancel = [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((x) => x.textContent === 'Cancel');
    cancel.click();
    expect(await started).toBe(false);
    expect(getTimer()).toMatchObject({ matterId: a.id, accumulated: 45 * 60000, running: false });

    // Save and switch: the 45 minutes are offered as an entry on the first matter.
    started = startTimerOn(b.id);
    await tick();
    [...document.querySelectorAll('dialog[open] .dialog-foot button')].find((x) => x.textContent === 'Save and switch').click();
    expect(await started).toBe(true);
    expect(saved).toEqual([expect.objectContaining({ kind: 'time', minutes: 45, matterId: a.id, description: 'Drafting' })]);
    const t = getTimer();
    expect(t).toMatchObject({ matterId: b.id, description: '', running: true, accumulated: 0 });
    resetTimer();
    vi.doUnmock('../src/views/dialogs.js');
  });

  it('just starts or resumes when the timer is empty, on the same matter, or has no matter yet', async () => {
    const { startTimerOn, getTimer, resetTimer, updateTimer } = await import('../src/ui/timer.js');
    const [a, b] = app.store.all('matters');
    resetTimer();
    expect(await startTimerOn(a.id)).toBe(true);
    expect(getTimer()).toMatchObject({ matterId: a.id, running: true });
    resetTimer();
    updateTimer({ matterId: b.id, description: 'Call', accumulated: 600000 });
    expect(await startTimerOn(b.id)).toBe(true);
    expect(getTimer()).toMatchObject({ matterId: b.id, description: 'Call', accumulated: 600000, running: true });
    resetTimer();
    updateTimer({ accumulated: 600000 });
    expect(await startTimerOn(a.id)).toBe(true);
    expect(getTimer()).toMatchObject({ matterId: a.id, accumulated: 600000, running: true });
    resetTimer();
  });
});
