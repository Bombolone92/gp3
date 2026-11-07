// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { store } from './store.js'
import { createContact, contactKey } from './model.js'

function stubPuter() {
  const kv = new Map()
  window.puter = {
    kv: {
      list: async () => [...kv.entries()].map(([key, value]) => ({ key, value })),
      set: async (k, v) => {
        kv.set(k, v)
        return true
      },
      del: async (k) => {
        kv.delete(k)
        return true
      },
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
    },
  }
  return kv
}

describe('store', () => {
  beforeEach(() => {
    stubPuter()
    store.contacts.clear()
    store.exitSelectMode()
    store.ui.selectedId = null
    store.ui.tag = ''
  })

  it('saves a contact and loads it back', async () => {
    const c = createContact({ firstName: 'Ada' })
    await store.save(c)
    store.contacts.clear()
    await store.load()
    expect(store.all).toHaveLength(1)
    expect(store.get(c.id).firstName).toBe('Ada')
  })

  it('asks the cloud for its own keys only, and still filters what comes back', async () => {
    const kv = stubPuter()
    kv.set('pref:sort', 'last') // something that is not a contact
    await store.save(createContact({ firstName: 'Ada' }))
    const calls = []
    const inner = window.puter.kv.list
    window.puter.kv.list = async (...args) => {
      calls.push(args)
      return inner() // a backend that ignores the pattern, as an older one may
    }
    await store.load()
    expect(calls[0]).toEqual(['contact:*', true])
    expect(store.all).toHaveLength(1)
  })

  it('load() records an error the UI can render; reload() leaves it alone', async () => {
    await store.save(createContact({ firstName: 'Ada' }))
    await store.load()
    expect(store.isFresh()).toBe(true)
    const loadedAt = store.loadedAt

    window.puter.kv.list = async () => {
      throw new Error('offline')
    }
    // A background revalidation that fails keeps the book *and* the clean state:
    // a window with a perfectly good list must not start showing an error.
    await expect(store.reload()).rejects.toThrow('offline')
    expect(store.error).toBeNull()
    expect(store.all).toHaveLength(1)
    expect(store.loadedAt).toBe(loadedAt)

    // A user-facing load is the one that reports it.
    await expect(store.load()).rejects.toThrow('offline')
    expect(store.error).toBeTruthy()
    expect(store.all).toHaveLength(1)
    // An error state is never "fresh", so the next request tries the cloud again.
    expect(store.isFresh()).toBe(false)
  })

  it('isFresh() bounds how old the loaded book may be', async () => {
    await store.load()
    expect(store.isFresh(1000)).toBe(true)
    store.loadedAt = Date.now() - 5000
    expect(store.isFresh(1000)).toBe(false)
    expect(store.isFresh()).toBe(true) // no bound asked for
  })

  it('removeMany deletes exactly the requested contacts', async () => {
    const a = await store.save(createContact({ firstName: 'A' }))
    const b = await store.save(createContact({ firstName: 'B' }))
    const c = await store.save(createContact({ firstName: 'C' }))
    const n = await store.removeMany([a.id, b.id])
    expect(n).toBe(2)
    expect(store.all.map((x) => x.id)).toEqual([c.id])
  })

  it('importMany skips duplicates and reports skipped count', async () => {
    // First import writes both.
    const r1 = await store.importMany([
      { firstName: 'Ada', emails: [{ label: 'Work', value: 'ada@engine.io' }] },
      { firstName: 'Grace', phones: [{ label: 'Mobile', value: '+1 555 0001' }] },
    ])
    expect(r1).toEqual({ written: 2, skipped: 0 })
    expect(store.all).toHaveLength(2)

    // Re-importing the same file (e.g. a Google export) adds nothing.
    const r2 = await store.importMany([
      { firstName: 'Ada', emails: [{ label: 'Personal', value: 'ADA@engine.io' }] }, // case-insensitive email match
      { firstName: 'Grace', phones: [{ label: 'Home', value: '+1 (555) 0001' }] }, // same digits, diff formatting
      { firstName: 'Linus', emails: [{ label: 'Work', value: 'linus@kernel.org' }] }, // genuinely new
    ])
    expect(r2).toEqual({ written: 1, skipped: 2 })
    expect(store.all).toHaveLength(3)
  })

  it('importMany reports progress that reaches the number actually written', async () => {
    await store.importMany([{ firstName: 'Ada', emails: [{ label: 'Work', value: 'ada@engine.io' }] }])
    const ticks = []
    const { written, skipped } = await store.importMany(
      [
        { firstName: 'Ada', emails: [{ label: 'Work', value: 'ada@engine.io' }] }, // duplicate
        { firstName: 'Grace', emails: [{ label: 'Work', value: 'grace@navy.mil' }] },
        { firstName: 'Linus', emails: [{ label: 'Work', value: 'linus@kernel.org' }] },
      ],
      { onProgress: (done, total) => ticks.push([done, total]) },
    )
    expect({ written, skipped }).toEqual({ written: 2, skipped: 1 })
    // Starts at zero so the caller can show a total up front, and the total
    // counts only real writes — the duplicate never stalls the bar at 2/3.
    expect(ticks).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('removeMany reports progress, counting failures so the bar always completes', async () => {
    const a = await store.save(createContact({ firstName: 'A' }))
    const b = await store.save(createContact({ firstName: 'B' }))
    const realDel = window.puter.kv.del
    window.puter.kv.del = async (k) => {
      if (k === contactKey(b.id)) throw new Error('boom')
      return realDel(k)
    }
    const ticks = []
    const n = await store.removeMany([a.id, b.id], {
      concurrency: 1,
      onProgress: (done, total) => ticks.push([done, total]),
    })
    window.puter.kv.del = realDel
    expect(n).toBe(1)
    expect(ticks).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('publishes partial results mid-job, so a long import fills the list as it goes', async () => {
    // 12 writes at 60ms each, one at a time: long enough to outlive the store's
    // coalescing window and emit at least once before the job is done.
    const realSet = window.puter.kv.set
    window.puter.kv.set = async (k, v) => {
      await new Promise((r) => setTimeout(r, 60))
      return realSet(k, v)
    }
    const sizes = []
    const unsubscribe = store.subscribe((s) => sizes.push(s.all.length))
    const batch = Array.from({ length: 12 }, (_v, i) => ({
      firstName: `P${i}`,
      emails: [{ label: 'Work', value: `p${i}@example.com` }],
    }))
    await store.importMany(batch, { concurrency: 1 })
    unsubscribe()
    window.puter.kv.set = realSet
    expect(store.all).toHaveLength(12)
    const partial = sizes.filter((n) => n > 0 && n < 12)
    expect(partial.length).toBeGreaterThan(0)
  })

  it('renameTag renames across contacts (case-insensitive) and persists', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['Clients', 'vip'] }))
    const b = await store.save(createContact({ firstName: 'B', tags: ['clients'] }))
    const c = await store.save(createContact({ firstName: 'C', tags: ['other'] }))

    const res = await store.renameTag('clients', 'Customers')
    expect(res.changed).toBe(2)
    expect(res.failed).toBe(0)
    expect(store.get(a.id).tags).toEqual(['Customers', 'vip'])
    expect(store.get(b.id).tags).toEqual(['Customers'])
    expect(store.get(c.id).tags).toEqual(['other'])

    // Persisted to the cloud, not just patched in memory.
    store.contacts.clear()
    await store.load()
    expect(store.get(a.id).tags).toEqual(['Customers', 'vip'])
    expect(store.get(b.id).tags).toEqual(['Customers'])
  })

  it('renameTag onto an existing tag merges without duplicates', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['clients', 'customers'] }))
    const res = await store.renameTag('clients', 'customers')
    expect(res.changed).toBe(1)
    expect(store.get(a.id).tags).toEqual(['customers'])
  })

  it('renameTag applies case-only changes and skips already-exact contacts', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['work'] }))
    const b = await store.save(createContact({ firstName: 'B', tags: ['Work'] }))
    const res = await store.renameTag('work', 'Work')
    expect(res.total).toBe(1) // only the differing contact is written
    expect(store.get(a.id).tags).toEqual(['Work'])
    expect(store.get(b.id).tags).toEqual(['Work'])
  })

  it('renameTag follows the active tag filter to the new name', async () => {
    await store.save(createContact({ firstName: 'A', tags: ['friend'] }))
    store.setUI({ tag: 'friend' })
    await store.renameTag('friend', 'ally')
    expect(store.ui.tag).toBe('ally')
  })

  it('renameTag keeps failed contacts on the old tag (partial failure)', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['old'] }))
    const b = await store.save(createContact({ firstName: 'B', tags: ['old'] }))
    store.setUI({ tag: 'old' })
    const realSet = window.puter.kv.set
    window.puter.kv.set = async (k, v) => {
      if (k === contactKey(b.id)) throw new Error('boom')
      return realSet(k, v)
    }

    const res = await store.renameTag('old', 'new')
    expect(res.changed).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.total).toBe(2)
    expect(store.get(a.id).tags).toEqual(['new'])
    expect(store.get(b.id).tags).toEqual(['old']) // memory still matches the cloud
    expect(store.ui.tag).toBe('new') // the filter follows whatever did rename
  })

  it('removeTag strips the tag everywhere and clears a matching filter', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['temp', 'keep'] }))
    const b = await store.save(createContact({ firstName: 'B', tags: ['Temp'] }))
    store.setUI({ tag: 'temp' })
    const res = await store.removeTag('temp')
    expect(res.changed).toBe(2)
    expect(res.failed).toBe(0)
    expect(store.get(a.id).tags).toEqual(['keep'])
    expect(store.get(b.id).tags).toEqual([])
    expect(store.ui.tag).toBe('')
  })

  it('removeTag keeps the filter while a failed contact still carries the tag', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['temp'] }))
    const b = await store.save(createContact({ firstName: 'B', tags: ['temp'] }))
    store.setUI({ tag: 'temp' })
    const realSet = window.puter.kv.set
    window.puter.kv.set = async (k, v) => {
      if (k === contactKey(b.id)) throw new Error('boom')
      return realSet(k, v)
    }

    const res = await store.removeTag('temp')
    expect(res.changed).toBe(1)
    expect(res.failed).toBe(1)
    expect(store.get(a.id).tags).toEqual([])
    expect(store.get(b.id).tags).toEqual(['temp'])
    expect(store.ui.tag).toBe('temp') // still filterable to reach the stragglers
  })

  it('saveMany restores a tag operation snapshot (undo)', async () => {
    const a = await store.save(createContact({ firstName: 'A', tags: ['x'] }))
    const before = store.get(a.id)
    const { snapshot } = await store.renameTag('x', 'y')
    expect(store.get(a.id).tags).toEqual(['y'])

    const res = await store.saveMany(snapshot)
    expect(res).toEqual({ saved: 1, failed: 0 })
    expect(store.get(a.id).tags).toEqual(['x'])
    expect(store.get(a.id).updatedAt).toBe(before.updatedAt) // timestamps restored too
  })

  it('renameTag and removeTag reject empty names', async () => {
    await expect(store.renameTag('a', ' ')).rejects.toThrow()
    await expect(store.renameTag(' ', 'b')).rejects.toThrow()
    await expect(store.removeTag('')).rejects.toThrow()
  })

  it('tracks multi-select state', () => {
    store.enterSelectMode()
    expect(store.ui.selectMode).toBe(true)
    store.toggleCheck('x')
    store.toggleCheck('y')
    expect(store.ui.checked.has('x')).toBe(true)
    store.toggleCheck('x')
    expect(store.ui.checked.has('x')).toBe(false)
    store.setChecked(['a', 'b', 'c'])
    expect(store.ui.checked.size).toBe(3)
    store.exitSelectMode()
    expect(store.ui.selectMode).toBe(false)
    expect(store.ui.checked.size).toBe(0)
  })
})
