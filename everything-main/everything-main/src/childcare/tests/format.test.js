import { describe, it, expect } from 'vitest';
import { personName, firstName, initials, matches, formatHours, telHref, pluralize } from '../src/core/format.js';
import { ageLabel, nextBirthday, ageInMonths } from '../src/core/dates.js';

describe('format', () => {
  it('names people by preferred name when they have one', () => {
    expect(personName({ firstName: 'Margaret', lastName: 'Lee', preferredName: 'Maggie' })).toBe('Maggie Lee');
    expect(personName({ firstName: 'Margaret', lastName: 'Lee', preferredName: 'Maggie' }, { preferred: false })).toBe('Margaret Lee');
    expect(firstName({ firstName: 'Margaret', preferredName: 'Maggie' })).toBe('Maggie');
    expect(personName(null)).toBe('Unknown');
  });

  it('makes initials from any name', () => {
    expect(initials('Maya Bennett')).toBe('MB');
    expect(initials('Cher')).toBe('CH');
    expect(initials('José María López')).toBe('JL');
    expect(initials('')).toBe('?');
  });

  it('matches accent- and case-insensitively, all terms', () => {
    expect(matches('José Ramírez', 'jose ram')).toBe(true);
    expect(matches('José Ramírez', 'jose x')).toBe(false);
  });

  it('formats hours, phones, and counts', () => {
    expect(formatHours(125)).toBe('2h 5m');
    expect(formatHours(60)).toBe('1h');
    expect(telHref('(541) 555-0100')).toBe('tel:5415550100');
    expect(pluralize(1, 'child', 'children')).toBe('1 child');
    expect(pluralize(3, 'child', 'children')).toBe('3 children');
  });

  it('describes ages and birthdays', () => {
    expect(ageLabel('2026-04-01', '2026-10-12')).toBe('6 mo');
    expect(ageLabel('2023-07-20', '2026-10-12')).toBe('3 yr 2 mo');
    expect(ageLabel('2018-01-01', '2026-10-12')).toBe('8 yr');
    expect(ageInMonths('2026-10-13', '2026-10-12')).toBeNull();
    expect(nextBirthday('2020-10-12', '2026-10-12')).toBe('2026-10-12');
    expect(nextBirthday('2020-02-29', '2026-10-12')).toBe('2027-02-28');
  });
});
