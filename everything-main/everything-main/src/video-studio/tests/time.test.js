import { describe, it, expect } from 'vitest';
import { timecode, parseTimecode, snapToFrame, rulerLabel, US } from '../src/lib/time.js';

describe('time helpers', () => {
  it('formats timecodes with frames', () => {
    expect(timecode(0, 30)).toBe('00:00:00:00');
    expect(timecode(US + US / 2, 30)).toBe('00:00:01:15');
    expect(timecode(3661 * US, 25)).toBe('01:01:01:00');
  });

  it('parses timecodes and plain seconds', () => {
    expect(parseTimecode('00:00:01:15', 30)).toBe(1_500_000);
    expect(parseTimecode('1:30')).toBe(90 * US);
    expect(parseTimecode('2.5')).toBe(2_500_000);
    expect(parseTimecode('abc')).toBe(null);
  });

  it('snaps to frame boundaries', () => {
    expect(snapToFrame(1_010_000, 30)).toBe(1_000_000);
    expect(snapToFrame(1_020_000, 30)).toBe(1_033_333);
  });

  it('labels a frame tick that lands just under a whole second as that second', () => {
    // At 30 fps the ruler steps by Math.round(US / 30) = 33_333, so frame 30 sits at 999_990.
    expect(rulerLabel(30 * 33_333, 30, true)).toBe('00:01');
    expect(rulerLabel(60 * 33_333, 30, true)).toBe('00:02');
    expect(rulerLabel(29 * 33_333, 30, true)).toBe('29f');
    expect(rulerLabel(31 * 33_333, 30, true)).toBe('1f');
  });
});
