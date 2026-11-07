import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '../src/views/home.js';

// jsdom has no modal dialogs.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeApp({ fail = false } = {}) {
  let index = {
    s1: { title: 'Alpha', status: 'draft', updatedAt: 1, folder: '' },
    s2: { title: 'Beta', status: 'open', updatedAt: 2, folder: '' },
  };
  let folders = {};
  const repo = {
    get index() {
      return index;
    },
    loadIndex: async () => {
      if (fail) throw new Error('offline');
      return index;
    },
    loadFolders: async () => folders,
    createFolder: async (name) => {
      folders = { ...folders, f1: { name } };
      return 'f1';
    },
    patchMeta: async (sid, p) => {
      index = { ...index, [sid]: { ...index[sid], ...p } };
    },
    patchMany: async (patches) => {
      for (const [sid, p] of Object.entries(patches)) index = { ...index, [sid]: { ...index[sid], ...p } };
    },
  };
  return {
    repo,
    settings: {},
    backend: { ai: {} },
    client: { peek: async () => null },
    setAppbar() {},
    homeBrand: () => document.createElement('span'),
    setSetting() {},
    go() {},
  };
}

let view;
let host;
async function mountHome(opts) {
  host = document.createElement('div');
  document.body.append(host);
  view = await mount(host, { folder: '' }, makeApp(opts));
  return host;
}

afterEach(() => {
  view?.unmount?.();
  document.body.innerHTML = '';
});

describe('home', () => {
  it('keeps what is typed into the AI prompt across redraws', async () => {
    await mountHome();
    const ai = host.querySelector('.ai-prompt input');
    ai.focus();
    ai.value = 'How customers feel about delivery';
    host.querySelector('[aria-label="New folder"]').click();
    const dlg = document.querySelector('dialog[open]');
    dlg.querySelector('input').value = 'Clients';
    dlg.querySelector('form').requestSubmit();
    await tick();
    expect(host.querySelector('.ai-prompt input').value).toBe('How customers feel about delivery');
  });

  it('acts only on selected surveys the list still shows', async () => {
    await mountHome();
    for (const b of host.querySelectorAll('.survey-row input[type=checkbox]')) {
      b.checked = true;
      b.dispatchEvent(new Event('change'));
    }
    expect(host.querySelector('.bulk-bar .grow').textContent).toBe('2 selected');
    const status = host.querySelector('select[aria-label="Filter by status"]');
    status.value = 'draft';
    status.dispatchEvent(new Event('change'));
    expect(host.querySelectorAll('.survey-row')).toHaveLength(1);
    expect(host.querySelector('.bulk-bar .grow').textContent).toBe('1 selected');
  });

  it('ignores the new-survey shortcut on the load error screen', async () => {
    await mountHome({ fail: true });
    const errors = [];
    const onError = (e) => {
      errors.push(e.message);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    await tick();
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('says so when moving surveys fails', async () => {
    const app = makeApp();
    app.repo.index.s1.folder = 'f1';
    app.repo.index.s2.folder = 'f1';
    app.repo.loadFolders = async () => ({ f1: { name: 'Clients' } });
    app.repo.patchMany = async () => {
      throw new Error('offline');
    };
    host = document.createElement('div');
    document.body.append(host);
    view = await mount(host, { folder: '' }, app);
    const rejections = [];
    const onRejection = (e) => rejections.push(e.reason);
    window.addEventListener('unhandledrejection', onRejection);
    const box = host.querySelector('.survey-row input[type=checkbox]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    host.querySelector('.bulk-bar .btn').click();
    const remove = [...document.querySelectorAll('.menu button')].find((b) => /Remove from folder/.test(b.textContent));
    expect(remove).toBeTruthy();
    remove.click();
    await tick();
    // Toasts land a moment after their live region is placed.
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('unhandledrejection', onRejection);
    expect(rejections).toEqual([]);
    expect(document.body.textContent).toContain('Could not move the surveys');
  });

  it('keeps keyboard focus in the list when the selection bar goes away', async () => {
    const app = makeApp();
    app.repo.index.s1.folder = 'f1';
    app.repo.loadFolders = async () => ({ f1: { name: 'Clients' } });
    host = document.createElement('div');
    document.body.append(host);
    view = await mount(host, { folder: '' }, app);
    const select = (title) => {
      const box = host.querySelector(`input[aria-label="Select ${title}"]`);
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    };
    // Moved: the whole page redraws.
    select('Alpha');
    const move = host.querySelector('[data-fk="bulk-move"]');
    move.focus();
    move.click();
    [...document.querySelectorAll('.menu button')].find((b) => /Remove from folder/.test(b.textContent)).click();
    await tick();
    expect(host.querySelector('.bulk-bar')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="Select Alpha"]'));
    // Cleared: only the list redraws.
    select('Beta');
    const clear = host.querySelector('[data-fk="bulk-clear"]');
    clear.focus();
    clear.click();
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="Select Beta"]'));
  });

  it('keeps focus in the search box when response counts arrive', async () => {
    const app = makeApp();
    let answer;
    app.client = { peek: async () => ({}), stats: () => new Promise((r) => (answer = r)) };
    host = document.createElement('div');
    document.body.append(host);
    view = await mount(host, { folder: '' }, app);
    const search = host.querySelector('input[type=search]');
    search.focus();
    search.value = 'Alp';
    search.setSelectionRange(3, 3);
    // Counts came back changed: the page redraws around the search box.
    answer({ surveys: { s1: 4 } });
    await tick();
    expect(host.querySelector('[data-sid="s1"] .survey-count strong').textContent).toBe('4');
    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(3);
  });

  it('shows all surveys for a link to a folder that does not exist', async () => {
    host = document.createElement('div');
    document.body.append(host);
    view = await mount(host, { folder: 'gone' }, makeApp());
    await tick();
    expect(host.querySelector('h1').textContent).toBe('Surveys');
    expect(host.querySelectorAll('.survey-row')).toHaveLength(2);
  });
});
