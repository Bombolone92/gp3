// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { store } from '../store.js'
import { createContact } from '../model.js'
import { DELETE_MAX, createMethods } from './methods.js'
import { startApiServer } from './server.js'
import {
  CHANNEL,
  ERRORS,
  PROTOCOL_VERSION,
  READ_METHODS,
  grantedMethods,
  readLaunchContext,
} from './protocol.js'

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

/** A stand-in for the AppConnection the caller is on. */
function fakeConnection() {
  const handlers = new Map()
  const sent = []
  return {
    sent,
    postMessage: (msg) => sent.push(msg),
    on: (event, fn) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event).add(fn)
    },
    off: (event, fn) => handlers.get(event)?.delete(fn),
    /** Simulate the caller posting `msg` to us. */
    receive: (msg) => {
      for (const fn of handlers.get('message') || []) fn(msg)
    },
    listenerCount: (event) => (handlers.get(event) || new Set()).size,
  }
}

async function seed(contacts) {
  for (const c of contacts) await store.save(createContact(c))
}

function resetStore() {
  store.contacts.clear()
  store.loaded = false
  // As a freshly booted instance would be: nothing has been read from the cloud,
  // so there is no book to fall back on either.
  store.loadedAt = 0
  store.error = null
  store.listeners.clear()
  store.ui.query = ''
  store.ui.tag = ''
  store.ui.favoritesOnly = false
  store.ui.selectedId = null
}

describe('api/protocol — access control', () => {
  it('grants the calendar the reads it uses, and no way to change the book', () => {
    expect(grantedMethods('calendar')).toEqual(READ_METHODS)
    expect(grantedMethods('calendar')).toContain('list')
    for (const write of ['create', 'update', 'delete']) {
      expect(grantedMethods('calendar')).not.toContain(write)
    }
  })

  it('grants nothing to an app that is not named', () => {
    expect(grantedMethods('notes')).toEqual([])
    expect(grantedMethods('')).toEqual([])
    expect(grantedMethods(undefined)).toEqual([])
  })

  it('honours a narrowed, per-app grant', () => {
    const allowed = { reader: ['search', 'suggest', 'nonexistent'] }
    expect(grantedMethods('reader', allowed)).toEqual(['search', 'suggest'])
  })

  it('reads the caller from the desktop-stamped launch parameter, not the message', () => {
    const win = {
      puter: { env: 'app', args: { service: 'contacts-api' } },
      location: { search: '?puter.source_app.name=Calendar&puter.app_instance_id=abc' },
    }
    expect(readLaunchContext(win)).toEqual({
      callerApp: 'calendar',
      serviceMode: true,
      inPuterApp: true,
    })
  })

  it('reports no caller outside the Puter desktop', () => {
    const win = {
      puter: { env: 'web', args: { service: 'contacts-api' } },
      location: { search: '?puter.source_app.name=calendar' },
    }
    expect(readLaunchContext(win)).toEqual({ callerApp: '', serviceMode: false, inPuterApp: false })
  })
})

