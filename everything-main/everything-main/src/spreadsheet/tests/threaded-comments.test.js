import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import {
  addComment, replyToThread, editThreadItem, deleteThreadItem, setThreadResolved, getThread, adjacentThread,
  deleteThreadsWhere, legacyCommentText, authorInitials, normalizeThread, copyThreads, pasteThreads,
} from '../src/core/comments.js';

const NOW = new Date('2026-10-09T10:00:00Z');
const texts = (t) => t?.items.map((i) => i.text) ?? null;
const at = (wb, id, r, c) => texts(getThread(wb, id, r, c));

function book() {
  const wb = new Workbook();
  return { wb, id: wb.activeSheetId };
}

describe('threaded comment model', () => {
  it('starts a thread, replies, edits, resolves and deletes, each one undo step', () => {
    const { wb, id } = book();
    expect(addComment(wb, id, 1, 1, 'Check this total', 'Ada Lovelace', NOW)).toBe(true);
    const t = getThread(wb, id, 1, 1);
    expect(t.items[0]).toMatchObject({ author: 'Ada Lovelace', text: 'Check this total', time: '2026-10-09T10:00:00.000Z' });
    expect(t.items[0].id).toMatch(/^\{[0-9A-F-]{36}\}$/);
    expect(wb.undoLabel()).toBe('New comment');
    replyToThread(wb, id, 1, 1, '@Ada done', 'Grace');
    expect(at(wb, id, 1, 1)).toEqual(['Check this total', '@Ada done']);
    const reply = getThread(wb, id, 1, 1).items[1];
    editThreadItem(wb, id, 1, 1, reply.id, '@Ada fixed now');
    expect(at(wb, id, 1, 1)).toEqual(['Check this total', '@Ada fixed now']);
    setThreadResolved(wb, id, 1, 1, true);
    expect(getThread(wb, id, 1, 1).done).toBe(true);
    // A reply reopens a resolved thread.
    replyToThread(wb, id, 1, 1, 'one more thing', 'Ada Lovelace');
    expect(getThread(wb, id, 1, 1).done).toBe(false);
    deleteThreadItem(wb, id, 1, 1, reply.id);
    expect(at(wb, id, 1, 1)).toEqual(['Check this total', 'one more thing']);
    wb.undo();
    expect(at(wb, id, 1, 1)).toEqual(['Check this total', '@Ada fixed now', 'one more thing']);
    wb.redo();
    // Deleting the first comment deletes the thread.
    deleteThreadItem(wb, id, 1, 1, getThread(wb, id, 1, 1).items[0].id);
    expect(getThread(wb, id, 1, 1)).toBeNull();
    wb.undo();
    expect(at(wb, id, 1, 1)).toEqual(['Check this total', 'one more thing']);
  });

  it('refuses empty text and adds a reply when New Comment meets a thread', () => {
    const { wb, id } = book();
    expect(addComment(wb, id, 0, 0, '   ', 'A')).toBe(false);
    expect(getThread(wb, id, 0, 0)).toBeNull();
    addComment(wb, id, 0, 0, 'first', 'A');
    addComment(wb, id, 0, 0, 'second', 'B');
    expect(at(wb, id, 0, 0)).toEqual(['first', 'second']);
  });

  it('a protected sheet refuses a comment', () => {
    const { wb, id } = book();
    wb.setSheetProtected(id, true);
    expect(wb.isProtected(id)).toBe(true);
    expect(addComment(wb, id, 0, 0, 'no', 'A')).toBe(false);
  });

  it('walks threads row by row, wrapping round', () => {
    const { wb, id } = book();
    addComment(wb, id, 5, 0, 'a', 'A');
    addComment(wb, id, 1, 3, 'b', 'A');
    addComment(wb, id, 1, 1, 'c', 'A');
    expect(adjacentThread(wb, id, 0, 0, 1)).toEqual({ r: 1, c: 1 });
    expect(adjacentThread(wb, id, 1, 1, 1)).toEqual({ r: 1, c: 3 });
    expect(adjacentThread(wb, id, 5, 0, 1)).toEqual({ r: 1, c: 1 });
    expect(adjacentThread(wb, id, 1, 1, -1)).toEqual({ r: 5, c: 0 });
  });

  it('survives toJSON and load, and a duplicated sheet gets fresh ids', () => {
    const { wb, id } = book();
    addComment(wb, id, 2, 2, 'kept', 'A', NOW);
    replyToThread(wb, id, 2, 2, 'reply', 'B', NOW);
    setThreadResolved(wb, id, 2, 2, true);
    const copy = new Workbook();
    copy.replaceWith(JSON.parse(JSON.stringify(wb.toJSON())));
    const t = getThread(copy, copy.activeSheetId, 2, 2);
    expect(t).toEqual(getThread(wb, id, 2, 2));
    wb.duplicateSheet(id);
    const dupId = wb.sheets[1].id;
    const d = getThread(wb, dupId, 2, 2);
    expect(texts(d)).toEqual(['kept', 'reply']);
    expect(d.items[0].id).not.toBe(t.items[0].id);
  });

  it('clears threads in a range', () => {
    const { wb, id } = book();
    addComment(wb, id, 0, 0, 'a', 'A');
    addComment(wb, id, 3, 3, 'b', 'A');
    expect(deleteThreadsWhere(wb, id, (r) => r < 2)).toBe(1);
    expect(getThread(wb, id, 0, 0)).toBeNull();
    expect(getThread(wb, id, 3, 3)).not.toBeNull();
  });

  it('normalizes stored threads and writes the legacy note text', () => {
    expect(normalizeThread({ items: [] })).toBeNull();
    const t = normalizeThread({ done: 1, items: [{ text: 'x', author: '', time: 'nope' }, { text: 'y', author: 'B' }] });
    expect(t.done).toBe(false);
    expect(t.items[0]).toMatchObject({ author: 'Unknown', time: null });
    expect(legacyCommentText(t)).toMatch(/^\[Threaded comment\]\n\n[\s\S]*Comment:\n {4}x\nReply:\n {4}y$/);
    expect(authorInitials('Ada King Lovelace')).toBe('AL');
    expect(authorInitials('grace')).toBe('G');
  });
});

