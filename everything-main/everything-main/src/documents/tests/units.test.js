import { describe, it, expect, beforeEach } from 'vitest';
import { UNITS, defaultUnit, isUnit, recallUnit, rememberUnit, onUnitChange, unitLabel, applyUnit } from '../src/lib/units.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

describe('measurement units', () => {
  beforeEach(() => store.clear());

  it('reads a bare "en" as the US, as the date field does', () => {
    expect(defaultUnit('en')).toBe('in');
    expect(defaultUnit('en-GB')).toBe('cm');
  });

  it('defaults to inches only where inches are the rule', () => {
    expect(defaultUnit('en-US')).toBe('in');
    expect(defaultUnit('en-GB')).toBe('cm');
    expect(defaultUnit('de-DE')).toBe('cm');
    expect(defaultUnit('')).toBe('cm');
    expect(UNITS.map((u) => u.id)).toEqual(['in', 'cm']);
    expect(isUnit('cm')).toBe(true);
    expect(isUnit('mm')).toBe(false);
    expect(unitLabel('cm')).toBe('Centimeters');
    expect(unitLabel('nope')).toBe('Inches');
  });

  it('remembers the choice and tells listeners', () => {
    expect(recallUnit('en-US')).toBe('in');
    const seen = [];
    const off = onUnitChange((u) => seen.push(u));
    expect(rememberUnit('cm')).toBe(true);
    expect(rememberUnit('furlongs')).toBe(false);
    expect(seen).toEqual(['cm']);
    expect(recallUnit('en-US')).toBe('cm');
    off();
    rememberUnit('in');
    expect(seen).toEqual(['cm']);
    store.set('documents:unit', 'bogus');
    expect(recallUnit('fr-FR')).toBe('cm');
  });

  it('applies to the engine only when the unit differs', () => {
    const calls = [];
    const controller = { getMeasurementUnit: () => 'in', setMeasurementUnit: (u) => calls.push(u) };
    expect(applyUnit(controller, 'in')).toBe(false);
    expect(applyUnit(controller, 'cm')).toBe(true);
    expect(calls).toEqual(['cm']);
    expect(applyUnit(null, 'cm')).toBe(false);
    expect(applyUnit(controller, 'mm')).toBe(false);
  });
});