describe('api/methods', () => {
  let methods

  beforeEach(async () => {
    stubPuter()
    resetStore()
    methods = createMethods({ store })
    await seed([
      { firstName: 'Ada', lastName: 'Lovelace', emails: [{ label: 'Work', value: 'ada@analytical.co' }], company: 'Analytical Engines', favorite: true },
      { firstName: 'Grace', lastName: 'Hopper', emails: [{ label: 'Work', value: 'grace@navy.mil' }, { label: 'Personal', value: 'ghopper@example.com' }] },
      { firstName: 'Alan', lastName: 'Turing', emails: [{ label: 'Work', value: 'alan@bletchley.uk' }], company: 'Bletchley Park' },
      { firstName: 'Katherine', lastName: 'Johnson', phones: [{ label: 'Mobile', value: '555-0100' }] },
    ])
    // Seeding wrote through save(); mark the book as *just* read from the cloud
    // so the methods' lazy load is a no-op, exactly as it is right after a boot.
    store.loaded = true
    store.loadedAt = Date.now()
  })

  it('lists every contact as a lightweight summary', async () => {
    const { contacts, total } = await methods.list({})
    expect(total).toBe(4)
    expect(contacts[0].name).toBe('Ada Lovelace')
    expect(contacts[0].emails).toEqual([{ label: 'Work', value: 'ada@analytical.co' }])
    // Summaries stay small: no photo payload, no notes.
    expect(contacts[0]).not.toHaveProperty('photo')
    expect(contacts[0]).not.toHaveProperty('notes')
  })

  it('paginates and caps the list', async () => {
    const page = await methods.list({ limit: 2, offset: 1 })
    expect(page.contacts).toHaveLength(2)
    expect(page.offset).toBe(1)
    expect(page.total).toBe(4)
  })

  it('searches across every field', async () => {
    const byCompany = await methods.search({ query: 'bletchley' })
    expect(byCompany.contacts.map((c) => c.name)).toEqual(['Alan Turing'])

    const byEmail = await methods.search({ query: 'navy.mil' })
    expect(byEmail.contacts.map((c) => c.name)).toEqual(['Grace Hopper'])
  })

  it('suggests one entry per email address, ranked by match quality', async () => {
    const { suggestions } = await methods.suggest({ query: 'a' })
    // "Ada" and "Alan" start with the query; Grace only matches via
    // "grace@navy.mil"/"ghopper", so it ranks below them.
    expect(suggestions[0]).toMatchObject({ name: 'Ada Lovelace', email: 'ada@analytical.co' })
    expect(suggestions.map((s) => s.name).slice(0, 2)).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(suggestions.every((s) => s.email)).toBe(true)
  })

  it('matches a surname as a strong prefix hit', async () => {
    const { suggestions } = await methods.suggest({ query: 'hopper' })
    expect(suggestions.map((s) => s.email)).toEqual(['grace@navy.mil', 'ghopper@example.com'])
  })

  it('leaves out contacts with no email address', async () => {
    const { suggestions } = await methods.suggest({ query: 'katherine' })
    expect(suggestions).toEqual([])
  })

  it('offers an address shared by two people once, and always the same one', async () => {
    // Picking either would invite the same address, so a second row is a choice
    // with no difference behind it. Which contact keeps it follows `list`'s
    // order, so a caller building its own index from `list` agrees with us.
    await seed([
      { firstName: 'Zoe', lastName: 'Ba', emails: [{ label: 'Home', value: 'house@example.com' }] },
      { firstName: 'Abe', lastName: 'Ba', emails: [{ label: 'Home', value: 'house@example.com' }] },
    ])
    store.loadedAt = Date.now()

    const { suggestions } = await methods.suggest({ query: 'house@example.com' })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].name).toBe('Abe Ba') // first by the default sort

    // …and the same again, whatever order the store happens to hold them in.
    const reversed = [...store.contacts.entries()].reverse()
    store.contacts = new Map(reversed)
    const again = await methods.suggest({ query: 'house@example.com' })
    expect(again.suggestions.map((s) => s.name)).toEqual(['Abe Ba'])
  })

  it('puts favorites first among equally good matches', async () => {
    const { suggestions } = await methods.suggest({ query: '' })
    expect(suggestions[0].name).toBe('Ada Lovelace')
    expect(suggestions[0].favorite).toBe(true)
  })

  it('honours the suggestion limit', async () => {
    const { suggestions, total } = await methods.suggest({ query: '', limit: 2 })
    expect(suggestions).toHaveLength(2)
    expect(total).toBe(4) // four addresses across the seeded contacts
  })

  it('creates, patches, and deletes a contact', async () => {
    const created = await methods.create({
      contact: { firstName: 'Radia', lastName: 'Perlman', emails: [{ value: 'radia@spanning.net' }] },
    })
    expect(created.contact.id).toBeTruthy()
    expect(store.get(created.contact.id).firstName).toBe('Radia')

    const updated = await methods.update({
      id: created.contact.id,
      patch: { company: 'Spanning Tree', favorite: true },
    })
    expect(updated.contact.company).toBe('Spanning Tree')
    expect(updated.contact.favorite).toBe(true)
    expect(updated.contact.lastName).toBe('Perlman') // untouched fields survive

    const removed = await methods.delete({ id: created.contact.id })
    expect(removed).toEqual({ deleted: true, id: created.contact.id })
    expect(store.get(created.contact.id)).toBeNull()
  })

  describe('batch delete', () => {
    it('removes several contacts in one call', async () => {
      const [ada, grace, alan] = store.all
      const result = await methods.delete({ ids: [ada.id, grace.id] })
      expect(result).toEqual({ deleted: [ada.id, grace.id], failed: [] })
      expect(store.get(ada.id)).toBeNull()
      expect(store.get(grace.id)).toBeNull()
      expect(store.get(alan.id)).not.toBeNull() // only what was asked for
    })

    it('answers in the shape the caller asked in, not the one the count suggests', async () => {
      const [ada] = store.all
      // A one-id batch is still a batch: a caller that passed `ids` can read
      // `deleted.length` without checking which shape came back.
      expect(await methods.delete({ ids: [ada.id] })).toEqual({ deleted: [ada.id], failed: [] })
    })

    it('trims and de-duplicates the ids it is given', async () => {
      const [ada] = store.all
      expect(await methods.delete({ ids: [ada.id, ` ${ada.id} `] })).toEqual({
        deleted: [ada.id],
        failed: [],
      })
    })

    /**
     * The whole point of checking first: a caller working from a list that has
     * gone stale gets its mistake back intact, rather than a half-applied delete
     * it now has to work out the extent of.
     */
    it('deletes nothing at all when any id is unknown', async () => {
      const [ada, grace] = store.all
      await expect(methods.delete({ ids: [ada.id, 'nope', grace.id] })).rejects.toMatchObject({
        code: ERRORS.NOT_FOUND,
      })
      expect(store.get(ada.id)).not.toBeNull()
      expect(store.get(grace.id)).not.toBeNull()
    })

    it('reports a partial failure rather than hiding the deletes that worked', async () => {
      const [ada, grace] = store.all
      const del = window.puter.kv.del
      window.puter.kv.del = async (key) => {
        if (key.endsWith(grace.id)) throw new Error('offline')
        return del(key)
      }
      const result = await methods.delete({ ids: [ada.id, grace.id] })
      expect(result).toEqual({ deleted: [ada.id], failed: [grace.id] })
      expect(store.get(ada.id)).toBeNull()
      expect(store.get(grace.id)).not.toBeNull() // still there, and said so
    })

    it('raises a batch that deleted nothing as a storage error', async () => {
      const [ada, grace] = store.all
      window.puter.kv.del = async () => {
        throw new Error('offline')
      }
      await expect(methods.delete({ ids: [ada.id, grace.id] })).rejects.toMatchObject({
        code: ERRORS.STORAGE,
      })
      expect(store.get(ada.id)).not.toBeNull()
    })

    it('rejects a malformed or oversized batch', async () => {
      const [ada] = store.all
      const bad = [
        { ids: [] },
        { ids: ['  '] },
        { ids: 'not-an-array' },
        { ids: Array.from({ length: DELETE_MAX + 1 }, (_v, i) => `id-${i}`) },
        { id: ada.id, ids: [ada.id] }, // ambiguous: one or the other, never both
      ]
      for (const params of bad) {
        await expect(methods.delete(params)).rejects.toMatchObject({ code: ERRORS.BAD_REQUEST })
      }
      expect(store.get(ada.id)).not.toBeNull()
    })
  })

  it('never lets a caller steer ids or timestamps', async () => {
    const [existing] = store.all
    const created = await methods.create({
      contact: { id: existing.id, firstName: 'Impostor', createdAt: 0 },
    })
    expect(created.contact.id).not.toBe(existing.id)
    expect(store.get(existing.id).firstName).toBe('Ada')

    const patched = await methods.update({ id: existing.id, patch: { id: 'hijacked', nickname: 'Countess' } })
    expect(patched.contact.id).toBe(existing.id)
    expect(store.get('hijacked')).toBeNull()
  })

  it('rejects an invalid contact and an unknown id', async () => {
    await expect(methods.create({ contact: { emails: [{ value: 'not-an-email' }] } })).rejects.toMatchObject({
      code: ERRORS.INVALID,
    })
    await expect(methods.create({ contact: {} })).rejects.toMatchObject({ code: ERRORS.BAD_REQUEST })
    await expect(methods.get({ id: 'nope' })).rejects.toMatchObject({ code: ERRORS.NOT_FOUND })
    await expect(methods.update({ id: 'nope', patch: { company: 'x' } })).rejects.toMatchObject({
      code: ERRORS.NOT_FOUND,
    })
    await expect(methods.delete({})).rejects.toMatchObject({ code: ERRORS.BAD_REQUEST })
  })

  it('reports a storage failure as such, and retries on the next call', async () => {
    resetStore()
    const failing = createMethods({ store })
    window.puter.kv.list = async () => {
      throw new Error('offline')
    }
    await expect(failing.list({})).rejects.toMatchObject({ code: ERRORS.STORAGE })

    window.puter.kv.list = async () => []
    await expect(failing.list({})).resolves.toMatchObject({ total: 0 })
  })

  /**
   * The address book can be edited in a window this process cannot see — the
   * user's own Contacts window, while a headless instance serves the API — and
   * nothing tells us about it. An instance that answered from whatever it read
   * when it started is how a caller's autocomplete ends up missing someone who
   * was added minutes ago.
   */
  describe('freshness', () => {
    /** Add a contact the way another window would: straight to the cloud. */
    const addBehindOurBack = async (contact) => {
      const c = createContact(contact)
      await window.puter.kv.set(`contact:${c.id}`, c)
      return c
    }

    it('re-reads a book that has gone stale, so another window’s edit shows up', async () => {
      await addBehindOurBack({ firstName: 'Nadia', lastName: 'Khan', emails: [{ value: 'nadia@example.com' }] })

      // Just-read: the book in memory is the answer, edit or no edit.
      const fresh = await methods.list({})
      expect(fresh.total).toBe(4)

      // Past the freshness window, the same call goes back to the cloud.
      store.loadedAt = Date.now() - 60_000
      const stale = await methods.list({})
      expect(stale.total).toBe(5)
      expect(stale.contacts.map((c) => c.name)).toContain('Nadia Khan')
    })

    it('re-reads for suggest and search too, not just list', async () => {
      await addBehindOurBack({ firstName: 'Nadia', lastName: 'Khan', emails: [{ value: 'nadia@example.com' }] })
      store.loadedAt = Date.now() - 60_000
      const { suggestions } = await methods.suggest({ query: 'nadia' })
      expect(suggestions.map((s) => s.email)).toEqual(['nadia@example.com'])

      store.loadedAt = Date.now() - 60_000
      const found = await methods.search({ query: 'khan' })
      expect(found.total).toBe(1)
    })

    it('reads once for a burst of calls, so paging stays consistent', async () => {
      let reads = 0
      const inner = window.puter.kv.list
      window.puter.kv.list = async (...args) => {
        reads += 1
        return inner(...args)
      }
      store.loadedAt = Date.now() - 60_000
      const [a, b, c] = await Promise.all([
        methods.list({ limit: 2, offset: 0 }),
        methods.list({ limit: 2, offset: 2 }),
        methods.list({ limit: 2, offset: 4 }),
      ])
      expect(reads).toBe(1)
      expect([a.total, b.total, c.total]).toEqual([4, 4, 4])
    })

    it('answers from the book it has when the re-read fails', async () => {
      store.loadedAt = Date.now() - 60_000
      let reads = 0
      window.puter.kv.list = async () => {
        reads += 1
        throw new Error('offline')
      }
      // A stale answer beats an error: the caller's own request timeout is
      // shorter than our cloud timeout, and the book is still perfectly usable.
      const first = await methods.list({})
      expect(first.total).toBe(4)
      // The user's own window must not be pushed into an error state by a
      // background revalidation that failed.
      expect(store.error).toBeNull()

      // …and a cloud that just failed is not asked again on every single call.
      store.loadedAt = Date.now() - 60_000
      await methods.list({})
      expect(reads).toBe(1)
    })

    it('tries the cloud again once the retry window has passed', async () => {
      const stale = createMethods({ store, retryAfterMs: 0 })
      store.loadedAt = Date.now() - 60_000
      window.puter.kv.list = async () => {
        throw new Error('offline')
      }
      await expect(stale.list({})).resolves.toMatchObject({ total: 4 })

      window.puter.kv.list = async () => []
      store.loadedAt = Date.now() - 60_000
      await expect(stale.list({})).resolves.toMatchObject({ total: 0 })
    })
  })
})

