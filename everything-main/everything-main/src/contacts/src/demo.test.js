// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { store } from './store.js'
import { createSampleDataPopulator } from './demo.js'
import { validateContact } from './model.js'

let kv, populate
beforeEach(async () => {
  kv = new Map()
  window.puter = { kv: {
    set: vi.fn(async (key, value) => { kv.set(key, structuredClone(value)) }),
    list: async () => [...kv].map(([key, value]) => ({ key, value })),
  } }
  await store.load()
  populate = createSampleDataPopulator(() => store)
})

describe('console sample contacts', () => {
  it('persists complete contacts, preserves existing data, and shares overlapping calls', async () => {
    const existing = await store.save({ firstName: 'Existing', notes: 'Keep me' })
    const pending = populate()
    expect(populate()).toBe(pending)
    const result = await pending
    expect(result.created).toBe(18)
    expect(store.selected.firstName).toBe('Amelia')
    expect(store.ui.tag).toBe('Sample data')
    await store.load()
    expect(store.all).toHaveLength(19)
    expect(store.get(existing.id)).toEqual(existing)
    for (const id of result.ids) {
      const contact = store.get(id)
      expect(validateContact(contact).valid).toBe(true)
      expect(contact.tags).toContain('Sample data')
      expect(contact.emails[0].value).toMatch(/@northwind\.example$/)
    }
    const next = await populate()
    expect(next.ids.some(id => result.ids.includes(id))).toBe(false)
    expect(store.all).toHaveLength(37)
  })

  it('rejects before loading and reports partial failure without claiming success', async () => {
    const notReady = createSampleDataPopulator(() => null)
    await expect(notReady()).rejects.toThrow('Sign in')
    expect(window.puter.kv.set).not.toHaveBeenCalled()
    window.puter.kv.set.mockImplementationOnce(async (key, value) => kv.set(key, value))
      .mockRejectedValueOnce(new Error('offline'))
    await expect(populate()).rejects.toThrow('after 1 contacts were saved')
    await store.load()
    expect(store.all).toHaveLength(1)
    expect((await populate()).created).toBe(18)
  })
})
