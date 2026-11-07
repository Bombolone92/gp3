// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

let view;
beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { view?.destroy?.(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

// A long file name is cut short with an ellipsis on the row, and the row had no tooltip to show the rest.
it('shows the whole file name on hover over a row', async () => {
  const name = 'Quarterly forecast with a very long descriptive name that does not fit the row.xlsx';
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: `Spreadsheets/${name}`, name, modified: 1, size: 10 }]);
  view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.el.querySelector('.file-main').title).toBe(name);
});
