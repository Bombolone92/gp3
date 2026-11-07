/**
 * Contacts as an MCP server.
 *
 * The Model Context Protocol (https://modelcontextprotocol.io) is JSON-RPC 2.0
 * with a fixed vocabulary — `initialize`, `tools/list`, `tools/call`,
 * `resources/read` — that AI clients already speak. This module is that
 * vocabulary and nothing else: it is transport-free (no postMessage, no
 * AppConnection) in exactly the way methods.js is, so `handle(message)` is a
 * plain async function and every case below is unit-testable. server.js is what
 * puts it on a connection.
 *
 * It adds no third source of truth. Tools come from tools.js, they dispatch to
 * the same methods.js table the app-to-app API uses, and they are filtered by
 * the same per-app grant (protocol.js). An app allowed to call `search` gets
 * `search_contacts`; an app allowed nothing never reaches this file at all.
 *
 * Two error paths, and the difference matters. A *protocol* failure — unknown
 * method, unknown tool — is a JSON-RPC error, because the client got the call
 * wrong. A *tool* failure — no such contact, invalid email — comes back as a
 * normal result with `isError: true`, because the model got it wrong and is the
 * one who can fix it; a JSON-RPC error would be swallowed by the client's
 * plumbing and never reach the model that needs to read it.
 */
import { contactToVCard } from '../vcard.js'
import { ApiError } from './protocol.js'
import { TOOLS, publicTool } from './tools.js'

export const JSONRPC = '2.0'

/** What we tell a client we speak. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** Versions we will accept if the client asks for one of them by name. A client
 *  asking for anything else is answered with our preferred version and decides
 *  for itself whether to continue — which is what the spec asks for. */
export const MCP_PROTOCOL_VERSIONS = ['2026-01-26', '2025-06-18', '2025-03-26']

export const MCP_SERVER_NAME = 'contacts'
export const MCP_SERVER_VERSION = '1.0.0'

/** The URI template for a single contact as a vCard. */
export const CONTACT_URI_TEMPLATE = 'contact://{id}'

/** Standard JSON-RPC 2.0 error codes. */
export const RPC_ERRORS = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

/**
 * What an agent should know before its first call. Hosts put this in the model's
 * context, so it is the cheapest place to prevent the two failure modes that
 * actually happen: duplicate people, and invented details.
 */
export const MCP_INSTRUCTIONS = `This is the signed-in user's own private address book.

Search before you add — the same person is often already here under a different spelling, and create_contact never merges. Contact ids come back from search_contacts and list_contacts; pass one to get_contact, or read contact://<id> for a vCard.

Never invent contact details. If you were not told someone's phone number, leave the field out rather than guessing. Ask the user to confirm before update_contact, naming the person you are about to change.`

/** An error the client should see as a JSON-RPC failure. */
class RpcError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** True when `msg` is JSON-RPC — which is how a connection carrying both this
 *  and the app-to-app protocol tells them apart. */
export function isMcpMessage(msg) {
  return Boolean(msg && typeof msg === 'object' && msg.jsonrpc === JSONRPC && typeof msg.method === 'string')
}

/** JSON-RPC calls an id of null or absent a notification: no reply, ever. */
function isNotification(msg) {
  return msg.id === undefined || msg.id === null
}

/** The contact id in `contact://<id>`, or '' if that isn't what this URI is. */
export function contactIdFromUri(uri) {
  const m = /^contact:\/\/\/?(.+)$/.exec(str(uri).trim())
  return m ? decodeURIComponent(m[1]) : ''
}

/**
 * Build the MCP server for one caller.
 *
 * @param {object} deps
 * @param {Record<string, Function>} deps.methods the method table (createMethods)
 * @param {string[]} deps.granted the methods this caller may use (grantedMethods)
 * @returns {{ handle: (msg: object) => Promise<object|null>, tools: object[], capabilities: object }}
 *   `handle` resolves to the reply to post back, or null for a notification.
 */
