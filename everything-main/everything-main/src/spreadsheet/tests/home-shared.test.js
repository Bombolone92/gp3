// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [{ path: '/ana/u1/Team.xlsx', name: 'Team.xlsx', at: 1 }], forgetRecent: vi.fn() }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/Mine.xlsx', name: 'Mine.xlsx', uid: 'm1' }]);
  vi.spyOn(P, 'listSharedWithMe').mockResolvedValue([{ name: 'Team.xlsx', path: '/ana/u1/Team.xlsx', uid: 'u1', mode: 'read', owner: 'ana' }]);
  document.body.replaceChildren();
});
afterEach(() => {
  closeMenu();
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('lists what others shared with the user, once, and opens it', async () => {
  const openPath = vi.fn();
  const view = homeView({ openPath });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  const section = view.el.querySelector('.home-shared');
  expect(section.hidden).toBe(false);
  const open = section.querySelector('.recent-open');
  expect(open.getAttribute('aria-label')).toBe('Open Team, From ana · view only');
  // The shared file opened before is not listed a second time as opened elsewhere.
  expect([...view.el.querySelectorAll('.recent-name')].map((n) => n.textContent)).toEqual(['Team']);
  open.click();
  expect(openPath).toHaveBeenCalledWith('/ana/u1/Team.xlsx');
  view.destroy();
});

it('leaves a share after asking', async () => {
  vi.spyOn(P, 'leaveShare').mockResolvedValue(1);
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.home-shared .recent-forget').click();
  await vi.advanceTimersByTimeAsync(0);
  [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Leave').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(P.leaveShare).toHaveBeenCalledWith('/ana/u1/Team.xlsx');
  expect(view.el.querySelector('.home-shared').hidden).toBe(true);
  view.destroy();
});

it('offers Share in a file’s menu where the host can share', async () => {
  vi.stubGlobal('puter', { fs: { share() {}, getShares: async () => [] } });
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.file-menu-btn').click();
  const item = [...document.querySelectorAll('.menu [role="menuitem"]')].find((n) => n.textContent.includes('Share…'));
  expect(item).toBeTruthy();
  item.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.modal-title').textContent).toBe('Share "Mine"');
  view.destroy();
});

it('shows the newest few shared spreadsheets, and the rest on asking', async () => {
  P.listSharedWithMe.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ name: `S${i}.xlsx`, path: `/ana/u${i}/S${i}.xlsx`, uid: `u${i}`, mode: 'read', owner: 'ana' })));
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  const shown = () => [...view.el.querySelectorAll('.home-shared .recent-chip')].filter((c) => !c.hidden).length;
  expect(shown()).toBe(8);
  const more = view.el.querySelector('.home-shared-more');
  expect(more.textContent).toBe('Show all 12');
  more.focus();
  more.click();
  expect(shown()).toBe(12);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(more);
  more.click();
  expect(shown()).toBe(8);
  view.destroy();
});

it('offers no such button for a short list', async () => {
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.el.querySelector('.home-shared-more')).toBeNull();
  // Nor anything in its place: the missing button once came out as the word "false" under the list.
  const section = view.el.querySelector('.home-shared');
  expect([...section.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toEqual([]);
  expect(section.textContent).not.toContain('false');
  view.destroy();
});

it('keeps a share that could not be left, and says why', async () => {
  vi.spyOn(P, 'leaveShare').mockResolvedValue(0);
  vi.spyOn(P, 'statFile').mockResolvedValue({ path: '/ana/u1/Team.xlsx' });
  const { toast } = await import('../src/ui/toast.js');
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.home-shared .recent-forget').click();
  await vi.advanceTimersByTimeAsync(0);
  [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Leave').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(view.el.querySelector('.home-shared').hidden).toBe(false);
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('shared with a team you are in'), expect.anything());
  view.destroy();
});

it('drops a share that was gone already', async () => {
  vi.spyOn(P, 'leaveShare').mockResolvedValue(0);
  vi.spyOn(P, 'statFile').mockResolvedValue(null);
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.home-shared .recent-forget').click();
  await vi.advanceTimersByTimeAsync(0);
  [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Leave').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(view.el.querySelector('.home-shared').hidden).toBe(true);
  view.destroy();
});
