import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { historyView } from '../src/views/history.js';
import { store } from '../src/lib/store.js';
import { puterBackend, deferred } from './helpers/puter-kv.js';
import { downloadFile } from '../src/lib/util.js';

vi.mock('../src/lib/util.js', async (original) => ({ ...await original(), downloadFile: vi.fn() }));
let dom;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/history', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  await store.addStakeholder({ name: '<script>unsafe()</script>', kind: 'founder' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); dom.window.close(); });
const mount = () => { const root = historyView(); document.querySelector('#app').append(root); return root; };
const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 2)); }
  throw new Error('UI did not reach the expected state');
};

describe('history screen', () => {
  it('renders history, applies filters and opens escaped before/after details', async () => {
    const root = mount();
    await waitFor(() => root.querySelectorAll('article').length === 2);
    expect(root.textContent).toContain('Recorded');
    root.querySelector('input[placeholder="Action, e.g. exercise"]').value = 'addStakeholder';
    root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => root.querySelectorAll('article').length === 1);
    root.querySelector('article button').click();
    await waitFor(() => document.querySelector('[role="dialog"]'));
    const modal = document.querySelector('[role="dialog"]');
    expect(modal.textContent).toContain('<script>unsafe()</script>');
    expect(modal.querySelector('script')).toBeNull();
    expect(modal.textContent).toContain('Before');
    expect(modal.textContent).toContain('After');
  });

  it('honors a record link and exports the complete archive rather than only matching rows', async () => {
    location.hash = '#/history?record=missing';
    const root = mount();
    await waitFor(() => root.textContent.includes('No recorded changes match'));
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Export JSON');
    button.click();
    await waitFor(() => root.textContent.includes('Complete history exported'));
    const [filename, content, type] = downloadFile.mock.calls.at(-1);
    expect(filename).toMatch(/\.json$/);
    expect(type).toBe('application/json');
    expect(JSON.parse(content).events).toHaveLength(2);
  });

  it('does not display results from a previous company after a switch', async () => {
    const pending = deferred();
    vi.spyOn(store, 'auditPage').mockReturnValueOnce(pending.promise);
    const root = mount();
    await store.createCompany('Second');
    pending.resolve({ entries: [{ operation: 'private old company data' }], cursor: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(root.textContent).not.toContain('private old company data');
  });

  it('keeps the newest filter result when an earlier request finishes later', async () => {
    const pending = deferred();
    vi.spyOn(store, 'auditPage').mockReturnValueOnce(pending.promise);
    const root = mount();
    root.querySelector('input[placeholder="Action, e.g. exercise"]').value = 'no-match';
    root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => root.textContent.includes('No recorded changes match'));
    pending.resolve({ entries: [{ operation: 'stale results' }], cursor: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(root.textContent).not.toContain('stale results');
  });
});