export function createMcp({ methods, granted = [] }) {
  const grantedSet = new Set(granted)
  const tools = TOOLS.filter((t) => grantedSet.has(t.method) && typeof methods[t.method] === 'function')
  const byName = new Map(tools.map((t) => [t.name, t]))

  // A contact resource is a contact read, so it rides on the same grant. An app
  // that may not call `get` is not offered resources at all.
  const canRead = grantedSet.has('get') && typeof methods.get === 'function'

  const capabilities = {
    tools: { listChanged: false },
    ...(canRead ? { resources: { listChanged: true, subscribe: false } } : {}),
  }

  const handlers = {
    initialize(params) {
      const asked = str(params.protocolVersion)
      return {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities,
        serverInfo: { name: MCP_SERVER_NAME, title: 'Contacts', version: MCP_SERVER_VERSION },
        instructions: MCP_INSTRUCTIONS,
      }
    },

    ping() {
      return {}
    },

    'tools/list'() {
      return { tools: tools.map(publicTool) }
    },

    async 'tools/call'(params) {
      const tool = byName.get(str(params.name))
      // Unknown *to this caller* and unknown *entirely* are one answer, for the
      // same reason the app-to-app API conflates them: the reply must not tell
      // an app about a tool it may not use.
      if (!tool) throw new RpcError(RPC_ERRORS.INVALID_PARAMS, `Unknown tool "${str(params.name)}"`)
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
      try {
        const result = await methods[tool.method](tool.toParams ? tool.toParams(args) : args)
        return {
          content: [{ type: 'text', text: tool.render(result) }],
          structuredContent: result,
        }
      } catch (err) {
        if (!(err instanceof ApiError)) throw err
        // Back to the model, not to the plumbing: it can read this and retry.
        const detail = err.details ? ` (${Object.values(err.details).join(' ')})` : ''
        return {
          content: [{ type: 'text', text: `${err.message}${detail}` }],
          isError: true,
        }
      }
    },

    'resources/list'() {
      // Deliberately empty. A thousand contacts as a thousand resource entries
      // is a listing no client wants and no model can afford to read; the
      // template below plus search_contacts is the same capability at a
      // fraction of the cost.
      return { resources: [] }
    },

    'resources/templates/list'() {
      if (!canRead) return { resourceTemplates: [] }
      return {
        resourceTemplates: [
          {
            uriTemplate: CONTACT_URI_TEMPLATE,
            name: 'contact',
            title: 'Contact (vCard)',
            description:
              'One contact as a vCard 3.0, by id. Ids come from search_contacts and list_contacts.',
            mimeType: 'text/vcard',
          },
        ],
      }
    },

    async 'resources/read'(params) {
      const uri = str(params.uri)
      const id = canRead ? contactIdFromUri(uri) : ''
      if (!id) throw new RpcError(RPC_ERRORS.INVALID_PARAMS, `Unknown resource "${uri}"`)
      const { contact } = await methods.get({ id })
      return { contents: [{ uri, mimeType: 'text/vcard', text: contactToVCard(contact) }] }
    },
  }

  async function handle(msg) {
    const notification = isNotification(msg)
    const handler = Object.prototype.hasOwnProperty.call(handlers, msg.method) ? handlers[msg.method] : null

    // Unknown notifications (`notifications/initialized`, `notifications/cancelled`)
    // are not errors — they are things we simply have nothing to do about.
    if (!handler) {
      return notification
        ? null
        : error(msg.id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method "${str(msg.method)}"`)
    }

    try {
      const params = msg.params && typeof msg.params === 'object' ? msg.params : {}
      const result = await handler(params)
      return notification ? null : { jsonrpc: JSONRPC, id: msg.id, result }
    } catch (err) {
      if (notification) return null
      if (err instanceof RpcError) return error(msg.id, err.code, err.message)
      if (err instanceof ApiError) return error(msg.id, RPC_ERRORS.INTERNAL_ERROR, err.message)
      // Don't leak internals to another app; the details stay in our console.
      console.error('[contacts-mcp]', msg.method, err)
      return error(msg.id, RPC_ERRORS.INTERNAL_ERROR, 'The request could not be completed')
    }
  }

  return { handle, tools, capabilities }
}

function error(id, code, message) {
  return { jsonrpc: JSONRPC, id, error: { code, message } }
}

/**
 * The static manifest published at /.well-known/mcp.json, so a client can read
 * what Contacts offers — every tool, with its schema — without launching it.
 * Booting a hidden app window just to ask "what can you do?" is the cost this
 * removes, and it is the difference between an agent listing one app's tools
 * and listing twenty.
 *
 * It advertises the whole catalogue; the grant is applied when a caller
 * actually connects, so what a given app sees may be a subset of this.
 *
 * Kept in sync by `npm run manifest`, and guarded by a test that fails the
 * build if the checked-in file drifts from this function.
 */
export function buildManifest() {
  return {
    name: MCP_SERVER_NAME,
    title: 'Contacts',
    version: MCP_SERVER_VERSION,
    description: "The signed-in Puter user's private address book.",
    protocolVersion: MCP_PROTOCOL_VERSION,
    // Contacts is not a network service: it is reached by launching the app
    // inside the Puter desktop and talking to the AppConnection you get back.
    transport: {
      type: 'puter-app-connection',
      launch: { name: MCP_SERVER_NAME, args: { service: 'mcp' }, background: true },
    },
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: true, subscribe: false },
    },
    instructions: MCP_INSTRUCTIONS,
    tools: TOOLS.map(publicTool),
    resourceTemplates: [
      {
        uriTemplate: CONTACT_URI_TEMPLATE,
        name: 'contact',
        title: 'Contact (vCard)',
        mimeType: 'text/vcard',
      },
    ],
  }
}
