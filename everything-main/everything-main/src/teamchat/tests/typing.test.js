/**
 * The typing throttle: however fast someone types, at most one "typing"
 * write per window, and one "stopped" when they go quiet or send.
 */
import { describe, it, expect, vi } from 'vitest';
import { typingSignal, typingText } from '../src/lib/typing.js';

describe('typingSignal', () => {
  it('sends once per window no matter how many keystrokes, and stops once', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stop = vi.fn();
    const t = typingSignal({ send, stop, windowMs: 4000 });
    for (let i = 0; i < 50; i++) {
      t.typed();
      vi.advanceTimersByTime(50);
    }
    expect(send).toHaveBeenCalledTimes(1); // 2.5s of typing
    vi.advanceTimersByTime(1600);
    t.typed(); // 4.15s after the first send
    expect(send).toHaveBeenCalledTimes(2);
    t.stopped();
    t.stopped();
    expect(stop).toHaveBeenCalledTimes(1);
    // Nothing active: stopping again is free.
    t.stopped();
    expect(stop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('marks only the write that starts a burst as first', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stop = vi.fn();
    const t = typingSignal({ send, stop, windowMs: 4000 });
    t.typed();
    expect(send).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(4100);
    t.typed(); // still the same burst: active was never cleared
    expect(send).toHaveBeenLastCalledWith(false);
    t.stopped();
    t.typed(); // a fresh burst after stopping
    expect(send).toHaveBeenLastCalledWith(true);
    vi.useRealTimers();
  });

  it('reports stopped by itself when typing goes quiet', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stop = vi.fn();
    const t = typingSignal({ send, stop, windowMs: 4000 });
    t.typed();
    vi.advanceTimersByTime(4900);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(t.isActive()).toBe(false);
    // Typing again after a stop sends again straight away.
    t.typed();
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('words the line for one, two, or many', () => {
    expect(typingText([])).toBe('');
    expect(typingText(['Ana'])).toBe('Ana is typing');
    expect(typingText(['Ana', 'Ben'])).toBe('Ana and Ben are typing');
    expect(typingText(['Ana', 'Ben', 'Cy'])).toBe('Several people are typing');
  });
});
