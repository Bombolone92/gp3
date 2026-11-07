// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let toast;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules();
  ({ toast } = await import('../src/ui/toast.js'));
});
afterEach(() => {
  document.body.replaceChildren(); vi.clearAllTimers(); vi.useRealTimers();
});

it('preserves a long-running action notice after the pointer leaves', () => {
  toast('Reading the document aloud', { duration: 3600000, action: { label: 'Stop', onClick: vi.fn() } });
  const notice = document.querySelector('.toast');
  vi.advanceTimersByTime(1000);
  notice.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(5000);
  notice.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(2000);
  expect(notice.isConnected).toBe(true);
  expect(notice.classList.contains('leaving')).toBe(false);
  vi.advanceTimersByTime(3597000);
  expect(notice.classList.contains('leaving')).toBe(true);
});

it('stays visible while the action has focus even after the pointer leaves', () => {
  toast('Saved', { action: { label: 'Open', onClick: vi.fn() } });
  const notice = document.querySelector('.toast');
  notice.dispatchEvent(new Event('pointerenter'));
  notice.querySelector('button').focus();
  notice.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(10000);
  expect(notice.isConnected).toBe(true);
  expect(document.activeElement).toBe(notice.querySelector('button'));
});

it('stays visible under the pointer after keyboard focus leaves', () => {
  toast('Saved', { action: { label: 'Open', onClick: vi.fn() } });
  const notice = document.querySelector('.toast');
  const outside = document.createElement('button'); document.body.append(outside);
  notice.querySelector('button').focus();
  notice.dispatchEvent(new Event('pointerenter'));
  outside.focus();
  vi.advanceTimersByTime(10000);
  expect(notice.isConnected).toBe(true);
});

it('gives a nearly expired notice time to be read after interaction', () => {
  toast('Saved', { duration: 2600 });
  const notice = document.querySelector('.toast');
  vi.advanceTimersByTime(2500);
  notice.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(5000);
  notice.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(1499);
  expect(notice.classList.contains('leaving')).toBe(false);
  vi.advanceTimersByTime(1);
  expect(notice.classList.contains('leaving')).toBe(true);
});

it('expires normally and allows explicit dismissal while held', () => {
  toast('Saved');
  const first = document.querySelector('.toast');
  vi.advanceTimersByTime(2600);
  expect(first.classList.contains('leaving')).toBe(true);
  vi.advanceTimersByTime(400);
  expect(first.isConnected).toBe(false);
  const handle = toast('Reading', { duration: 3600000 });
  const second = document.querySelector('.toast');
  second.dispatchEvent(new Event('pointerenter'));
  handle.dismiss();
  vi.advanceTimersByTime(400);
  expect(second.isConnected).toBe(false);
});

it('keeps a notice of work in progress until it is dismissed, and lets its words change', () => {
  const t = toast('Sorting…', { icon: 'sort', duration: Infinity, action: { label: 'Stop', onClick: () => {} } });
  vi.advanceTimersByTime(60000);
  const node = document.querySelector('.toast');
  expect(node).not.toBeNull();
  t.update('Sorting… 50%');
  expect(node.querySelector('span').textContent).toBe('Sorting… 50%');
  // Reading it (hover) and leaving it does not start a clock either.
  node.dispatchEvent(new Event('pointerenter'));
  node.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(60000);
  expect(document.querySelector('.toast')).not.toBeNull();
  t.dismiss();
  vi.advanceTimersByTime(500);
  expect(document.querySelector('.toast')).toBeNull();
});
