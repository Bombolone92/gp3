// Application shell: account rules, alpha notice, theme, layout landmarks,
// menus, keyboard chords and accessibility. jsdom has no WebGL, so editors
// show their fallback message; the shell around them is fully exercised.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axe from 'axe-core';
import { App, REPO_URL } from '../src/app/app.js';
import { setPuterForTests } from '../src/app/puter.js';
import { comboOf } from '../src/app/commands.js';
import { createExampleProject } from '../src/app/demo.js';
import { closeMenus } from '../src/ui/menu.js';

function mockPuter({ env = 'web', signedIn = true, username = 'ada' } = {}) {
  return {
    env,
    auth: {
      isSignedIn: () => signedIn,
      getUser: async () => (signedIn || env === 'app' ? { username } : null),
      getProfilePicture: async () => 'data:image/png;base64,iVBORw0KGgo=',
      signIn: vi.fn(async () => ({})),
      signOut: vi.fn(async () => {}),
    },
    fs: { readdir: async () => [], write: async (p) => ({ path: p }), read: async () => new Blob(['{}']) },
    kv: { get: async () => null, set: async () => true },
    ui: {},
  };
}

async function boot(puterMock) {
  document.body.innerHTML = '<div id="app"></div><div id="live-region"></div>';
  setPuterForTests(null);
  if (puterMock) window.puter = puterMock; else delete window.puter;
  const app = new App(document.getElementById('app'), { puterTimeout: 10 });
  await app.init();
  return app;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { closeMenus(); delete window.puter; setPuterForTests(null); document.body.innerHTML = ''; });

describe('account controls', () => {
  it('shows the profile picture and no sign out inside the Puter desktop', async () => {
    const app = await boot(mockPuter({ env: 'app' }));
    const btn = document.querySelector('.account-btn');
    expect(btn).toBeTruthy();
    expect(btn.querySelector('img.avatar').getAttribute('src')).toMatch(/^data:image\//);
    btn.click();
    const labels = [...document.querySelectorAll('.menu-item')].map((m) => m.textContent);
    expect(labels.some((l) => /sign out/i.test(l))).toBe(false);
    app.kernel.dispose();
  });

  it('offers sign out on the web when signed in', async () => {
    const app = await boot(mockPuter({ env: 'web', signedIn: true }));
    document.querySelector('.account-btn').click();
    const labels = [...document.querySelectorAll('.menu-item')].map((m) => m.textContent);
    expect(labels.some((l) => /sign out/i.test(l))).toBe(true);
    app.kernel.dispose();
  });

  it('offers sign in when signed out, and the app stays usable', async () => {
    const app = await boot(mockPuter({ env: 'web', signedIn: false }));
    expect([...document.querySelectorAll('.account button')].some((b) => /sign in/i.test(b.textContent))).toBe(true);
    expect(document.querySelector('.start-page')).toBeTruthy();
    await app.openExample();
    expect(app.project.name).toBe('LED Blinker');
    expect(app.openTabs.length).toBe(1);
    app.kernel.dispose();
  });
});

describe('shell', () => {
  it('links to the source code on GitHub', async () => {
    const app = await boot(null);
    const link = document.querySelector(`a[href="${REPO_URL}"]`);
    expect(link).toBeTruthy();
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('aria-label')).toMatch(/GitHub/);
    app.kernel.dispose();
  });

  it('shows the alpha notice once', async () => {
    let app = await boot(null);
    const notice = document.querySelector('.alpha-notice');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/early alpha/i);
    [...notice.querySelectorAll('button')].find((b) => b.textContent === 'Got it').click();
    app.kernel.dispose();
    app = await boot(null);
    expect(document.querySelector('.alpha-notice')).toBeNull();
    app.kernel.dispose();
  });

  it('defaults to the system theme and applies a chosen theme', async () => {
    const app = await boot(null);
    expect(document.documentElement.dataset.theme).toBe('system');
    app.commands.run('theme.dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeResolved).toBe('dark');
    app.commands.run('theme.system');
    expect(document.documentElement.dataset.theme).toBe('system');
    app.kernel.dispose();
  });

  it('switches menus with the active document type', async () => {
    const app = await boot(null);
    await app.openExample();
    const labels = () => [...document.querySelectorAll('.menubar > button')].map((b) => b.textContent);
    expect(labels()).toContain('Place');
    expect(labels()).not.toContain('Route');
    app.openDoc(app.project.boards[0].id);
    expect(labels()).toContain('Route');
    app.kernel.dispose();
  });

  it('opens a menu from its accelerator letter for chords', async () => {
    const app = await boot(null);
    await app.openExample();
    const canvas = app.activeEditor.canvas;
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    const menu = document.querySelector('.menu');
    expect(menu?.getAttribute('aria-label')).toBe('Place');
    // The second letter picks the item: W starts the wire tool.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    expect(app.activeEditor.tool.name).toBe('wire');
    app.kernel.dispose();
  });

  it('undoes and redoes edits through commands', async () => {
    const app = await boot(null);
    await app.openExample();
    const ed = app.activeEditor;
    const part = [...ed.doc.items()].find((o) => o.t === 'part');
    ed.setSelection([part.id]);
    app.commands.run('edit.delete');
    expect(ed.doc.store.get(part.id)).toBeUndefined();
    app.commands.run('edit.undo');
    expect(ed.doc.store.get(part.id)).toBeTruthy();
    app.commands.run('edit.redo');
    expect(ed.doc.store.get(part.id)).toBeUndefined();
    app.kernel.dispose();
  });

  it('has no serious accessibility violations on the start page and with a document open', async () => {
    const app = await boot(null);
    const check = async () => {
      const result = await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    };
    expect(await check()).toEqual([]);
    await app.openExample();
    expect(await check()).toEqual([]);
    app.kernel.dispose();
  });
});

describe('keyboard', () => {
  it('normalizes key combinations', () => {
    const ev = (key, opts = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...opts });
    expect(comboOf(ev('s', { ctrlKey: true }))).toBe('Mod+S');
    expect(comboOf(ev('Z', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+Z');
    expect(comboOf(ev(' '))).toBe('Space');
    expect(comboOf(ev('*', { shiftKey: true }))).toBe('*');
    expect(comboOf(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboOf(ev('3', { code: 'Numpad3' }))).toBe('Num3');
  });
});

describe('example project', () => {
  it('builds a consistent schematic and board', () => {
    const p = createExampleProject();
    const nets = p.netlist().nets.map((n) => n.name);
    expect(nets).toEqual(expect.arrayContaining(['VCC', 'GND', 'THR', 'DIS', 'OUT', 'LED', 'CV']));
    const comps = [...p.boards[0].items()].filter((o) => o.t === 'comp');
    expect(comps.map((c) => c.designator).sort()).toEqual(['C1', 'C2', 'C3', 'D1', 'J1', 'R1', 'R2', 'R3', 'U1']);
    expect(p.dirty).toBe(false);
  });
});
