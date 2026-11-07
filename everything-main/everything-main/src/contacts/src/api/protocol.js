/**
 * Wire protocol and access control for the Contacts app-to-app API.
 *
 * Contacts exposes a small RPC surface to *other Puter apps* over an
 * AppConnection (https://docs.puter.com/Objects/AppConnection/). A caller
 * launches us with `puter.ui.launchApp('contacts', { service: 'contacts-api' })`
 * and then talks to the returned connection with `postMessage`; we answer on the
 * connection we get back from `puter.ui.parentApp()`.
 *
 * ── Access control ───────────────────────────────────────────────────────────
 * The address book is private data, so the API is closed by default: only the
 * apps in ALLOWED_CALLERS may use it, and each one only gets the methods its
 * entry grants. The caller's identity is NOT taken from the message — a caller
 * could claim anything — but from the `puter.source_app.name` query parameter,
 * which the Puter desktop stamps onto our iframe URL from the *calling
 * process*. An app cannot set it for a window it did not launch, and cannot
 * change ours after the fact.
 *
 * Residual limitation, stated plainly: the iframe/postMessage model gives a
 * child no way to cryptographically verify its parent, so these checks hold
 * inside a genuine Puter desktop session (the environment they're written for)
 * and are not a defence against a page that embeds this app itself and forges
 * launch parameters. The env guard in `readLaunchContext` is what keeps the API
 * from being served on the open web at all.
 *
 * NOTE: the calendar app carries a copy of the constants below (CHANNEL,
 * PROTOCOL_VERSION, SERVICE_ARG, method names). They are a published contract
 * between two repos — change them together, and bump PROTOCOL_VERSION when the
 * shape changes incompatibly.
 */

/** Marker on every message, so unrelated postMessage traffic is ignored. */
export const CHANNEL = 'contacts-api'

/** Bumped only for incompatible changes to the message shape. */
export const PROTOCOL_VERSION = 1

/** `args.service` value that asks Contacts to boot as a headless API server. */
export const SERVICE_ARG = 'contacts-api'

/**
 * Every `args.service` value that asks for a headless boot. `mcp` is the name a
 * client that knows nothing about Contacts specifically would use — an AI app
 * launching whichever apps advertise an MCP manifest shouldn't have to learn a
 * different magic word per app. Both land on the same server, which answers
 * whichever protocol each message is written in (see server.js).
 *
 * Keep `contacts-api` first and permanent: it is the value the calendar app has
 * a copy of. index.html matches this list too, to hide the window before the
 * bundle loads.
 */
export const SERVICE_ARGS = [SERVICE_ARG, 'mcp']

/** Every method the API can expose. */
export const METHODS = [
  'ping',
  'list',
  'search',
  'suggest',
  'get',
  'create',
  'update',
  'delete',
]

/** Methods that only read. Everything else mutates the user's address book. */
export const READ_METHODS = ['ping', 'list', 'search', 'suggest', 'get']

/**
 * Which apps may call us, and what each may do. `'*'` grants every method in
 * METHODS; an array grants exactly those methods. Keys are Puter app *names*
 * (as published, e.g. `calendar` for calendar.puter.com).
 *
 * This is the only gate, and it governs both protocols: a grant is a set of
 * methods, and an MCP tool is offered only when the method behind it is granted
 * (see tools.js). So an agent given read access gets the searching tools and is
 * told nothing about the editing ones:
 *
 *   assistant: READ_METHODS,
 *
 * Give write access only to an app that will put a change in front of the user
 * before making it — an agent acting on someone's words is a looser thing than
 * the calendar filling in a guest list.
 */
export const ALLOWED_CALLERS = {
  // The calendar reads the address book to suggest guests as they are typed. It
  // has never written a contact and has no reason to: an app that puts a name
  // in a guest field is not one that should be able to rename or delete the
  // person behind it. Granting the reads and nothing else is how that is said
  // out loud — and it mirrors what the calendar grants us in return, which is
  // exactly the five methods Contacts uses.
  calendar: READ_METHODS,
  // The AI app is the agent case above, and it meets the condition: every tool
  // the server marks as writing is put in front of the user — named, not by id —
  // before it runs. Drop this to READ_METHODS to take the writing tools away.
  ai: '*',
}

export const ERRORS = {
  FORBIDDEN: 'forbidden',
  UNKNOWN_METHOD: 'unknown_method',
  BAD_REQUEST: 'bad_request',
  NOT_FOUND: 'not_found',
  INVALID: 'invalid',
  STORAGE: 'storage_error',
  VERSION: 'unsupported_version',
}

/** An error a handler can throw to control the code the caller sees. */
export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    if (details) this.details = details
  }
}

/** The methods `appName` is allowed to call, or [] for an app with no grant. */
export function grantedMethods(appName, allowed = ALLOWED_CALLERS) {
  const grant = allowed[String(appName || '')]
  if (grant === '*') return [...METHODS]
  if (Array.isArray(grant)) return grant.filter((m) => METHODS.includes(m))
  return []
}

/**
 * Read who launched us and how, from the launch parameters the Puter desktop
 * put on our URL (see the access-control note above).
 *
 * @returns {{ callerApp: string, serviceMode: boolean, inPuterApp: boolean }}
 */
export function readLaunchContext(win = typeof window !== 'undefined' ? window : undefined) {
  const empty = { callerApp: '', serviceMode: false, inPuterApp: false }
  if (!win) return empty
  const puter = win.puter
  // `env === 'app'` means we're an app window inside the Puter desktop, which
  // is the only place an AppConnection exists. On the open web (or in the
  // desktop's own GUI context) there is no parent app and no API to serve.
  const inPuterApp = Boolean(puter && puter.env === 'app')
  if (!inPuterApp) return empty

  let callerApp = ''
  try {
    const params = new URLSearchParams(win.location.search)
    callerApp = (params.get('puter.source_app.name') || '').trim().toLowerCase()
  } catch (_e) {
    /* no readable location — treat as an unidentified caller */
  }

  const args = (puter && puter.args) || {}
  return { callerApp, serviceMode: SERVICE_ARGS.includes(args.service), inPuterApp }
}

/** True when `msg` looks like a request on our channel. */
export function isRequest(msg) {
  return Boolean(
    msg &&
      typeof msg === 'object' &&
      msg.$ === CHANNEL &&
      typeof msg.method === 'string' &&
      typeof msg.id === 'string',
  )
}
