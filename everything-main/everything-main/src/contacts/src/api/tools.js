/**
 * The MCP tool surface, as data.
 *
 * Every tool is one entry here and nothing else: `method` names the methods.js
 * entry it dispatches to, and the dispatcher in mcp.js knows nothing about
 * contacts. That `method` is also what the caller's grant is checked against
 * (see grantedMethods in protocol.js), so a tool is only ever offered to an app
 * that was already allowed to call the method behind it — one access-control
 * rule, two protocols.
 *
 * Two things a descriptor carries that the app-to-app API never needed:
 *
 *   inputSchema — a model calls these cold, with only the schema and the
 *     description to go on. Where the schema is a nicer shape than the method's
 *     own params (a flat contact rather than `{ contact: {...} }`), `toParams`
 *     translates: the tool is shaped for the caller, the method is left alone.
 *
 *   render — the compact text an LLM reads. An MCP result carries both
 *     `content` (for the model) and `structuredContent` (for code). Putting JSON
 *     in the content block is correct but wasteful, and an address book is
 *     exactly the repetitive data where one line per person costs a fraction of
 *     the tokens and reads better. structuredContent still carries the very same
 *     object the app-to-app API returns, so nothing is lost.
 */
import { ADDRESS_LABELS, EMAIL_LABELS, PHONE_LABELS, URL_LABELS } from '../model.js'
// The one cap, so the schema a model reads can't drift from the one the method
// actually enforces.
import { DELETE_MAX } from './methods.js'

/* ---- schema helpers ------------------------------------------------------ */

const string = (description) => (description ? { type: 'string', description } : { type: 'string' })

/** An array of the { label, value } pairs the model uses for emails/phones/urls. */
function entries(labels, description) {
  return {
    type: 'array',
    description,
    items: {
      type: 'object',
      properties: {
        label: { type: 'string', enum: labels },
        value: { type: 'string' },
      },
      required: ['value'],
      additionalProperties: false,
    },
  }
}

/**
 * The fields a caller may write, as JSON Schema. This mirrors WRITABLE in
 * methods.js with one deliberate omission: `photo`. It is a data URL of a few
 * hundred KB, which is not something a language model should ever be generating
 * into a tool call. The app-to-app API can still set it.
 */
const CONTACT_PROPERTIES = {
  firstName: string('Given name.'),
  lastName: string('Family name.'),
  nickname: string('What they go by, if it differs from their first name.'),
  company: string('Employer or organisation.'),
  jobTitle: string('Role at that company.'),
  emails: entries(EMAIL_LABELS, 'Email addresses, most-used first.'),
  phones: entries(PHONE_LABELS, 'Phone numbers, most-used first.'),
  urls: entries(URL_LABELS, 'Websites and profile links.'),
  addresses: {
    type: 'array',
    description: 'Postal addresses, split into parts. Omit any part you do not know.',
    items: {
      type: 'object',
      properties: {
        label: { type: 'string', enum: ADDRESS_LABELS },
        street: string('Number, street name, and unit or suite.'),
        street2: string('Second address line, if any.'),
        city: string(),
        state: string('State, province, or region, as written locally.'),
        postalCode: string('ZIP or postcode.'),
        country: string(),
        poBox: string(),
      },
      additionalProperties: false,
    },
  },
  birthday: string('Date of birth as YYYY-MM-DD. Omit unless you know the year.'),
  notes: string('Free-form notes about this person.'),
  tags: { type: 'array', description: 'Short labels, e.g. "family", "clients".', items: { type: 'string' } },
  favorite: { type: 'boolean', description: 'Whether the user has starred this contact.' },
}

const SORT_ENUM = {
  type: 'string',
  enum: ['first', 'last', 'updated', 'created'],
  description: 'Sort order. Defaults to first name.',
}

/* ---- result rendering ---------------------------------------------------- */

