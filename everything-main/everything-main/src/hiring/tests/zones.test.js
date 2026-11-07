import { describe, it, expect } from 'vitest';
import {
  browserTimeZone,
  formatTimeInZone,
  isValidTimeZone,
  knownTimeZones,
  normalizeTimeZone,
  zoneAbbreviation,
  zonedInstant,
  zoneLabel,
  zoneOffsetAt,
} from '../src/lib/zones.js';

describe('zone validation', () => {
  it('accepts IANA ids and rejects everything else', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it('normalizes to a storable id, or to "the reader’s clock"', () => {
    expect(normalizeTimeZone(' Europe/Berlin ')).toBe('Europe/Berlin');
    expect(normalizeTimeZone('nonsense')).toBe('');
    expect(normalizeTimeZone(undefined)).toBe('');
  });

  it('knows this browser’s own zone and can list the rest', () => {
    expect(isValidTimeZone(browserTimeZone())).toBe(true);
    const zones = knownTimeZones();
    expect(zones.length).toBeGreaterThan(10);
    expect(zones).toContain('Europe/Berlin');
  });
});

describe('zoneOffsetAt', () => {
  it('reports the offset in force, DST included', () => {
    expect(zoneOffsetAt('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(zoneOffsetAt('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(120);
    expect(zoneOffsetAt('America/Los_Angeles', new Date('2026-01-15T12:00:00Z'))).toBe(-480);
    expect(zoneOffsetAt('America/Los_Angeles', new Date('2026-07-15T12:00:00Z'))).toBe(-420);
    // Half-hour zones, and one that crosses the date line into yesterday.
    expect(zoneOffsetAt('Asia/Kolkata', new Date('2026-07-15T12:00:00Z'))).toBe(330);
    expect(zoneOffsetAt('Pacific/Honolulu', new Date('2026-07-15T02:00:00Z'))).toBe(-600);
    expect(zoneOffsetAt('UTC', new Date('2026-07-15T12:00:00Z'))).toBe(0);
  });
});

describe('zonedInstant', () => {
  it('turns a wall time in a zone into the moment it happens', () => {
    expect(zonedInstant('2026-03-10', '14:00', 'Europe/Berlin').toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(zonedInstant('2026-07-10', '14:00', 'Europe/Berlin').toISOString()).toBe('2026-07-10T12:00:00.000Z');
    expect(zonedInstant('2026-03-10', '06:00', 'America/Los_Angeles').toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(zonedInstant('2026-03-10', '09:30', 'Asia/Kolkata').toISOString()).toBe('2026-03-10T04:00:00.000Z');
  });

  it('resolves a wall time on the day the clocks change', () => {
    // Berlin springs forward at 02:00 on 2026-03-29; 03:00 exists, 01:00
    // is still winter time.
    expect(zonedInstant('2026-03-29', '01:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedInstant('2026-03-29', '03:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // 02:30 does not exist; it must still resolve to a real instant.
    expect(Number.isNaN(zonedInstant('2026-03-29', '02:30', 'Europe/Berlin').getTime())).toBe(false);
  });

  it('reads the local clock when no zone is given', () => {
    const local = zonedInstant('2026-03-10', '14:00', '');
    expect(local.getHours()).toBe(14);
    expect(zonedInstant('2026-03-10', '14:00', 'Mars/Olympus').getTime()).toBe(local.getTime());
  });

  it('returns null for a date or time it cannot use', () => {
    expect(zonedInstant('', '14:00', 'UTC')).toBeNull();
    expect(zonedInstant('2026-3-10', '14:00', 'UTC')).toBeNull();
    expect(zonedInstant('2026-03-10', 'noon', 'UTC')).toBeNull();
  });
});

describe('naming a zone', () => {
  it('abbreviates the zone as it stands at that moment', () => {
    expect(zoneAbbreviation('America/Los_Angeles', new Date('2026-01-15T12:00:00Z'))).toBe('PST');
    expect(zoneAbbreviation('America/Los_Angeles', new Date('2026-07-15T12:00:00Z'))).toBe('PDT');
    expect(zoneAbbreviation('nonsense')).toBe('');
    expect(zoneAbbreviation('')).toBe('');
  });

  it('reads an instant on another clock', () => {
    const instant = new Date('2026-03-10T13:00:00Z');
    expect(formatTimeInZone(instant, 'UTC')).toMatch(/1[:.]00/);
    expect(formatTimeInZone(new Date('nope'), 'UTC')).toBe('');
  });

  it('labels a zone by its city', () => {
    expect(zoneLabel('America/Los_Angeles')).toBe('Los Angeles · America');
    expect(zoneLabel('UTC')).toBe('UTC');
    expect(zoneLabel('')).toBe('');
  });
});
