// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { store } from '../store.js'
import { createContact } from '../model.js'
import { createMethods } from './methods.js'
import { startApiServer } from './server.js'
import { CHANNEL, PROTOCOL_VERSION, grantedMethods } from './protocol.js'
import {
  MCP_PROTOCOL_VERSION,
  buildManifest,
  contactIdFromUri,
  createMcp,
  isMcpMessage,
} from './mcp.js'
import { TOOLS } from './tools.js'

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
    receive: (msg) => {
      for (const fn of handlers.get('message') || []) fn(msg)
    },
  }
}

function resetStore() {
  store.contacts.clear()
  store.loaded = false
  store.loadedAt = 0
  store.error = null
  store.listeners.clear()
  store.ui.query = ''
  store.ui.tag = ''
  store.ui.favoritesOnly = false
  store.ui.selectedId = null
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('api/mcp', () => {
  let mcp
  let methods
  let ada

  /** Send one JSON-RPC request and return the reply. */
  const call = (method, params, id = 1) => mcp.handle({ jsonrpc: '2.0', id, method, params })
  /** Call a tool and return the raw tool result. */
  const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).result

  beforeEach(async () => {
    stubPuter()
    resetStore()
    methods = createMethods({ store })
    ada = createContact({
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      jobTitle: 'Founder',
      emails: [{ label: 'Work', value: 'ada@analytical.co' }],
      tags: ['pioneers'],
      favorite: true,
    })
    await store.save(ada)
    await store.save(
      createContact({
        firstName: 'Alan',
        lastName: 'Turing',
        company: 'Bletchley Park',
        emails: [{ label: 'Work', value: 'alan@bletchley.uk' }],
      }),
    )
    store.loaded = true
    store.loadedAt = Date.now()
    mcp = createMcp({ methods, granted: grantedMethods('ai') })
  })

  describe('handshake', () => {
    it('initializes, echoing a protocol version it speaks', async () => {
      const { result } = await call('initialize', {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'test-client', version: '1' },
      })
      expect(result.protocolVersion).toBe('2025-03-26')
      expect(result.serverInfo).toMatchObject({ name: 'contacts' })
      expect(result.capabilities.tools).toBeTruthy()
      expect(result.capabilities.resources).toBeTruthy()
      expect(result.instructions).toContain('address book')
    })

    it('answers an unknown protocol version with the one it prefers', async () => {
      const { result } = await call('initialize', { protocolVersion: '1999-01-01' })
      expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    })

    it('answers ping, and never replies to a notification', async () => {
      expect((await call('ping', {})).result).toEqual({})
      expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
      expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/whatever' })).toBeNull()
    })

    it('rejects a method it does not have', async () => {
      const res = await call('prompts/list', {})
      expect(res.error).toMatchObject({ code: -32601 })
    })
  })

  describe('tools', () => {
    it('lists every tool with a schema a model can call cold', async () => {
      const { result } = await call('tools/list', {})
      expect(result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
      for (const t of result.tools) {
        expect(t.description.length).toBeGreaterThan(20)
        expect(t.inputSchema.type).toBe('object')
        expect(t).not.toHaveProperty('method') // internal wiring stays internal
        expect(t).not.toHaveProperty('render')
      }
    })

    /**
     * A tool's schema is handed to the caller's model provider verbatim, and
     * the Anthropic Messages API rejects `anyOf`/`oneOf`/`allOf` at the top
     * level of an input_schema. One such schema fails *every* request that app
     * makes — not just a call to this tool — so an either/or rule belongs in
     * the description, with the method enforcing it.
     */
    it('keeps schema unions out of the top level of every inputSchema', () => {
      for (const tool of TOOLS) {
        for (const key of ['anyOf', 'oneOf', 'allOf']) {
          expect(tool.inputSchema, `${tool.name}.${key}`).not.toHaveProperty(key)
        }
      }
    })

    it('offers only the tools whose method the caller was granted', async () => {
      const readOnly = createMcp({ methods, granted: ['search', 'get'] })
      const { result } = await readOnly.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect(result.tools.map((t) => t.name)).toEqual(['search_contacts', 'get_contact'])
    })

    it('returns both a compact rendering and the exact structured result', async () => {
      const result = await tool('search_contacts', { query: 'bletchley' })
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('Alan Turing')
      expect(result.content[0].text).toContain('alan@bletchley.uk')
      // The text is a rendering, not JSON — that is the point of it.
      expect(result.content[0].text).not.toContain('{')
      // …and the structured half is byte-for-byte what the app-to-app API returns.
      expect(result.structuredContent).toEqual(await methods.search({ query: 'bletchley' }))
    })

    it('renders a whole contact as a card, not a blob', async () => {
      const { content } = await tool('get_contact', { id: ada.id })
      expect(content[0].text).toContain('Ada Lovelace')
      expect(content[0].text).toContain('Founder · Analytical Engines')
      expect(content[0].text).toContain('Work: ada@analytical.co')
      expect(content[0].text).toContain('Tags: pioneers')
    })

    it('suggests recipients one address at a time', async () => {
      const { content, structuredContent } = await tool('suggest_recipients', { query: 'a' })
      expect(content[0].text).toContain('<ada@analytical.co>')
      expect(structuredContent.suggestions[0].email).toBe('ada@analytical.co')
    })

    it('takes a flat contact for create, so a model never nests it', async () => {
      const { structuredContent } = await tool('create_contact', {
        firstName: 'Radia',
        lastName: 'Perlman',
        emails: [{ label: 'Work', value: 'radia@spanning.net' }],
      })
      expect(structuredContent.contact.firstName).toBe('Radia')
      expect(store.get(structuredContent.contact.id).lastName).toBe('Perlman')
    })

    it('takes a flat patch alongside the id for update', async () => {
      const { structuredContent } = await tool('update_contact', {
        id: ada.id,
        jobTitle: 'Mathematician',
      })
      expect(structuredContent.contact.jobTitle).toBe('Mathematician')
      expect(structuredContent.contact.company).toBe('Analytical Engines') // untouched
      expect(store.get(ada.id).jobTitle).toBe('Mathematician')
    })

    it('deletes a contact', async () => {
      const { content } = await tool('delete_contact', { id: ada.id })
      expect(content[0].text).toContain(ada.id)
      expect(store.get(ada.id)).toBeNull()
    })

    it('deletes a batch in one call, counting rather than listing them', async () => {
      const ids = store.all.map((c) => c.id)
      const { content, structuredContent } = await tool('delete_contact', { ids })
      expect(content[0].text).toBe('Deleted 2 contacts.')
      expect(structuredContent).toEqual({ deleted: ids, failed: [] })
      expect(store.all).toEqual([])
    })

    /** What the model has to be told: the ones it asked for and did not get. */
    it('names the contacts a batch could not delete', async () => {
      const [first, second] = store.all
      const del = window.puter.kv.del
      window.puter.kv.del = async (key) => {
        if (key.endsWith(second.id)) throw new Error('offline')
        return del(key)
      }
      const { content, isError } = await tool('delete_contact', { ids: [first.id, second.id] })
      expect(isError).toBeUndefined() // a partial delete is a result, not a failure
      expect(content[0].text).toContain('Deleted 1 contact.')
      expect(content[0].text).toContain(second.id)
    })

    it('tells the model a batch was rejected whole, so it can fix the ids', async () => {
      const ids = store.all.map((c) => c.id)
      const { content, isError } = await tool('delete_contact', { ids: [...ids, 'nope'] })
      expect(isError).toBe(true)
      expect(content[0].text).toContain('nope')
      expect(store.all).toHaveLength(2)
    })

    /**
     * The distinction that makes an agent able to recover: a bad *call* is a
     * protocol error the client handles, a bad *request* is a result the model
     * reads and retries.
     */
    it('reports a failed tool as a readable result, not a protocol error', async () => {
      const missing = await tool('get_contact', { id: 'nope' })
      expect(missing.isError).toBe(true)
      expect(missing.content[0].text).toContain('nope')

      const invalid = await tool('create_contact', { emails: [{ value: 'not-an-email' }] })
      expect(invalid.isError).toBe(true)
      expect(invalid.content[0].text).toContain('not a valid email address')
    })

    it('reports an unknown tool as a protocol error', async () => {
      const res = await call('tools/call', { name: 'drop_everything', arguments: {} })
      expect(res.error).toMatchObject({ code: -32602 })
      expect(res.result).toBeUndefined()
    })

    it('tells an ungranted caller nothing about the tools it cannot use', async () => {
      const readOnly = createMcp({ methods, granted: ['search'] })
      const res = await readOnly.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'delete_contact', arguments: { id: ada.id } },
      })
      // Identical to a tool that does not exist at all.
      expect(res.error).toMatchObject({ code: -32602 })
      expect(store.get(ada.id)).not.toBeNull()
    })

    it('hides an unexpected failure behind a generic error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const broken = createMcp({
        methods: {
          ...methods,
          search: async () => {
            throw new Error('secret internal detail')
          },
        },
        granted: grantedMethods('ai'),
      })
      const res = await broken.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_contacts', arguments: {} },
      })
      expect(res.error.code).toBe(-32603)
      expect(JSON.stringify(res)).not.toContain('secret internal detail')
      spy.mockRestore()
    })
  })

  describe('resources', () => {
    it('offers a template rather than enumerating the address book', async () => {
      expect((await call('resources/list', {})).result.resources).toEqual([])
      const { result } = await call('resources/templates/list', {})
      expect(result.resourceTemplates[0]).toMatchObject({
        uriTemplate: 'contact://{id}',
        mimeType: 'text/vcard',
      })
    })

    it('reads one contact as a vCard', async () => {
      const { result } = await call('resources/read', { uri: `contact://${ada.id}` })
      expect(result.contents[0].mimeType).toBe('text/vcard')
      expect(result.contents[0].text).toContain('BEGIN:VCARD')
      expect(result.contents[0].text).toContain('Lovelace')
    })

    it('rejects a URI that is not a contact', async () => {
      const res = await call('resources/read', { uri: 'file:///etc/passwd' })
      expect(res.error).toMatchObject({ code: -32602 })
    })

    it('withholds resources from a caller who may not read contacts', async () => {
      const noGet = createMcp({ methods, granted: ['search'] })
      expect(noGet.capabilities.resources).toBeUndefined()
      const listed = await noGet.handle({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list' })
      expect(listed.result.resourceTemplates).toEqual([])
      const read = await noGet.handle({
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/read',
        params: { uri: `contact://${ada.id}` },
      })
      expect(read.error).toMatchObject({ code: -32602 })
    })

    it('parses contact URIs and refuses anything else', () => {
      expect(contactIdFromUri('contact://abc')).toBe('abc')
      expect(contactIdFromUri('contact:///abc')).toBe('abc')
      expect(contactIdFromUri('contact://a%20b')).toBe('a b')
      expect(contactIdFromUri('contact://')).toBe('')
      expect(contactIdFromUri('https://example.com')).toBe('')
      expect(contactIdFromUri(null)).toBe('')
    })
  })

  describe('the published manifest', () => {
    it('matches what the code actually serves', () => {
      // Resolved from the project root: this file is served over http:// under
      // the DOM test environment, so import.meta.url is no use here.
      const onDisk = JSON.parse(readFileSync(resolve(process.cwd(), 'public/.well-known/mcp.json'), 'utf8'))
      // Out of date? Run `npm run manifest`.
      expect(onDisk).toEqual(buildManifest())
    })

    it('advertises the launch a client needs to reach us', () => {
      expect(buildManifest().transport.launch).toEqual({
        name: 'contacts',
        args: { service: 'mcp' },
        background: true,
      })
    })
  })
})