/** One contact summary on one line, cheapest useful form. */
function summaryLine(c) {
  const bits = [c.name]
  if (c.subtitle && c.subtitle !== c.name) bits.push(c.subtitle)
  const email = (c.emails || [])[0]
  const phone = (c.phones || [])[0]
  if (email) bits.push(email.value)
  else if (phone) bits.push(phone.value)
  if (c.tags && c.tags.length) bits.push(c.tags.map((t) => `#${t}`).join(' '))
  return `${c.favorite ? '★ ' : ''}${bits.join(' · ')}  [${c.id}]`
}

/** A list result: a one-line header, then a line per contact. */
function renderList({ contacts, total }) {
  if (!contacts.length) return 'No matching contacts.'
  const header =
    contacts.length < total
      ? `${contacts.length} of ${total} contacts:`
      : `${total} contact${total === 1 ? '' : 's'}:`
  return [header, ...contacts.map(summaryLine)].join('\n')
}

function renderSuggestions({ suggestions, total }) {
  if (!suggestions.length) return 'No contacts with an email address matched.'
  const lines = suggestions.map((s) => {
    const extra = [s.label, s.company].filter(Boolean).join(', ')
    return `${s.name} <${s.email}>${extra ? ` (${extra})` : ''}  [${s.contactId}]`
  })
  const header =
    suggestions.length < total
      ? `${suggestions.length} of ${total} matching addresses:`
      : `${total} matching address${total === 1 ? '' : 'es'}:`
  return [header, ...lines].join('\n')
}

/** A whole contact, as a readable card rather than JSON. */
function renderContact({ contact: c }) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.nickname || c.company || 'No Name'
  const lines = [`${c.favorite ? '★ ' : ''}${name}  [${c.id}]`]
  const role = [c.jobTitle, c.company].filter(Boolean).join(' · ')
  if (role) lines.push(role)
  if (c.nickname && name !== c.nickname) lines.push(`Nickname: ${c.nickname}`)
  for (const e of c.emails || []) lines.push(`${e.label || 'Email'}: ${e.value}`)
  for (const p of c.phones || []) lines.push(`${p.label || 'Phone'}: ${p.value}`)
  for (const u of c.urls || []) lines.push(`${u.label || 'Link'}: ${u.value}`)
  for (const a of c.addresses || []) {
    const parts = [a.street, a.street2, a.city, a.state, a.postalCode, a.country].filter(Boolean)
    // "Work address", not "Work" — otherwise it reads exactly like a work email.
    if (parts.length) lines.push(`${a.label ? `${a.label} address` : 'Address'}: ${parts.join(', ')}`)
  }
  if (c.birthday) lines.push(`Birthday: ${c.birthday}`)
  if (c.tags && c.tags.length) lines.push(`Tags: ${c.tags.join(', ')}`)
  if (c.photo) lines.push('Has a photo.')
  if (c.notes) lines.push(`Notes: ${c.notes}`)
  return lines.join('\n')
}

/**
 * A delete result, in either of its two shapes: one contact, or a batch that
 * may have partly failed. The failures are what the model has to be told — the
 * ones it asked for and did not get are still in the address book.
 */
function renderDeleted({ id, deleted, failed }) {
  if (id) return `Deleted contact ${id}.`
  const done = `Deleted ${deleted.length} contact${deleted.length === 1 ? '' : 's'}.`
  if (!failed.length) return done
  const shown = failed.slice(0, 5).join(', ')
  const rest = failed.length > 5 ? ` and ${failed.length - 5} more` : ''
  return `${done} Still in the address book: ${shown}${rest}.`
}

/* ---- the tools ----------------------------------------------------------- */

/**
 * Annotations are hints to the host about what a tool does, so it can decide
 * what to run freely and what to put in front of the user first. They are hints,
 * not enforcement — the grant in protocol.js is the actual gate.
 */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

