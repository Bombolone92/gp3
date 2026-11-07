import { describe, it, expect, afterEach } from 'vitest';
import { openDialog } from '../src/ui/dialog.js';
import { openPicker, openMenu, closePopover } from '../src/ui/popover.js';
import { h } from '../src/ui/dom.js';

afterEach(() => {
  closePopover();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('popovers', () => {
  it('open inside a modal dialog when anchored there, so they are not inert', () => {
    const anchor = h('button', { type: 'button' }, 'Pick');
    const dlg = openDialog({ title: 'Edit', body: anchor });
    openPicker(anchor, { options: [{ value: 'a', label: 'A' }], onPick() {} });
    const pop = document.querySelector('.popover');
    expect(pop.parentElement).toBe(dlg.el);
    expect(dlg.el.contains(document.activeElement)).toBe(true);
  });

  it('open on the page body otherwise', () => {
    const anchor = h('button', { type: 'button' }, 'More');
    document.body.append(anchor);
    openMenu(anchor, [{ label: 'One', run() {} }]);
    expect(document.querySelector('.popover').parentElement).toBe(document.body);
    anchor.remove();
  });
});

describe('menu buttons', () => {
  it('close their menu or picker on a second click', async () => {
    const { selectField } = await import('../src/ui/components.js');
    const btn = h('button', { type: 'button', onclick: () => openMenu(btn, [{ label: 'One', run() {} }]) }, 'More');
    const sel = selectField({ value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    document.body.append(btn, sel);
    for (const b of [btn, sel]) {
      b.click();
      expect(document.querySelectorAll('.popover').length).toBe(1);
      b.click();
      expect(document.querySelectorAll('.popover').length).toBe(0);
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(b);
    }
    btn.remove();
    sel.remove();
  });
});

describe('scrolling under a menu', () => {
  it('moves the menu with its button, and closes it once the button is gone from view', async () => {
    const panel = h('div');
    const btn = h('button', { type: 'button' }, 'More');
    panel.append(btn);
    document.body.append(panel);
    let top = 100;
    btn.getBoundingClientRect = () => ({ top, bottom: top + 30, left: 10, right: 90, width: 80, height: 30 });
    openMenu(btn, [{ label: 'One', run() {} }]);
    const pop = document.querySelector('.popover');
    const before = pop.style.top;
    top = 200;
    panel.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 50));
    expect(pop.isConnected).toBe(true);
    expect(pop.style.top).not.toBe(before);
    top = -500;
    panel.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('.popover')).toBeNull();
    panel.remove();
  });
});

describe('Tab in a menu', () => {
  it('leaves focus on the menu button, for Tab to move on from', () => {
    const btn = h('button', { type: 'button' }, 'More');
    document.body.append(btn);
    openMenu(btn, [{ label: 'One', run() {} }]);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(tab);
    expect(document.querySelector('.popover')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(tab.defaultPrevented).toBe(false);
    btn.remove();
  });
});

describe('toasts and announcements over a dialog', () => {
  it('show in the dialog, where they are not inert, and stay when it closes', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const { announce } = await import('../src/ui/dom.js');
    const dlg = openDialog({ title: 'Edit profile', body: h('p', 'x') });
    toast('Could not save the profile');
    announce('Saved draft');
    await new Promise((r) => setTimeout(r, 50));
    const shown = [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Could not save'));
    expect(dlg.el.contains(shown)).toBe(true);
    expect(dlg.el.querySelector('[aria-live]:not(.toasts)').textContent).toBe('Saved draft');
    dlg.close();
    expect(shown.isConnected).toBe(true);
    expect(shown.closest('dialog')).toBeNull();
    shown.remove();
  });

  it('read out a toast shown just after a dialog closed', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const dlg = openDialog({ title: 'Delete view?', body: h('p', 'x') });
    toast('Deleting');
    dlg.close();
    toast('View deleted.');
    const region = [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('View deleted.')).closest('[aria-live]');
    expect(region.getAttribute('aria-live')).toBe('polite');
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  });
});

describe('focus after a choice', () => {
  it('moves to the replacement of a select that repainted its own toolbar', async () => {
    const { selectField } = await import('../src/ui/components.js');
    const bar = h('div');
    document.body.append(bar);
    let range = '7d';
    const paint = () => {
      bar.replaceChildren(
        h('label', { for: 'r1' }, 'Date range'),
        selectField({ id: 'r1', value: range, label: 'Date range', options: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }], onChange: (v) => { range = v; paint(); } }),
        h('label', { for: 'g1' }, 'Groups'),
        selectField({ id: 'g1', value: null, label: 'Groups', options: [{ value: null, label: 'All groups' }, { value: 's', label: 'Support' }], onChange: () => paint() }));
    };
    paint();
    const groups = bar.querySelectorAll('.select-btn')[1];
    groups.focus();
    groups.click();
    [...document.querySelectorAll('.picker-option')].find((o) => o.textContent === 'Support').click();
    expect(document.activeElement).toBe(bar.querySelectorAll('.select-btn')[1]);
    bar.querySelectorAll('.select-btn')[0].click();
    [...document.querySelectorAll('.picker-option')].find((o) => o.textContent === 'Last 30 days').click();
    expect(document.activeElement).toBe(bar.querySelectorAll('.select-btn')[0]);
    bar.remove();
  });

  it('moves to the replacement of a menu button that repainted', () => {
    const head = h('header');
    document.body.append(head);
    let sort = 'Newest first';
    const paint = () => {
      const btn = h('button.btn', { type: 'button', onclick: () => openMenu(btn, ['Newest first', 'Oldest first'].map((label) => ({ label, run: () => { sort = label; paint(); } }))) }, sort);
      head.replaceChildren(h('h1', 'Home'), btn);
    };
    paint();
    head.querySelector('button').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Oldest first').click();
    expect(document.activeElement).toBe(head.querySelector('button'));
    expect(document.activeElement.textContent).toBe('Oldest first');
    head.remove();
  });
});