describe('threads travel with their cells', () => {
  function seeded() {
    const { wb, id } = book();
    ['c', 'a', 'b'].forEach((v, r) => wb.setInput(id, r, 0, v));
    addComment(wb, id, 0, 0, 'about c', 'A');
    addComment(wb, id, 2, 0, 'about b', 'A');
    wb.clearHistory();
    return { wb, id };
  }

  it('sorts with their rows, in the sort’s undo step', () => {
    const { wb, id } = seeded();
    wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, [{ col: 0, ascending: true }]);
    expect([0, 1, 2].map((r) => at(wb, id, r, 0)?.[0] ?? null)).toEqual([null, 'about b', 'about c']);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect([0, 1, 2].map((r) => at(wb, id, r, 0)?.[0] ?? null)).toEqual(['about c', null, 'about b']);
  });

  it('sorts with their columns', () => {
    const { wb, id } = book();
    ['3', '1', '2'].forEach((v, c) => wb.setInput(id, 0, c, v));
    addComment(wb, id, 0, 0, 'three', 'A');
    wb.sortColumnsBy(id, { r1: 0, c1: 0, r2: 0, c2: 2 }, [{ row: 0, ascending: true }]);
    expect([0, 1, 2].map((c) => at(wb, id, 0, c)?.[0] ?? null)).toEqual([null, null, 'three']);
  });

  it('moves down and back with inserted and deleted rows and columns', () => {
    const { wb, id } = seeded();
    wb.insertRows(id, 1, 2);
    expect(at(wb, id, 0, 0)).toEqual(['about c']);
    expect(at(wb, id, 4, 0)).toEqual(['about b']);
    wb.insertCols(id, 0, 1);
    expect(at(wb, id, 4, 1)).toEqual(['about b']);
    wb.deleteCols(id, 0, 1);
    wb.deleteRows(id, 0, 1);
    expect(at(wb, id, 3, 0)).toEqual(['about b']);
    expect(getThread(wb, id, 0, 0)).toBeNull();
    wb.undo();
    wb.undo();
    wb.undo();
    wb.undo();
    expect(at(wb, id, 0, 0)).toEqual(['about c']);
    expect(at(wb, id, 2, 0)).toEqual(['about b']);
  });

  it('shifts with inserted and deleted cells', () => {
    const { wb, id } = seeded();
    wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down');
    expect(at(wb, id, 1, 0)).toEqual(['about c']);
    wb.deleteCells(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, 'up');
    // The deleted cells' thread goes; the one below moves up by two.
    expect(at(wb, id, 0, 0)).toBeNull();
    expect(at(wb, id, 1, 0)).toEqual(['about b']);
    wb.undo();
    expect(at(wb, id, 1, 0)).toEqual(['about c']);
    expect(at(wb, id, 3, 0)).toEqual(['about b']);
  });

  it('moves with reordered rows', () => {
    const { wb, id } = seeded();
    wb.moveRows(id, 0, 1, 3);
    expect(at(wb, id, 2, 0)).toEqual(['about c']);
    expect(at(wb, id, 1, 0)).toEqual(['about b']);
  });

  it('moves with a dragged block, and the drag undoes in one step', () => {
    const { wb, id } = seeded();
    wb.moveRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, 0, 3);
    expect(at(wb, id, 0, 3)).toEqual(['about c']);
    expect(at(wb, id, 2, 3)).toEqual(['about b']);
    expect(getThread(wb, id, 0, 0)).toBeNull();
    wb.undo();
    expect(at(wb, id, 0, 0)).toEqual(['about c']);
    expect(getThread(wb, id, 0, 3)).toBeNull();
  });

  it('moves with a cut and paste onto another sheet', () => {
    const { wb, id } = seeded();
    const target = wb.addSheet().id;
    const cells = wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
    wb.placeMoved(target, 4, 1, cells, { sheetId: id, range: { r1: 0, c1: 0, r2: 2, c2: 0 } });
    expect(at(wb, target, 4, 1)).toEqual(['about c']);
    expect(at(wb, target, 6, 1)).toEqual(['about b']);
    expect(getThread(wb, id, 0, 0)).toBeNull();
  });

  it('goes with removed duplicate rows and moves up with kept ones', () => {
    const { wb, id } = book();
    ['x', 'x', 'y'].forEach((v, r) => wb.setInput(id, r, 0, v));
    addComment(wb, id, 1, 0, 'dup', 'A');
    addComment(wb, id, 2, 0, 'kept y', 'A');
    wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
    expect(at(wb, id, 1, 0)).toEqual(['kept y']);
    expect(getThread(wb, id, 2, 0)).toBeNull();
  });
});

it('copies threads with their cells, giving the copies ids of their own', () => {
  const { wb, id } = book();
  addComment(wb, id, 0, 0, 'copied', 'A');
  addComment(wb, id, 5, 1, 'replaced', 'B');
  const threads = copyThreads(wb, id, [0, 1], [0, 1]);
  expect(threads.map((row) => row.map((t) => t?.items[0].text ?? null))).toEqual([['copied', null], [null, null]]);
  expect(copyThreads(wb, id, [3], [3])).toBeNull();
  wb.transaction('Paste', () => pasteThreads(wb, id, threads, 4, 1));
  expect(at(wb, id, 4, 1)).toEqual(['copied']);
  expect(getThread(wb, id, 5, 1)).toBeNull();
  expect(getThread(wb, id, 4, 1).items[0].id).not.toBe(getThread(wb, id, 0, 0).items[0].id);
  wb.undo();
  expect(getThread(wb, id, 4, 1)).toBeNull();
  expect(at(wb, id, 5, 1)).toEqual(['replaced']);
});
