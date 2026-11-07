import { describe, it, expect, vi } from 'vitest';
import {
  createWedgeReader, findBySku, looksLikeBarcode, cameraScanSupported,
  WEDGE_MAX_GAP_MS, WEDGE_MIN_LENGTH,
} from '../src/lib/scan.js';

/** A keydown-shaped object; `at` stands in for event.timeStamp. */
const key = (k, at, mods = {}) => ({ key: k, timeStamp: at, ...mods });

/** Feed a string one character per `gap` ms, then a terminator. */
function type(reader, text, gap, { start = 1000, end = 'Enter' } = {}) {
  let t = start;
  for (const ch of text) {
    reader.handle(key(ch, t), t);
    t += gap;
  }
  return reader.handle(key(end, t), t);
}

describe('createWedgeReader', () => {
  it('recognizes a fast burst terminated by Enter', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    expect(type(reader, '9780306406157', 8)).toBe(true);
    expect(onScan).toHaveBeenCalledWith('9780306406157');
  });

  it('accepts Tab as a terminator too (some scanners send it)', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    expect(type(reader, 'BEAN-HB1', 10, { end: 'Tab' })).toBe(true);
    expect(onScan).toHaveBeenCalledWith('BEAN-HB1');
  });

  it('ignores human typing speed', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    expect(type(reader, '12345678', 120)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores a bare Enter and bursts that are too short', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    expect(reader.handle(key('Enter', 1000), 1000)).toBe(false);
    expect(type(reader, 'ab', 5)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('keeps the burst alive across Shift and other modifier keydowns', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    let t = 500;
    for (const k of ['Shift', 'A', 'Shift', 'B', '1', '2', '3']) {
      reader.handle(key(k, t), t);
      t += 6;
    }
    expect(reader.handle(key('Enter', t), t)).toBe(true);
    expect(onScan).toHaveBeenCalledWith('AB123');
  });

  it('drops the burst on a keyboard shortcut', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    let t = 0;
    for (const ch of '4915') { reader.handle(key(ch, t), t); t += 5; }
    reader.handle(key('a', t, { metaKey: true }), t);
    t += 5;
    expect(reader.handle(key('Enter', t), t)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('starts a new code when a slow gap interrupts', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    reader.handle(key('1', 0), 0);
    reader.handle(key('2', 5), 5);
    // A long pause: what follows is a fresh burst, not a continuation.
    reader.handle(key('7', 900), 900);
    reader.handle(key('8', 905), 905);
    reader.handle(key('9', 910), 910);
    reader.handle(key('0', 915), 915);
    reader.handle(key('Enter', 920), 920);
    expect(onScan).toHaveBeenCalledWith('7890');
  });

  it('reset() abandons a partial code', () => {
    const onScan = vi.fn();
    const reader = createWedgeReader({ onScan });
    reader.handle(key('1', 0), 0);
    reader.handle(key('2', 5), 5);
    reader.handle(key('3', 10), 10);
    reader.handle(key('4', 15), 15);
    reader.reset();
    expect(reader.handle(key('Enter', 20), 20)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('scans back to back without leaking state', () => {
    const codes = [];
    const reader = createWedgeReader({ onScan: (c) => codes.push(c) });
    type(reader, '1111111', 6, { start: 0 });
    type(reader, '2222222', 6, { start: 5000 });
    expect(codes).toEqual(['1111111', '2222222']);
  });

  it('publishes its thresholds', () => {
    expect(WEDGE_MAX_GAP_MS).toBeLessThanOrEqual(50);
    expect(WEDGE_MIN_LENGTH).toBeGreaterThanOrEqual(3);
  });
});

describe('findBySku', () => {
  const products = [
    { id: 'a', sku: 'BEAN-HB' },
    { id: 'b', sku: ' bean-hb ' },
    { id: 'c', sku: '' },
    { id: 'd' },
    { id: 'e', sku: '9780306406157' },
  ];

  it('matches exactly, ignoring case and padding', () => {
    expect(findBySku(products, 'bean-HB').map((p) => p.id)).toEqual(['a', 'b']);
    expect(findBySku(products, '9780306406157').map((p) => p.id)).toEqual(['e']);
  });

  it('never matches on an empty or partial code', () => {
    expect(findBySku(products, '')).toEqual([]);
    expect(findBySku(products, '   ')).toEqual([]);
    expect(findBySku(products, 'BEAN')).toEqual([]);
    expect(findBySku(products, null)).toEqual([]);
    expect(findBySku(undefined, 'x')).toEqual([]);
  });
});

describe('looksLikeBarcode', () => {
  it('accepts scanned-looking codes', () => {
    expect(looksLikeBarcode('9780306406157')).toBe(true);
    expect(looksLikeBarcode('012345678905')).toBe(true);
    expect(looksLikeBarcode('AB-12345')).toBe(true);
  });

  it('rejects words and half-typed searches', () => {
    for (const s of ['coffee', 'lat', 'flat white', 'BEAN-HB', '', '  ', '12345']) {
      expect(looksLikeBarcode(s)).toBe(false);
    }
  });
});

describe('cameraScanSupported', () => {
  it('is false without BarcodeDetector', () => {
    expect(cameraScanSupported()).toBe(false);
  });
});
