import { describe, it, expect } from 'vitest'
import {
  matchesQuery,
  filterContacts,
  sortContacts,
  groupContacts,
  allTags,
} from './search.js'
import { normalizeContact } from './model.js'

const people = [
  normalizeContact({
    id: '1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Analytical Engines',
    emails: [{ label: 'Work', value: 'ada@engine.io' }],
    tags: ['pioneer', 'vip'],
    favorite: true,
    updatedAt: 300,
  }),
  normalizeContact({
    id: '2',
    firstName: 'Alan',
    lastName: 'Turing',
    phones: [{ label: 'Mobile', value: '+1 555 0100' }],
    tags: ['pioneer'],
    updatedAt: 100,
  }),
  normalizeContact({
    id: '3',
    firstName: 'Grace',
    lastName: 'Hopper',
    favorite: false,
    updatedAt: 200,
  }),
]

describe('matchesQuery', () => {
  it('matches across fields and is case-insensitive', () => {
    expect(matchesQuery(people[0], 'engine')).toBe(true)
    expect(matchesQuery(people[1], '555')).toBe(true)
  })
  it('requires every term (AND semantics)', () => {
    expect(matchesQuery(people[0], 'ada lovelace')).toBe(true)
    expect(matchesQuery(people[0], 'ada turing')).toBe(false)
  })
  it('empty query matches everything', () => {
    expect(matchesQuery(people[2], '')).toBe(true)
  })
})

describe('filterContacts', () => {
  it('filters by favorites', () => {
    const res = filterContacts(people, { favoritesOnly: true })
    expect(res.map((c) => c.id)).toEqual(['1'])
  })
  it('filters by tag, case-insensitively', () => {
    expect(filterContacts(people, { tag: 'PIONEER' }).map((c) => c.id)).toEqual(['1', '2'])
  })
  it('combines query and tag', () => {
    expect(filterContacts(people, { tag: 'pioneer', query: 'turing' }).map((c) => c.id)).toEqual([
      '2',
    ])
  })
})

describe('sortContacts', () => {
  it('sorts by first name', () => {
    expect(sortContacts(people, 'first').map((c) => c.firstName)).toEqual(['Ada', 'Alan', 'Grace'])
  })
  it('sorts by last name', () => {
    expect(sortContacts(people, 'last').map((c) => c.lastName)).toEqual([
      'Hopper',
      'Lovelace',
      'Turing',
    ])
  })
  it('sorts by recently updated', () => {
    expect(sortContacts(people, 'recent').map((c) => c.id)).toEqual(['1', '3', '2'])
  })
  it('does not mutate the input', () => {
    const before = people.map((c) => c.id)
    sortContacts(people, 'last')
    expect(people.map((c) => c.id)).toEqual(before)
  })
})

describe('groupContacts', () => {
  it('creates A–Z sections for name sorts', () => {
    const groups = groupContacts(people, 'first')
    expect(groups.map((g) => g.key)).toEqual(['A', 'G'])
    expect(groups[0].contacts).toHaveLength(2)
  })
  it('uses a single group for time sorts', () => {
    const groups = groupContacts(people, 'recent')
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('')
  })
  it('keeps accented names in their base-letter section (no stray # mid-list)', () => {
    const groups = groupContacts(
      [
        normalizeContact({ id: 'e1', firstName: 'Emma' }),
        normalizeContact({ id: 'e2', firstName: 'Émile' }),
        normalizeContact({ id: 'f1', firstName: 'Frank' }),
      ],
      'first',
    )
    expect(groups.map((g) => g.key)).toEqual(['E', 'F'])
    expect(groups[0].contacts.map((c) => c.firstName)).toEqual(['Émile', 'Emma'])
  })
})

describe('allTags', () => {
  it('counts unique tags alphabetically', () => {
    expect(allTags(people)).toEqual([
      { name: 'pioneer', count: 2 },
      { name: 'vip', count: 1 },
    ])
  })
})
