import { describe, expect, it } from 'vitest';
import { createTimer, formatDuration } from '../src/game/timer.js';

/** A clock the test drives, which is why the timer takes `now` as an input. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

describe('createTimer', () => {
  it('starts stopped at zero', () => {
    const timer = createTimer({ now: fakeClock().now });
    expect(timer.elapsedMs).toBe(0);
    expect(timer.running).toBe(false);
  });

  it('accumulates while running', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(5000);
    expect(timer.elapsedMs).toBe(5000);
    expect(timer.running).toBe(true);
  });

  it('banks the time on pause and stops counting', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(5000);
    timer.pause();
    clock.advance(60_000);
    expect(timer.elapsedMs).toBe(5000);
    expect(timer.running).toBe(false);
  });

  it('resumes from where it paused', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(5000);
    timer.pause();
    clock.advance(60_000);
    timer.start();
    clock.advance(2000);
    expect(timer.elapsedMs).toBe(7000);
  });

  it('ignores a second start while already running', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(1000);
    timer.start();
    clock.advance(1000);
    expect(timer.elapsedMs).toBe(2000);
  });

  it('ignores a pause when already paused', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(1000);
    timer.pause();
    timer.pause();
    expect(timer.elapsedMs).toBe(1000);
  });

  it('resumes a saved game from its stored time', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now, elapsedMs: 42_000 }).start();
    clock.advance(1000);
    expect(timer.elapsedMs).toBe(43_000);
  });

  it('treats a negative stored time as zero', () => {
    expect(createTimer({ now: fakeClock().now, elapsedMs: -500 }).elapsedMs).toBe(0);
  });

  it('resets to zero, or to a given time', () => {
    const clock = fakeClock();
    const timer = createTimer({ now: clock.now }).start();
    clock.advance(9000);
    timer.reset();
    expect(timer.elapsedMs).toBe(0);
    expect(timer.running).toBe(false);
    timer.reset(1234);
    expect(timer.elapsedMs).toBe(1234);
  });

  it('never goes backwards if the clock does', () => {
    // Wall clocks are adjusted by NTP and by the user. A timer that reports a
    // shrinking duration is worse than one that briefly stalls.
    let now = 1000;
    const timer = createTimer({ now: () => now }).start();
    now = 500;
    expect(timer.elapsedMs).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(59_000)).toBe('0:59');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(605_000)).toBe('10:05');
  });

  it('adds hours only once they are needed', () => {
    expect(formatDuration(3_599_000)).toBe('59:59');
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('truncates part-seconds rather than rounding up', () => {
    // A clock that shows 0:01 before a second has passed is lying.
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1999)).toBe('0:01');
  });

  it('shows zero for nonsense input rather than NaN', () => {
    expect(formatDuration(-1000)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration('abc')).toBe('0:00');
  });
});
