import { describe, it, expect } from 'vitest';
import { clientName, initials, formatAddress, routeUrl, matches, formatHours, telHref } from '../src/core/format.js';

describe('format', () => {
  it('names clients by person or company', () => {
    expect(clientName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(clientName({ firstName: 'Ada', company: 'Engines Ltd', useCompanyName: true })).toBe('Engines Ltd');
    expect(clientName({ company: 'Solo Co' })).toBe('Solo Co');
    expect(clientName(null)).toBe('Unknown client');
  });

  it('makes initials from any name', () => {
    expect(initials('Maya Bennett')).toBe('MB');
    expect(initials('Cher')).toBe('CH');
    expect(initials('José María López')).toBe('JL');
    expect(initials('')).toBe('?');
  });

  it('formats addresses on one or several lines', () => {
    const p = { street1: '1 Main St', city: 'Eugene', region: 'OR', postal: '97401', country: 'US' };
    expect(formatAddress(p)).toBe('1 Main St, Eugene, OR 97401, US');
    expect(formatAddress(p, { multiline: true })).toBe('1 Main St\nEugene, OR 97401\nUS');
  });

  it('builds a multi-stop route', () => {
    const a = { street1: '1 A St', city: 'X' };
    const b = { street1: '2 B St', city: 'Y' };
    const c = { street1: '3 C St', city: 'Z' };
    const url = new URL(routeUrl([a, b, c], 'Shop, X'));
    expect(url.searchParams.get('origin')).toBe('Shop, X');
    expect(url.searchParams.get('destination')).toBe('3 C St, Z');
    expect(url.searchParams.get('waypoints')).toBe('1 A St, X|2 B St, Y');
    expect(routeUrl([a])).toBeNull();
  });

  it('matches every search word, ignoring accents and case', () => {
    expect(matches('José Álvarez, Eugene', 'jose eug')).toBe(true);
    expect(matches('José Álvarez', 'maria')).toBe(false);
  });

  it('formats hours and phone links', () => {
    expect(formatHours(135)).toBe('2h 15m');
    expect(formatHours(45)).toBe('45m');
    expect(telHref('(541) 555-0100')).toBe('tel:5415550100');
    expect(telHref('(541) 555-0100 ext. 23')).toBe('tel:5415550100,23');
    expect(telHref('541-555-0100 x23')).toBe('tel:5415550100,23');
    expect(telHref('+44 (0) 20 7946 0958')).toBe('tel:+442079460958');
    expect(telHref('')).toBe(null);
  });
});