describe('input method composition', () => {
  it('does not take Enter that confirms a composition as a command', async () => {
    const { tagsInput } = await import('../src/ui/components.js');
    const changes = [];
    const box = tagsInput({ label: 'Tags', onChange: (v) => changes.push(v) });
    document.body.append(box);
    const input = box.querySelector('input');
    input.value = 'nihao';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    expect(changes).toEqual([]);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(changes).toEqual([['nihao']]);
    box.remove();

    const anchor = h('button', { type: 'button' }, 'Pick');
    document.body.append(anchor);
    const picked = [];
    openPicker(anchor, { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onPick: (v) => picked.push(v) });
    const search = document.querySelector('.picker-search');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    expect(picked).toEqual([]);
    expect(document.querySelector('.popover')).toBeTruthy();
    anchor.remove();
  });
});

describe('editor paste', () => {
  function paste(content, data, files = []) {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { files, getData: (type) => data[type] || '' };
    content.dispatchEvent(ev);
  }

  it('pastes the text of Office content that also carries a picture', async () => {
    const { createEditor } = await import('../src/ui/editor.js');
    const editor = createEditor();
    document.body.append(editor.el);
    const got = [];
    editor.onFiles = (f) => got.push(...f);
    const png = new File(['x'], 'image.png', { type: 'image/png' });
    editor.content.focus();
    paste(editor.content, { 'text/html': '<table><tr><td>Order 42</td></tr></table>', 'text/plain': 'Order 42' }, [png]);
    expect(got).toEqual([]);
    expect(editor.getText()).toContain('Order 42');
    // A copied image, or a file, still attaches.
    paste(editor.content, { 'text/html': '<img src="https://example.com/a.png">' }, [png]);
    paste(editor.content, { 'text/plain': 'report.pdf' }, [png]);
    expect(got.length).toBe(2);
    editor.el.remove();
  });
});

describe('toasts', () => {
  it('announce through one live region that is already on the page', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const t = toast('Saved.');
    const region = document.querySelector('.toasts');
    expect(region.getAttribute('aria-live')).toBe('polite');
    const el = region.querySelector('.toast');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-live')).toBe(false);
    t.close();
    const e = toast('Failed.', { kind: 'error' });
    expect(region.querySelector('.toast-error').getAttribute('role')).toBe('alert');
    e.close();
  });
});

describe('popover cleanup', () => {
  it('leaves no outside-click listener behind when closed right away', async () => {
    const live = new Set();
    const realAdd = document.addEventListener;
    const realRemove = document.removeEventListener;
    document.addEventListener = function add(type, fn, opts) { if (type === 'pointerdown') live.add(fn); return realAdd.call(this, type, fn, opts); };
    document.removeEventListener = function remove(type, fn, opts) { if (type === 'pointerdown') live.delete(fn); return realRemove.call(this, type, fn, opts); };
    try {
      const anchor = h('button', { type: 'button' }, 'More');
      document.body.append(anchor);
      openMenu(anchor, [{ label: 'One', run() {} }]);
      closePopover();
      await new Promise((r) => setTimeout(r, 10));
      expect(live.size).toBe(0);
      anchor.remove();
    } finally {
      document.addEventListener = realAdd;
      document.removeEventListener = realRemove;
    }
  });
});
