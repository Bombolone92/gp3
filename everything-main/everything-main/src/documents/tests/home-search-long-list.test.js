// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let view;
const files = (count) => Array.from({ length: count }, (_, i) => ({ name: `${i % 2 ? 'Report' : 'Notes'} ${i}.docx`, path: `Documents/${i % 2 ? 'Report' : 'Notes'} ${i}.docx`, size: 10, modified: i }));
const names = () => [...view.el.querySelectorAll('.file-name')].map((n) => n.textContent);
const type = (value) => { const search = view.el.querySelector('.home-search'); search.value = value; search.dispatchEvent(new Event('input')); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFolder').mockResolvedValue([]);
});
afterEach(() => { view.destroy(); vi.runAllTimers(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function open(count) {
  vi.spyOn(P, 'listFiles').mockResolvedValue(files(count));
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  expect(names()).toHaveLength(count);
}

it('filters a long list once the typing pauses, not on every keystroke', async () => {
  await open(600);
  type('rep');
  expect(names()).toHaveLength(600);
  await vi.advanceTimersByTimeAsync(60);
  type('repo');
  await vi.advanceTimersByTimeAsync(60);
  // Two keystrokes 60 ms apart: still the whole list, and one rebuild to come.
  expect(names()).toHaveLength(600);
  await vi.advanceTimersByTimeAsync(120);
  expect(names()).toHaveLength(300);
  expect(names().every((n) => n.startsWith('Report'))).toBe(true);
});

it('filters a short list as the user types', async () => {
  await open(20);
  type('rep');
  expect(names()).toHaveLength(10);
});

it('gives every row its icons', async () => {
  await open(3);
  const row = view.el.querySelector('.file-row');
  expect(row.querySelectorAll('svg')).toHaveLength(3);
  expect(row.querySelector('.file-menu-btn svg')).not.toBeNull();
  expect(row.querySelector('.file-star-btn svg')).not.toBeNull();
});

it('tells screen readers how many documents a search leaves', async () => {
  await open(20);
  const status = () => view.el.querySelector('[role="status"].visually-hidden')?.textContent;
  expect(status()).toBe('');
  type('report 19');
  expect(status()).toBe('1 document shown');
  type('rep');
  expect(status()).toBe('10 documents shown');
  type('zzz');
  expect(status()).toBe('No matches');
  type('');
  expect(status()).toBe('');
});