/**
 * One connection, two protocols. The app-to-app API is a published contract the
 * calendar app holds a copy of, so every one of these is really a test that
 * adding MCP left it alone.
 */
describe('api/server — both protocols on one connection', () => {
  let conn
  let methods

  beforeEach(async () => {
    stubPuter()
    resetStore()
    await store.save(createContact({ firstName: 'Ada', lastName: 'Lovelace', emails: [{ value: 'ada@analytical.co' }] }))
    store.loaded = true
    store.loadedAt = Date.now()
    methods = createMethods({ store })
    conn = fakeConnection()
  })

  const mcpSent = () => conn.sent.filter((m) => m.jsonrpc === '2.0')

  it('recognises MCP traffic and nothing else', () => {
    expect(isMcpMessage({ jsonrpc: '2.0', method: 'ping' })).toBe(true)
    expect(isMcpMessage({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false) // a reply, not a call
    expect(isMcpMessage({ $: CHANNEL, id: '1', method: 'ping' })).toBe(false)
    expect(isMcpMessage({ jsonrpc: '1.0', method: 'ping' })).toBe(false)
    expect(isMcpMessage(null)).toBe(false)
  })

  it('answers each caller in the protocol they wrote in', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods })

    conn.receive({ $: CHANNEL, v: PROTOCOL_VERSION, id: 'legacy-1', method: 'suggest', params: { query: 'ada' } })
    conn.receive({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'suggest_recipients', arguments: { query: 'ada' } } })
    await flush()

    const legacy = conn.sent.find((m) => m.id === 'legacy-1')
    expect(legacy).toMatchObject({ $: CHANNEL, v: PROTOCOL_VERSION, ok: true })
    expect(legacy.result.suggestions[0].email).toBe('ada@analytical.co')

    const mcp = conn.sent.find((m) => m.id === 7)
    expect(mcp.jsonrpc).toBe('2.0')
    expect(mcp.result.structuredContent.suggestions[0].email).toBe('ada@analytical.co')
  })

  it('still greets a caller the way it always has', () => {
    const server = startApiServer({ connection: conn, callerApp: 'calendar', methods })
    expect(conn.sent[0]).toMatchObject({ $: CHANNEL, v: PROTOCOL_VERSION, type: 'ready' })
    expect(mcpSent()).toEqual([])
    expect(server.tools).toContain('search_contacts')
  })

  it('serves no MCP to an app with no grant', () => {
    expect(startApiServer({ connection: conn, callerApp: 'evil', methods })).toBeNull()
    conn.receive({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(conn.sent).toEqual([])
  })

  it('never replies to an MCP notification', async () => {
    startApiServer({ connection: conn, callerApp: 'calendar', methods })
    conn.receive({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await flush()
    expect(mcpSent()).toEqual([])
  })

  it('announces a change in both dialects — but only to a caller that speaks both', async () => {
    vi.useFakeTimers()
    startApiServer({
      connection: conn,
      callerApp: 'calendar',
      methods,
      subscribe: (fn) => store.subscribe(fn),
    })

    // A caller that has only ever used the app-to-app protocol keeps hearing
    // exactly what it always heard.
    store.emit()
    await vi.advanceTimersByTimeAsync(400)
    expect(conn.sent.filter((m) => m.type === 'changed')).toHaveLength(1)
    expect(mcpSent()).toEqual([])

    // Once it speaks MCP, it gets the MCP spelling too.
    conn.receive({ jsonrpc: '2.0', id: 1, method: 'ping' })
    await vi.advanceTimersByTimeAsync(0)
    store.emit()
    await vi.advanceTimersByTimeAsync(400)
    expect(conn.sent.filter((m) => m.type === 'changed')).toHaveLength(2)
    expect(mcpSent().filter((m) => m.method === 'notifications/resources/list_changed')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('counts MCP traffic as activity, so a service instance stays alive', async () => {
    const seen = []
    startApiServer({ connection: conn, callerApp: 'calendar', methods, onActivity: (m) => seen.push(m) })
    conn.receive({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await flush()
    expect(seen).toEqual(['tools/list'])
  })

  it('stops answering both protocols when told to', async () => {
    const server = startApiServer({ connection: conn, callerApp: 'calendar', methods })
    server.stop()
    conn.receive({ jsonrpc: '2.0', id: 1, method: 'ping' })
    conn.receive({ $: CHANNEL, v: PROTOCOL_VERSION, id: 'x', method: 'ping', params: {} })
    await flush()
    expect(conn.sent.filter((m) => m.id !== undefined)).toEqual([])
  })
})
