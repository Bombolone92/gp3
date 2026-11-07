import { describe, it, expect } from 'vitest';
import { rememberZoom, recallZoom } from '../src/lib/viewprefs.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('remembered zoom', () => {
  it('keeps a fit mode or a manual level', () => {
    const storage = memory();
    expect(recallZoom({ storage })).toBeNull();
    rememberZoom({ value: 125.4 }, { storage });
    expect(recallZoom({ storage })).toEqual({ value: 125 });
    rememberZoom({ fit: 'page' }, { storage });
    expect(recallZoom({ storage })).toEqual({ fit: 'page' });
    rememberZoom({}, { storage });
    expect(recallZoom({ storage })).toBeNull();
  });

  it('drops values out of range and broken storage', () => {
    const storage = memory();
    rememberZoom({ value: 900 }, { storage });
    expect(recallZoom({ storage })).toBeNull();
    storage.setItem('documents:zoom', '{bad');
    expect(recallZoom({ storage })).toBeNull();
    storage.setItem('documents:zoom', '{"fit":"diagonal"}');
    expect(recallZoom({ storage })).toBeNull();
  });
});
