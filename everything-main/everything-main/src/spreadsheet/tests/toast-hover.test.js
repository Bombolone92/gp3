// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from '../src/ui/toast.js';

// The toast root is created once at import; clear the toasts, not the body.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.querySelectorAll('.toast').forEach((n) => n.remove()); });

// Brushing the pointer over a toast used to re-arm a 1.5 s countdown whatever
// time it still had, so a 6 s "Undo" toast could vanish after 2 s.
it('resumes the remaining time after the pointer leaves, never less than a moment to read', () => {
  toast('Deleted 3 rows', { icon: 'trash', action: { label: 'Undo', onClick() {} } });
  const node = document.querySelector('.toast');
  expect(node).toBeTruthy();
  vi.advanceTimersByTime(500);
  node.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(100);
  node.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(2000); // 2.6 s in: the old code had already dismissed it
  expect(node.classList.contains('leaving')).toBe(false);
  vi.advanceTimersByTime(3500); // just past the original 6 s
  expect(node.classList.contains('leaving')).toBe(true);
});

it('gives a toast hovered near its end another moment before it goes', () => {
  toast('Saved');
  const node = document.querySelector('.toast');
  vi.advanceTimersByTime(2500);
  node.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(3000);
  expect(node.classList.contains('leaving')).toBe(false); // held while hovered
  node.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(1400);
  expect(node.classList.contains('leaving')).toBe(false);
  vi.advanceTimersByTime(200);
  expect(node.classList.contains('leaving')).toBe(true);
});
