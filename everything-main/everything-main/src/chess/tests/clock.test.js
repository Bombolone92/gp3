import { describe, it, expect } from 'vitest';
import {
  Clock,
  DEFAULT_TIME_ID,
  LOW_TIME_MS,
  TIME_CONTROLS,
  formatClock,
  isTimeId,
  speakClock,
  timeControl,
} from '../src/game/clock.js';

/** A clock driven by a hand-cranked stopwatch rather than the wall. */
function stopwatch(control) {
  const state = { t: 0 };
  const clock = new Clock(control, () => state.t);
  return { clock, advance: (ms) => (state.t += ms) };
}

const BLITZ = { initial: 300000, increment: 3000 };

describe('time controls', () => {
  it('has unique ids and a valid default', () => {
    const ids = TIME_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isTimeId(DEFAULT_TIME_ID)).toBe(true);
  });

  it('resolves known controls and rejects everything else', () => {
    expect(timeControl('5+3')).toMatchObject({ initial: 300000, increment: 3000 });
    expect(timeControl('nonsense')).toBe(null);
    expect(isTimeId('nonsense')).toBe(false);
  });

  it('treats "no limit" as no clock at all', () => {
    // It is a real menu entry, but it never produces a running clock.
    expect(isTimeId('unlimited')).toBe(true);
    expect(timeControl('unlimited')).toBe(null);
  });
});

describe('a disabled clock', () => {
  it('never runs out and never charges anyone', () => {
    const { clock, advance } = stopwatch(null);
    expect(clock.enabled).toBe(false);
    clock.setRunning('w');
    advance(60 * 60 * 1000);
    expect(clock.running).toBe(null);
    expect(clock.remaining('w')).toBe(Infinity);
    expect(clock.flagged()).toBe(null);
  });
});

describe('charging time', () => {
  it('only charges the side that is running', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(4000);
    expect(clock.remaining('w')).toBe(296000);
    expect(clock.remaining('b')).toBe(300000);
  });

  it('keeps the charge when the clock changes hands', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(4000);
    clock.setRunning('b');
    advance(10000);
    expect(clock.remaining('w')).toBe(296000);
    expect(clock.remaining('b')).toBe(290000);
  });

  it('re-asserting the running side charges nothing extra', () => {
    // renderAll re-asserts the clock on every pass, so this has to be free.
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(4000);
    clock.setRunning('w');
    clock.setRunning('w');
    advance(1000);
    expect(clock.remaining('w')).toBe(295000);
  });

  it('never charges below zero', () => {
    const { clock, advance } = stopwatch({ initial: 1000, increment: 0 });
    clock.setRunning('w');
    advance(50000);
    expect(clock.remaining('w')).toBe(0);
    clock.setRunning('b');
    expect(clock.remaining('w')).toBe(0);
  });

  it('adds the increment on top of the settled time', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(4000);
    clock.setRunning(null);
    clock.addIncrement('w');
    expect(clock.remaining('w')).toBe(299000);
  });
});

describe('flag fall', () => {
  it('reports the running side once its time is gone', () => {
    const { clock, advance } = stopwatch({ initial: 2000, increment: 0 });
    clock.setRunning('b');
    advance(1999);
    expect(clock.flagged()).toBe(null);
    advance(1);
    expect(clock.flagged()).toBe('b');
  });

  it('cannot flag a side that is not on the move', () => {
    // Only a running clock can run out: a peer reporting itself at zero as it
    // moves must not read as a loss on the receiving side.
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(400000);
    clock.setRunning('b');
    expect(clock.remaining('w')).toBe(0);
    expect(clock.remaining('b')).toBe(300000);
    expect(clock.flagged()).toBe(null);
  });

  it('cannot flag while the clock is stopped', () => {
    const { clock, advance } = stopwatch({ initial: 1000, increment: 0 });
    clock.setRunning('w');
    advance(5000);
    clock.setRunning(null);
    expect(clock.flagged()).toBe(null);
  });
});

describe('baseline and snapshot', () => {
  it('baseline is the start of the turn; snapshot is the moment', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(7000);
    expect(clock.baseline()).toEqual({ w: 300000, b: 300000 });
    expect(clock.snapshot()).toEqual({ w: 293000, b: 300000 });
  });

  it('restores a stored reading without back-charging the wait', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    advance(50000);
    clock.restore({ w: 120000, b: 90000 });
    expect(clock.remaining('w')).toBe(120000);
    advance(5000);
    expect(clock.remaining('w')).toBe(115000);
    expect(clock.remaining('b')).toBe(90000);
  });

  it('undo can rewind to the baseline of the move before', () => {
    const { clock, advance } = stopwatch(BLITZ);
    clock.setRunning('w');
    const before = clock.baseline();
    advance(9000);
    clock.setRunning(null);
    clock.addIncrement('w');
    expect(clock.remaining('w')).toBe(294000);
    clock.restore(before);
    expect(clock.snapshot()).toEqual({ w: 300000, b: 300000 });
  });
});

describe('formatClock', () => {
  it('shows minutes and seconds above the low-time mark', () => {
    expect(formatClock(300000)).toBe('5:00');
    expect(formatClock(60000)).toBe('1:00');
    expect(formatClock(LOW_TIME_MS)).toBe('0:20');
    expect(formatClock(59900)).toBe('0:59');
  });

  it('shows tenths once the time is low', () => {
    expect(formatClock(LOW_TIME_MS - 1)).toBe('0:19.9');
    expect(formatClock(9400)).toBe('0:09.4');
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(-500)).toBe('0:00.0');
  });

  it('shows hours when there are any', () => {
    expect(formatClock(3599000)).toBe('59:59');
    expect(formatClock(3600000)).toBe('1:00:00');
    expect(formatClock(3725000)).toBe('1:02:05');
  });
});

describe('speakClock', () => {
  it('reads a clock out in words', () => {
    expect(speakClock(300000)).toBe('5 minutes');
    expect(speakClock(61000)).toBe('1 minute 1 second');
    expect(speakClock(9400)).toBe('9 seconds');
    expect(speakClock(0)).toBe('0 seconds');
  });
});
