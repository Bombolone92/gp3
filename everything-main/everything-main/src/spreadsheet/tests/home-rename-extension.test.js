// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(async () => 'Budget.XLSX'), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it('does not append the extension twice when the typed name already has it', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ name: 'Plan.xlsx', path: 'Spreadsheets/Plan.xlsx', size: 10, modified: 1 }]);
  const renameFile = vi.spyOn(P, 'renameFile').mockResolvedValue({});
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  view.el.querySelector('.file-menu-btn').click();
  const item = [...document.querySelectorAll('.menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === 'Rename…');
  item.click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(renameFile).toHaveBeenCalledWith('Spreadsheets/Plan.xlsx', 'Budget.xlsx');
});