export const TOOLS = [
  {
    name: 'search_contacts',
    method: 'search',
    title: 'Search contacts',
    description:
      "Search the user's address book across every field — name, email, phone, company, job title, tags, notes and address. Use this first, and prefer it over listing everything. Returns lightweight summaries; each carries the contact id you need for get_contact, update_contact or delete_contact.",
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        query: string('What to look for. Matches anywhere in any field.'),
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Defaults to 50.' },
        favoritesOnly: { type: 'boolean', description: 'Only contacts the user has starred.' },
        tag: string('Only contacts carrying this tag.'),
        sort: SORT_ENUM,
      },
      additionalProperties: false,
    },
    render: renderList,
  },

  {
    name: 'list_contacts',
    method: 'list',
    title: 'List contacts',
    description:
      'Every contact in the address book, as summaries. Use this only when you genuinely need the whole book (counting, an overview, an export) — for finding someone, search_contacts is far cheaper.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'Defaults to 1000.' },
        offset: { type: 'integer', minimum: 0, description: 'Skip this many, for paging.' },
        sort: SORT_ENUM,
      },
      additionalProperties: false,
    },
    render: renderList,
  },

  {
    name: 'suggest_recipients',
    method: 'suggest',
    title: 'Suggest recipients',
    description:
      'Autocomplete for "who should this go to?" — one entry per email address, ranked by how well it matches, favorites first. Use this when you need an address to write to or invite, rather than a whole contact record. Contacts with no email address are left out.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        query: string('Partial name or address the user typed. Empty returns their most likely contacts.'),
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Defaults to 8.' },
      },
      additionalProperties: false,
    },
    render: renderSuggestions,
  },

  {
    name: 'get_contact',
    method: 'get',
    title: 'Get a contact',
    description:
      'One contact in full, including notes and every address — the fields the search results leave out. Takes an id from search_contacts or list_contacts.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { id: string('The contact id.') },
      required: ['id'],
      additionalProperties: false,
    },
    render: renderContact,
  },

  {
    name: 'create_contact',
    method: 'create',
    title: 'Add a contact',
    description:
      'Add a new person to the address book. Search first — people are often already here under a different spelling, and this always creates a new record rather than merging. Never invent details: leave out anything you were not told.',
    annotations: WRITES,
    inputSchema: {
      type: 'object',
      properties: CONTACT_PROPERTIES,
      additionalProperties: false,
    },
    toParams: (args) => ({ contact: args }),
    render: (result) => `Added:\n${renderContact(result)}`,
  },

  {
    name: 'update_contact',
    method: 'update',
    title: 'Edit a contact',
    description:
      'Change fields on an existing contact. Only the fields you pass are touched, but a list field you do pass (emails, phones, urls, addresses, tags) replaces the whole list — so read the contact first and send the full list back with your addition. Confirm with the user before overwriting anything.',
    annotations: WRITES,
    inputSchema: {
      type: 'object',
      properties: { id: string('The contact id.'), ...CONTACT_PROPERTIES },
      required: ['id'],
      additionalProperties: false,
    },
    toParams: ({ id, ...patch }) => ({ id, patch }),
    render: (result) => `Updated:\n${renderContact(result)}`,
  },

  {
    name: 'delete_contact',
    method: 'delete',
    title: 'Delete a contact',
    description:
      'Permanently remove a contact from the address book, or several at once by passing `ids` instead of `id` — one call rather than one per person. This cannot be undone. A batch containing an id that does not exist deletes nothing, so pass ids exactly as search_contacts or list_contacts gave them.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    // "Exactly one of id/ids" is stated in the descriptions rather than as a
    // top-level anyOf: the Anthropic Messages API rejects anyOf/oneOf/allOf at
    // the top level of a tool's input_schema, and this manifest is handed to it
    // verbatim. The method enforces the rule, and a model that gets it wrong
    // reads the error back (see the isError path in mcp.js).
    inputSchema: {
      type: 'object',
      properties: {
        id: string('The contact id, when removing one person. Pass this or `ids`, never both.'),
        ids: {
          type: 'array',
          description: 'Contact ids to remove together, when removing more than one. Pass this or `id`, never both.',
          items: { type: 'string' },
          maxItems: DELETE_MAX,
        },
      },
      additionalProperties: false,
    },
    render: renderDeleted,
  },
]

/** A tool as the wire sees it — the internal wiring (method, toParams, render)
 *  stays here. */
export function publicTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }
}
