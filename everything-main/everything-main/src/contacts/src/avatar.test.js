import { describe, it, expect } from 'vitest'
import { initials, avatarColor } from './avatar.js'
import { normalizeContact } from './model.js'

describe('initials with astral characters', () => {
  it('never splits surrogate pairs', () => {
    // 𝕁𝕆 (mathematical double-struck) are astral letters: two UTF-16 units each.
    const two = initials({ firstName: '𝕁ohn', lastName: '𝕆wens' })
    expect(two).toBe('𝕁𝕆')
    expect(two).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    const one = initials({ firstName: '𝕁𝕆' })
    expect(one).toBe('𝕁𝕆')
  })
})

describe('initials', () => {
  it('uses first + last initial', () => {
    expect(initials({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('AL')
  })
  it('takes two letters from a single word', () => {
    expect(initials(normalizeContact({ company: 'Acme' }))).toBe('AC')
  })
  it('falls back to ? for nameless contacts', () => {
    expect(initials(normalizeContact({}))).toBe('?')
  })
  it('ignores punctuation/emoji', () => {
    expect(initials({ firstName: '🚀Nova', lastName: 'Star' })).toBe('NS')
  })
  it('keeps a hyphenated surname as one token', () => {
    expect(initials({ firstName: 'Maria', lastName: 'Gonzalez-Smith' })).toBe('MG')
    expect(initials({ firstName: "O'Hara", lastName: 'Quinn' })).toBe('OQ')
  })
})

describe('avatarColor', () => {
  it('is deterministic for a given id', () => {
    const c = { id: 'fixed-id' }
    expect(avatarColor(c)).toBe(avatarColor(c))
  })
  it('returns a hex color', () => {
    expect(avatarColor({ id: 'x' })).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('varies across different ids', () => {
    const colors = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => avatarColor({ id })),
    )
    expect(colors.size).toBeGreaterThan(1)
  })

  it('every swatch meets WCAG AA (4.5:1) against the white initials', () => {
    const relLum = (hex) => {
      const n = hex.replace('#', '')
      const ch = [0, 2, 4]
        .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    }
    const contrast = (hex) => 1.05 / (relLum(hex) + 0.05)

    const seen = new Set()
    for (let i = 0; i < 500; i++) seen.add(avatarColor({ id: `id-${i}` }))
    expect(seen.size).toBe(10) // every palette slot is exercised
    for (const color of seen) expect(contrast(color)).toBeGreaterThanOrEqual(4.5)
  })
})
