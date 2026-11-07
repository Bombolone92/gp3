import { describe, it, expect } from 'vitest'
import { addressFormat, formatAddressLines, fieldLabel } from './address.js'

describe('addressFormat', () => {
  it('US uses State + ZIP code with a state dropdown', () => {
    const f = addressFormat('US')
    expect(fieldLabel(f, 'state')).toBe('State')
    expect(fieldLabel(f, 'postalCode')).toBe('ZIP code')
    expect(Array.isArray(f.states)).toBe(true)
    const keys = f.rows.flat()
    expect(keys).toContain('city')
    expect(keys).toContain('postalCode')
  })

  it('UAE uses Emirate and omits city / postal code', () => {
    const f = addressFormat('AE')
    expect(fieldLabel(f, 'state')).toBe('Emirate')
    const keys = f.rows.flat()
    expect(keys).not.toContain('city')
    expect(keys).not.toContain('postalCode')
    expect(f.states).toContain('Dubai')
  })

  it('falls back to a sensible default for unknown countries', () => {
    const f = addressFormat('ZZ')
    expect(f.rows.flat()).toContain('city')
    expect(fieldLabel(f, 'postalCode')).toBe('Postal code')
  })
})

describe('formatAddressLines', () => {
  it('formats a US address ending with the country name', () => {
    const lines = formatAddressLines({
      street: '1600 Pennsylvania Ave',
      city: 'Washington',
      state: 'DC',
      postalCode: '20500',
      country: 'US',
    })
    expect(lines[0]).toBe('1600 Pennsylvania Ave')
    expect(lines).toContain('Washington, DC 20500')
    expect(lines[lines.length - 1]).toBe('United States')
  })

  it('returns nothing for an empty address', () => {
    expect(formatAddressLines({})).toEqual([])
  })
})
