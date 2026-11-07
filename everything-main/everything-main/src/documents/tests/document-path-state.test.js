// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as P from '../src/lib/puter.js';
import { Doc } from '../src/lib/doc.js';
import { homeView } from '../src/views/home.js';
import { toggleStar, isStarred, forgetStar } from '../src/lib/starred.js';
import { rememberGoal, recallGoal, moveGoal } from '../src/lib/goal.js';
import { rememberPosition, recallPosition, forgetPosition } from '../src/lib/position.js';

const root = '/demo/AppData/documents-app/Documents';
const relative = 'Documents/Report.docx', absolute = `${root}/Report.docx`;
let view;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  vi.stubGlobal('puter', { fs: {
    stat: vi.fn(async () => ({ path: root })),
    readdir: vi.fn(async () => [{ path: absolute, name: 'Report.docx', size: 12 }]),
    read: vi.fn(async () => new Blob(['document'])),
    mkdir: vi.fn(async () => {}),
    write: vi.fn(async () => ({ path: absolute, name: 'Report.docx' })),
  } });
});
afterEach(() => {
  view?.destroy(); view = null; document.body.replaceChildren();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const remember = (path) => {
  toggleStar(path); rememberGoal(path, 1200);
  rememberPosition(path, { blockId: 'paragraph-2', offset: 12 });
};
const expectState = (path) => {
  expect(isStarred(path)).toBe(true);
  expect(recallGoal(path)).toBe(1200);
  expect(recallPosition(path)).toMatchObject({ blockId: 'paragraph-2', offset: 12 });
};

it.each([relative, absolute].flatMap((stored) => [relative, absolute].map((listed) => ({ stored, listed }))))('retains local state across listing spellings (stored: $stored, listed: $listed)', async ({ stored, listed }) => {
  remember(stored);
  puter.fs.readdir.mockResolvedValue([{ name: 'Report.docx', path: listed, size: 12 }]);
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(0);
  expect(view.el.querySelector('.file-star-btn').getAttribute('aria-pressed')).toBe('true');
  expectState(relative); expectState(absolute);
  // Renaming through one spelling and deleting through the other affect one record.
  moveGoal(absolute, `${root}/Renamed.docx`);
  expect(recallGoal('Documents/Renamed.docx')).toBe(1200);
  expect(recallGoal(relative)).toBeNull();
  forgetStar(relative); forgetPosition(absolute);
  expect(isStarred(absolute)).toBe(false);
  expect(recallPosition(relative)).toBeNull();
});

it('shares local state immediately after Puter creates a relative-path document', async () => {
  const path = await P.createFile(relative, new Blob(['new']));
  expect(path).toBe(relative);
  remember(path); expectState(absolute);
});

it('restores local state when an absolute deep link opens before the home screen', async () => {
  remember(relative);
  const doc = await Doc.fromPath(absolute);
  expect(doc.path).toBe(absolute);
  expectState(doc.path);
  doc.destroy();
});

it('keeps documents in other folders distinct from the verified app folder', async () => {
  const outside = '/demo/Documents/Report.docx';
  remember(relative); rememberGoal(outside, 700);
  await Doc.fromPath(absolute);
  expect(recallGoal(absolute)).toBe(1200);
  expect(recallGoal(outside)).toBe(700);
  expect(isStarred(outside)).toBe(false);
  expect(recallPosition(outside)).toBeNull();
});

it('preserves explicit canonical goals and the most recent reading position when old aliases coexist', async () => {
  rememberGoal(relative, 1200); rememberGoal(absolute, 700);
  rememberPosition(relative, { blockId: 'older' }, { now: 10 });
  rememberPosition(absolute, { blockId: 'newer' }, { now: 20 });
  await Doc.fromPath(absolute);
  expect(recallGoal(absolute)).toBe(1200);
  expect(recallPosition(relative)).toMatchObject({ blockId: 'newer', at: 20 });
  expect(recallPosition(absolute)).toEqual(recallPosition(relative));
});

it('does not block document opening when the folder identity cannot be read', async () => {
  puter.fs.stat.mockRejectedValue(new Error('Folder unavailable'));
  remember(relative);
  const doc = await Doc.fromPath(absolute);
  expect(doc.path).toBe(absolute);
  expectState(relative);
  // Without proof of the app root, absolute paths must not borrow relative state.
  expect(recallGoal(absolute)).toBeNull();
  expect(isStarred(absolute)).toBe(false);
});

it('reuses a verified folder lookup while refreshing each opened file’s conflict metadata', async () => {
  const folderLookups = () => puter.fs.stat.mock.calls.filter(([path]) => path === P.FOLDER);
  await Promise.all([Doc.fromPath(absolute), Doc.fromPath(`${root}/Other.docx`)]);
  expect(folderLookups()).toHaveLength(1);
  await Doc.fromPath(relative);
  expect(folderLookups()).toHaveLength(1);
  expect(puter.fs.stat.mock.calls.filter(([path]) => path !== P.FOLDER))
    .toEqual([[absolute], [`${root}/Other.docx`], [relative]]);
});
