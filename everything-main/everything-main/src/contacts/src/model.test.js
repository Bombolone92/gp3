import { describe, it, expect } from 'vitest'
import {
  normalizeContact,
  createContact,
  displayName,
  subtitle,
  validateContact,
  isValidEmail,
  contactKey,
} from './model.js'

describe('normalizeContact', () => {
  it('fills every field and coerces types', () => {
    const c = normalizeContact({ firstName: '  Ada ', favorite: 1, tags: 'Friend, VIP, friend' })
    expect(c.firstName).toBe('Ada')
    expect(c.favorite).toBe(true)
    expect(Array.isArray(c.emails)).toBe(true)
    // tags split from string and de-duplicated case-insensitively
    expect(c.tags).toEqual(['Friend', 'VIP'])
    expect(typeof c.id).toBe('string')
    expect(c.id.length).toBeGreaterThan(0)
  })

  it('drops empty entries and trims values', () => {
    const c = normalizeContact({
      emails: [{ label: 'Work', value: '  a@b.com ' }, { label: 'Home', value: '' }, 'c@d.com'],
    })
    expect(c.emails).toEqual([
      { label: 'Work', value: 'a@b.com' },
      { label: 'Personal', value: 'c@d.com' },
    ])
  })

  it('is resilient to garbage input', () => {
    expect(() => normalizeContact(null)).not.toThrow()
    expect(() => normalizeContact(42)).not.toThrow()
    expect(normalizeContact(undefined).emails).toEqual([])
  })

  it('preserves a photo data URL', () => {
    const photo = 'data:image/jpeg;base64,abc'
    expect(normalizeContact({ photo }).photo).toBe(photo)
    expect(normalizeContact({}).photo).toBe('')
  })
})

describe('createContact', () => {
  it('assigns id and timestamps', () => {
    const c = createContact({ firstName: 'Grace' })
    expect(c.id).toBeTruthy()
    expect(c.createdAt).toBeTypeOf('number')
    expect(c.updatedAt).toBeTypeOf('number')
  })
})

describe('displayName / subtitle', () => {
  it('prefers full name, then falls back', () => {
    expect(displayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace')
    expect(displayName(normalizeContact({ company: 'Acme' }))).toBe('Acme')
    expect(displayName(normalizeContact({ emails: [{ value: 'x@y.com' }] }))).toBe('x@y.com')
    expect(displayName(normalizeContact({}))).toBe('No Name')
  })

  it('builds a sensible subtitle', () => {
    expect(subtitle({ jobTitle: 'CTO', company: 'Acme' })).toBe('CTO · Acme')
    expect(subtitle(normalizeContact({ company: 'Acme' }))).toBe('Acme')
  })
})

describe('isValidEmail', () => {
  it('accepts plausible addresses and rejects mistakes', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('first.last@sub.example.co')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('no spaces@x.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('validateContact', () => {
  it('requires at least one identifying field', () => {
    expect(validateContact({}).valid).toBe(false)
    expect(validateContact({ firstName: 'A' }).valid).toBe(true)
    expect(validateContact({ emails: [{ value: 'a@b.com' }] }).valid).toBe(true)
  })

  it('flags an invalid email', () => {
    const res = validateContact({ firstName: 'A', emails: [{ value: 'nope' }] })
    expect(res.valid).toBe(false)
    expect(res.errors.emails).toMatch(/not a valid email/i)
  })

  it('flags a malformed birthday', () => {
    const res = validateContact({ firstName: 'A', birthday: 'yesterday' })
    expect(res.valid).toBe(false)
    expect(res.errors.birthday).toBeTruthy()
  })
})

describe('contactKey', () => {
  it('namespaces ids under contact:', () => {
    expect(contactKey('abc')).toBe('contact:abc')
  })
})
