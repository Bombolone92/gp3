import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  telHref,
  formatPhone,
  normalizeUrl,
  displayUrl,
  formatBirthday,
  formatWhen,
  relativeTime,
  sectionLetter,
} from './format.js'

describe('escapeHtml', () => {
  it('escapes all dangerous characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('&')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;&amp;&#39;)&quot;&gt;',
    )
  })
  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('telHref', () => {
  it('keeps only digits and a leading plus', () => {
    expect(telHref('+1 (555) 010-2030')).toBe('tel:+15550102030')
  })
  it('drops a plus anywhere past the start (invalid in tel: URIs)', () => {
    expect(telHref('555+010+2030')).toBe('tel:5550102030')
    expect(telHref('(+1) 555 010 2030')).toBe('tel:+15550102030')
  })
})

describe('formatPhone', () => {
  it('formats 10-digit North American numbers', () => {
    expect(formatPhone('7788616965')).toBe('(778) 861-6965')
    expect(formatPhone('415.555.0142')).toBe('(415) 555-0142')
  })
  it('keeps a +1 country code and formats the rest', () => {
    expect(formatPhone('+1 (415) 555-0199')).toBe('+1 (415) 555-0199')
    expect(formatPhone('14155550199')).toBe('1 (415) 555-0199')
  })
  it('leaves international, short, and vanity numbers as entered', () => {
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhone('911')).toBe('911')
    expect(formatPhone('1-800-FLOWERS')).toBe('1-800-FLOWERS')
    expect(formatPhone('')).toBe('')
  })
})

describe('normalizeUrl', () => {
  it('adds https:// when missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })
  it('preserves http/https', () => {
    expect(normalizeUrl('http://x.com')).toBe('http://x.com')
  })
  it('rejects dangerous schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
    expect(normalizeUrl('data:text/html,<script>')).toBe('')
  })
  it('returns empty for empty input', () => {
    expect(normalizeUrl('  ')).toBe('')
  })
})

describe('displayUrl', () => {
  it('drops protocol, www, and trailing slash', () => {
    expect(displayUrl('https://www.example.com/path/')).toBe('example.com/path')
    expect(displayUrl('example.com/')).toBe('example.com')
  })
})

describe('formatBirthday', () => {
  it('formats full dates', () => {
    expect(formatBirthday('1990-05-20')).toBe('May 20, 1990')
  })
  it('omits the year for the 0000 no-year convention', () => {
    expect(formatBirthday('0000-12-01')).toBe('December 1')
  })
  it('passes through unparseable values', () => {
    expect(formatBirthday('soon')).toBe('soon')
  })
})

describe('formatWhen', () => {
  const now = new Date(2031, 4, 4, 10, 0).getTime() // Sunday, 4 May 2031
  const on = (day, hour = 15, month = 4, year = 2031) =>
    new Date(year, month, day, hour, 30).getTime()

  it('names the days a person thinks of by name', () => {
    expect(formatWhen(on(4), { allDay: true, now })).toBe('Today')
    expect(formatWhen(on(5), { allDay: true, now })).toBe('Tomorrow')
    expect(formatWhen(on(7), { allDay: true, now })).toBe('Wednesday')
  })

  it('dates anything further out, with a year only when it is another one', () => {
    expect(formatWhen(on(20), { allDay: true, now })).toBe('May 20')
    expect(formatWhen(on(11), { allDay: true, now })).toBe('May 11') // a week away
    expect(formatWhen(on(3, 15, 0, 2032), { allDay: true, now })).toBe('January 3, 2032')
  })

  it('adds a clock time to a timed event, and none to an all-day one', () => {
    expect(formatWhen(on(5, 9), { now })).toMatch(/^Tomorrow · /)
    expect(formatWhen(on(5, 9), { now })).toMatch(/9/)
    expect(formatWhen(on(5, 9), { allDay: true, now })).toBe('Tomorrow')
  })

  it('counts calendar days, not 24-hour periods', () => {
    // 11pm tonight and 1am tomorrow are two hours apart, on different days.
    expect(formatWhen(on(4, 23), { allDay: true, now })).toBe('Today')
    expect(formatWhen(on(5, 1), { allDay: true, now })).toBe('Tomorrow')
  })
})

describe('relativeTime', () => {
  const now = 1_700_000_000_000
  it('reports recent times', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now')
  })
  it('reports days', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago')
  })
  it('reports a single hour without pluralizing', () => {
    expect(relativeTime(now - 3_600_000, now)).toBe('1 hour ago')
  })
})

describe('sectionLetter', () => {
  it('uppercases the first letter', () => {
    expect(sectionLetter('ada')).toBe('A')
  })
  it('buckets non-letters under #', () => {
    expect(sectionLetter('123 Main')).toBe('#')
    expect(sectionLetter('')).toBe('#')
  })
  it('files accented letters under their base letter, matching the sort', () => {
    expect(sectionLetter('Émile')).toBe('E')
    expect(sectionLetter('ünal')).toBe('U')
    expect(sectionLetter('Ñoño')).toBe('N')
  })
  it('files non-decomposing letters where the collator sorts them', () => {
    expect(sectionLetter('Østergaard')).toBe('O')
  })
  it('keeps non-Latin scripts under #', () => {
    expect(sectionLetter('田中')).toBe('#')
  })
})
