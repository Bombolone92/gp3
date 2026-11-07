/**
 * The export folder's name, checked by the lead in review pass 17.
 */
import { describe, it, expect } from 'vitest';
import { exportStamp } from '../src/lib/archive.js';

describe('the date and time in an export folder\'s name', () => {
  it('is the exporter\'s own, not UTC', () => {
    // 03:59 UTC on the 7th: nine in the evening of the 6th in California,
    // where the folder used to be named for the 7th.
    const at = Date.UTC(2026, 8, 7, 3, 59);
    const d = new Date(at);
    const p = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
    expect(exportStamp(at)).toBe(local);
    // Where the machine's clock is not UTC, the two spellings differ, and the local one is the folder's.
    if (d.getTimezoneOffset() !== 0) expect(exportStamp(at)).not.toBe('2026-09-07 03.59');
    else expect(exportStamp(at)).toBe('2026-09-07 03.59');
  });

  it('pads every part, so folders sort by name', () => {
    const d = new Date(2026, 0, 5, 7, 3); // local time
    expect(exportStamp(d.getTime())).toBe('2026-01-05 07.03');
  });
});
