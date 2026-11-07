// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../src/ui/toast.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.querySelectorAll('.toast').forEach((n) => n.remove()); });

const leaving = (node) => node.classList.contains('leaving');
const show = (message, options) => { toast(message, options); return [...document.querySelectorAll('.toast')].at(-1); };

// Every toast without its own duration stayed 2.6 s, whether it said "Saved" or seventy characters
// about a paste that could not be placed; the long ones went before they could be read.
describe('the default toast duration', () => {
  it('keeps a short message the 2.6 s it always had', () => {
    const node = show('Saved');
    vi.advanceTimersByTime(2599);
    expect(leaving(node)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(leaving(node)).toBe(true);
  });

  it('grows with the length of the message', () => {
    const message = 'The sheet or selection changed. Paste again where you want the data to go'; // 74 characters
    const node = show(message);
    vi.advanceTimersByTime(2700);
    expect(leaving(node)).toBe(false);
    vi.advanceTimersByTime(1200 + 45 * message.length - 2700 - 1);
    expect(leaving(node)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(leaving(node)).toBe(true);
  });

  it('stops growing at 7 s', () => {
    const node = show('x'.repeat(200));
    vi.advanceTimersByTime(6999);
    expect(leaving(node)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(leaving(node)).toBe(true);
  });

  it('keeps a toast with an action at least the 6 s it had', () => {
    const node = show('Deleted 3 rows', { action: { label: 'Undo', onClick() {} } });
    vi.advanceTimersByTime(5999);
    expect(leaving(node)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(leaving(node)).toBe(true);
  });

  it('gives way to a duration the caller sets', () => {
    const node = show('x'.repeat(200), { duration: 1000 });
    vi.advanceTimersByTime(1001);
    expect(leaving(node)).toBe(true);
  });
});