describe('api/server', () => {
  let conn
  let methods

  beforeEach(() => {
    stubPuter()
    resetStore()
    store.loaded = true
    methods = createMethods({ store })
    conn = fakeConnection()
  })

  const request = (method, params, id = 'r1') =>
    conn.receive({ $: CHANNEL, v: PROTOCOL_VERSION, id, method, params })
  const replies = () => conn.sent.filter((m) => m.id)
  const lastReply = () => replies()[replies().length - 1]
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('announces itself with the methods the caller may use', () => {
    const server = startApiServer({ connection: conn, callerApp: 'calendar', methods })
    expect(server).not.toBeNull()
    expect(conn.sent[0]).toMatchObject({ $: CHANNEL, v: PROTOCOL_VERSION, type: 'ready' })
    expect(conn.sent[0].methods).toContain('suggest')
  })

  it('will not let the calendar change the address book', async () => {
    await seed([{ firstName: 'Ada', emails: [{ label: 'Work', value: 'ada@engine.io' }] }])
    const [ada] = store.all
    startApiServer({ connection: conn, callerApp: 'calendar', methods })

    for (const write of ['create', 'update', 'delete']) {
      request(write, { id: ada.id, patch: { firstName: 'Nope' }, contact: { firstName: 'Nope' } }, write)
    }
    await flush()

    // Refused the way an unknown method is, so the reply gives nothing away
    // about a surface this caller may not use.
    for (const write of ['create', 'update', 'delete']) {
      expect(replies().find((r) => r.id === write)).toMatchObject({
        ok: false,
        error: { code: ERRORS.UNKNOWN_METHOD },
      })
    }
    expect(store.all).toHaveLength(1)
    expect(store.get(ada.id).firstName).toBe('Ada')
  })

  it('refuses to listen at all for an app with no grant', () => {
    expect(startApiServer({ connection: conn, callerApp: 'evil', methods })).toBeNull()
    expect(conn.sent).toEqual([])
    expect(conn.listenerCount('message')).toBe(0)
  })

  it('answers a request with its result, keyed by the caller id', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods })
    request('ping', {}, 'abc')
    await flush()
    expect(lastReply()).toMatchObject({ id: 'abc', ok: true })
    expect(lastReply().result.app).toBe('contacts')
  })

  it('ignores traffic that is not a request on our channel', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods })
    conn.receive({ hello: 'there' })
    conn.receive({ $: 'other-app', id: 'x', method: 'ping' })
    conn.receive({ $: CHANNEL, method: 'ping' }) // no id to reply to
    await flush()
    expect(replies()).toEqual([])
  })

  it('reports an ungranted or unknown method the same way', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods: { ping: methods.ping } })
    request('drop_everything', {})
    await flush()
    expect(lastReply()).toMatchObject({ ok: false, error: { code: ERRORS.UNKNOWN_METHOD } })
  })

  it('rejects a protocol version it does not speak', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods })
    conn.receive({ $: CHANNEL, v: 99, id: 'v', method: 'ping', params: {} })
    await flush()
    expect(lastReply()).toMatchObject({ ok: false, error: { code: ERRORS.VERSION } })
  })

  it('turns a handler error into an error reply, with validation details', async () => {
    // `ai`, not `calendar`: this needs a caller granted a method that validates.
    startApiServer({ connection: conn, callerApp: 'ai', methods })
    request('create', { contact: { emails: [{ value: 'bad' }] } })
    await flush()
    expect(lastReply()).toMatchObject({ ok: false, error: { code: ERRORS.INVALID } })
    expect(lastReply().error.details).toHaveProperty('emails')
  })

  it('hides an unexpected failure behind a generic error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    startApiServer({
      connection: conn,
      callerApp: 'calendar',
      methods: {
        ping: async () => {
          throw new Error('secret internal detail')
        },
      },
    })
    request('ping', {})
    await flush()
    expect(lastReply().error.code).toBe(ERRORS.STORAGE)
    expect(JSON.stringify(lastReply())).not.toContain('secret internal detail')
    spy.mockRestore()
  })

  it('tells the caller when the address book changed, coalescing bursts', async () => {
    vi.useFakeTimers()
    startApiServer({
      connection: conn,
      callerApp: 'calendar',
      methods,
      subscribe: (fn) => store.subscribe(fn),
    })
    store.emit()
    store.emit()
    store.emit()
    await vi.advanceTimersByTimeAsync(400)
    expect(conn.sent.filter((m) => m.type === 'changed')).toHaveLength(1)
    vi.useRealTimers()
  })

  /**
   * `changed` is a promise that the book moved, and a caller acts on it by
   * re-reading everything. The store emits for more than that — a freshness
   * re-read that found nothing new, a search query typed into a window that is
   * also serving this API — and announcing those cost a caller a full re-read
   * for nothing, twice per launch.
   */
  describe('changed, gated on a revision', () => {
    const serve = () =>
      startApiServer({
        connection: conn,
        callerApp: 'calendar',
        methods,
        subscribe: (fn) => store.subscribe(fn),
        revision: () => store.revision(),
      })
    const notices = () => conn.sent.filter((m) => m.type === 'changed')

    it('says nothing when the first read loads the book', async () => {
      vi.useFakeTimers()
      resetStore() // as a freshly booted service instance: nothing read yet
      serve()
      await store.reload() // what ensureLoaded() does on the first request
      await vi.advanceTimersByTimeAsync(400)
      expect(notices()).toHaveLength(0)
      vi.useRealTimers()
    })

    it('says nothing when a re-read finds the same book', async () => {
      vi.useFakeTimers()
      await store.save(createContact({ firstName: 'Nadia' }))
      serve()
      await store.reload()
      await vi.advanceTimersByTimeAsync(400)
      await store.reload()
      await vi.advanceTimersByTimeAsync(400)
      expect(notices()).toHaveLength(0)
      vi.useRealTimers()
    })

    it('says nothing for UI-only state in a window that also serves the API', async () => {
      vi.useFakeTimers()
      serve()
      store.setUI({ query: 'nad' })
      store.setUI({ selectedId: 'anything' })
      await vi.advanceTimersByTimeAsync(400)
      expect(notices()).toHaveLength(0)
      vi.useRealTimers()
    })

    it('announces a write, and a change another window made', async () => {
      vi.useFakeTimers()
      serve()
      const saving = store.save(createContact({ firstName: 'Omar' }))
      await vi.advanceTimersByTimeAsync(400)
      await saving
      expect(notices()).toHaveLength(1)

      // Another window adds someone; our next freshness re-read picks it up.
      const c = createContact({ firstName: 'Nadia' })
      await window.puter.kv.set(`contact:${c.id}`, c)
      await store.reload()
      await vi.advanceTimersByTimeAsync(400)
      expect(notices()).toHaveLength(2)
      vi.useRealTimers()
    })

    it('stays quiet when an optimistic write rolls back inside the debounce', async () => {
      vi.useFakeTimers()
      serve()
      window.puter.kv.set = async () => {
        throw new Error('offline')
      }
      const failed = store.save(createContact({ firstName: 'Ghost' })).catch(() => {})
      await vi.advanceTimersByTimeAsync(400)
      await failed
      expect(notices()).toHaveLength(0)
      vi.useRealTimers()
    })

    it('announces every emit when no revision is available to compare', async () => {
      vi.useFakeTimers()
      startApiServer({
        connection: conn,
        callerApp: 'calendar',
        methods,
        subscribe: (fn) => store.subscribe(fn),
      })
      store.emit()
      await vi.advanceTimersByTimeAsync(400)
      expect(notices()).toHaveLength(1)
      vi.useRealTimers()
    })
  })

  it('stops listening when told to', async () => {
    const server = startApiServer({
      connection: conn,
      callerApp: 'calendar',
      methods,
      subscribe: (fn) => store.subscribe(fn),
    })
    server.stop()
    request('ping', {})
    await flush()
    expect(replies()).toEqual([])
    expect(store.listeners.size).toBe(0)
  })

  it('records activity so the host can idle out', async () => {
    const seen = []
    startApiServer({
      connection: conn,
      callerApp: 'calendar',
      methods,
      onActivity: (m) => seen.push(m),
    })
    request('ping', {})
    request('nope', {})
    await flush()
    expect(seen).toEqual(['ping'])
  })
})
