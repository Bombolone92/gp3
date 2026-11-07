/**
 * The Contacts API's method implementations, over the same reactive store the
 * UI uses. Kept transport-free (no postMessage, no AppConnection) so every
 * method is a plain async function of its params and can be unit-tested.
 *
 * Two shapes leave this module:
 *   - a *summary*, for anything that returns a list. Cheap to send: no photo
 *     (they are data URLs and can be hundreds of KB) and no notes.
 *   - the *full* contact, for get/create/update — exactly what the store holds.
 */
import { createContact, normalizeContact, validateContact, displayName, subtitle } from '../model.js'
import { filterContacts, sortContacts, matchesQuery, SORT_KEYS } from '../search.js'
import { ApiError, ERRORS, METHODS } from './protocol.js'

const LIST_LIMIT_DEFAULT = 1000
const LIST_LIMIT_MAX = 5000
const SEARCH_LIMIT_DEFAULT = 50
const SUGGEST_LIMIT_DEFAULT = 8
const SMALL_LIMIT_MAX = 200

/** How many contacts one `delete` call may remove. A bound on the blast radius
 *  of a single mistaken call, in the spirit of the read limits above. */
export const DELETE_MAX = 500

/**
 * How old the in-memory address book may be when a request arrives before we
 * re-read it from the cloud.
 *
 * This matters because of how the API is served: an instance can stay open for
 * minutes (a headless service instance, or the user's own window when it serves
 * the caller that launched it), while the *user* edits their contacts in a
 * different window. Nothing tells this process about that. Without an age bound,
 * a caller that asked for the book two minutes ago and asks again now would get
 * the identical stale answer — the calendar's guest autocomplete missing someone
 * just added is exactly that bug.
 *
 * The window is short enough that "I added them a moment ago" always works, and
 * long enough that a burst of calls (paging through `list`, a client warming its
 * cache) costs one read, not one per request — which also keeps `offset` paging
 * consistent, since the book can't be re-read between two pages of one sweep.
 */
const FRESH_MS = 10_000

/** After a failed re-read, how long we keep answering from the book we have
 *  before trying the cloud again. */
const FAILED_RETRY_MS = 15_000

/** Fields a caller may write. Anything else in a patch is ignored, so `id` and
 *  the timestamps can never be steered from outside. */
const WRITABLE = [
  'firstName',
  'lastName',
  'nickname',
  'company',
  'jobTitle',
  'emails',
  'phones',
  'urls',
  'addresses',
  'birthday',
  'notes',
  'tags',
  'photo',
  'favorite',
]

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/** Trimmed, blank-free, de-duplicated, in the order the caller gave them. */
function idsFrom(list) {
  const out = []
  const seen = new Set()
  for (const value of list) {
    const id = str(value).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** A few ids, quoted, for an error message that must not run to 500 of them. */
function idList(ids, max = 5) {
  const shown = ids.slice(0, max).map((id) => `"${id}"`).join(', ')
  return ids.length > max ? `${shown} and ${ids.length - max} more` : shown
}

/** The list-friendly projection of a contact. */
export function toSummary(c) {
  return {
    id: c.id,
    name: displayName(c),
    subtitle: subtitle(c),
    firstName: c.firstName,
    lastName: c.lastName,
    company: c.company,
    jobTitle: c.jobTitle,
    emails: (c.emails || []).map((e) => ({ label: e.label, value: e.value })),
    phones: (c.phones || []).map((p) => ({ label: p.label, value: p.value })),
    tags: [...(c.tags || [])],
    favorite: Boolean(c.favorite),
    hasPhoto: Boolean(c.photo),
    updatedAt: c.updatedAt,
  }
}

/** Keep only the writable fields a caller actually supplied. */
function pickWritable(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const key of WRITABLE) {
    if (input[key] !== undefined) out[key] = input[key]
  }
  return out
}

/**
 * Rank a contact against a query for autocomplete. Lower is better:
 *   0 — a name or email address starts with the query (including a later word
 *       of the name, so "khan" ranks "Nadia Khan" as a strong hit)
 *   1 — the name or email contains it
 *   2 — matched on something else entirely (company, tag, notes, …)
 */
function suggestRank(name, email, q) {
  const n = name.toLowerCase()
  const e = email.toLowerCase()
  if (n.startsWith(q) || e.startsWith(q)) return 0
  if (n.split(/\s+/).some((word) => word.startsWith(q))) return 0
  if (n.includes(q) || e.includes(q)) return 1
  return 2
}

function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/**
 * Build the API's method table.
 *
 * @param {object} deps
 * @param {object} deps.store the app's contact store
 * @param {() => number} [deps.now]
 */
export function createMethods({
  store,
  now = () => Date.now(),
  freshMs = FRESH_MS,
  retryAfterMs = FAILED_RETRY_MS,
}) {
  let loading = null
  let failedAt = 0 // when a re-read last failed, so we don't retry it per call

  /**
   * Make sure the store holds an address book we're willing to answer from:
   * read from the cloud at least once, and no older than `freshMs` (see the note
   * on FRESH_MS — a long-lived instance cannot see another window's writes any
   * other way). Concurrent callers share one read.
   *
   * A re-read that fails is only fatal when there is nothing to fall back on. If
   * we already hold a book, the caller gets it: a slightly stale answer beats an
   * error, and beats making them wait out our cloud timeout — theirs is shorter
   * than ours, so a doomed read is also not retried on every request.
   */
  async function ensureLoaded() {
    if (store.isFresh(freshMs)) return
    const canFallBack = store.loadedAt > 0
    if (canFallBack && failedAt && now() - failedAt < retryAfterMs) return
    if (!loading) {
      // reload(), not load(): if this read fails we answer from the book we have
      // (below), so it must not leave the user's own window showing an error.
      loading = store
        .reload()
        .then(
          () => {
            failedAt = 0
          },
          (err) => {
            failedAt = now()
            throw err
          },
        )
        .finally(() => {
          loading = null
        })
    }
    try {
      await loading
    } catch (err) {
      if (canFallBack) return
      throw new ApiError(ERRORS.STORAGE, `Could not read contacts: ${err.message}`)
    }
  }

  function requireContact(id) {
    const c = store.get(str(id).trim())
    if (!c) throw new ApiError(ERRORS.NOT_FOUND, `No contact with id "${str(id)}"`)
    return c
  }

  async function persist(contact) {
    try {
      return await store.save(contact)
    } catch (err) {
      throw new ApiError(ERRORS.STORAGE, `Could not save the contact: ${err.message}`)
    }
  }

  const methods = {
    /** Cheap liveness/capability probe; also the handshake a client can await. */
    async ping() {
      return { app: 'contacts', methods: [...METHODS], time: now() }
    },

    /**
     * The whole address book, as summaries. This is what a client should use to
     * hold its own snapshot for instant local filtering.
     * @param {{ limit?: number, offset?: number, sort?: string }} params
     */
    async list({ limit, offset, sort } = {}) {
      await ensureLoaded()
      const sortKey = SORT_KEYS.includes(sort) ? sort : 'first'
      const all = sortContacts(store.all, sortKey)
      const from = Math.max(0, Math.floor(Number(offset) || 0))
      const take = clampLimit(limit, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX)
      return {
        contacts: all.slice(from, from + take).map(toSummary),
        total: all.length,
        offset: from,
      }
    },

    /**
     * Full-text search over every contact field — the same matching the app's
     * own search box uses.
     * @param {{ query?: string, limit?: number, favoritesOnly?: boolean, tag?: string, sort?: string }} params
     */
    async search({ query, limit, favoritesOnly, tag, sort } = {}) {
      await ensureLoaded()
      const sortKey = SORT_KEYS.includes(sort) ? sort : 'first'
      const matched = filterContacts(store.all, {
        query: str(query),
        favoritesOnly: Boolean(favoritesOnly),
        tag: str(tag),
      })
      const take = clampLimit(limit, SEARCH_LIMIT_DEFAULT, SMALL_LIMIT_MAX)
      return {
        contacts: sortContacts(matched, sortKey).slice(0, take).map(toSummary),
        total: matched.length,
      }
    },

    /**
     * Autocomplete for a "who's coming?" field: one entry per *email address*,
     * ranked by how well it matches. Contacts with no email address are left
     * out — there would be nothing to invite.
     *
     * One entry per address, not per contact-and-address: two people who share
     * a mailbox would otherwise both be offered, and picking either invites the
     * same address — a choice with no difference behind it. Which of them keeps
     * it is settled by sorting the pool first, the same order `list` returns, so
     * the answer is the same on every call and the same as what a caller
     * building its own index from `list` would arrive at.
     *
     * @param {{ query?: string, limit?: number }} params
     */
    async suggest({ query, limit } = {}) {
      await ensureLoaded()
      const q = str(query).trim().toLowerCase()
      const take = clampLimit(limit, SUGGEST_LIMIT_DEFAULT, SMALL_LIMIT_MAX)
      const matched = q ? store.all.filter((c) => matchesQuery(c, q)) : store.all
      const pool = sortContacts(matched, 'first')

      const seen = new Set()
      const entries = []
      for (const c of pool) {
        const name = displayName(c)
        let pos = 0
        for (const e of c.emails || []) {
          const email = str(e.value).trim().toLowerCase()
          if (!email || seen.has(email)) continue
          seen.add(email)
          entries.push({
            contactId: c.id,
            name,
            email,
            label: e.label || '',
            company: c.company,
            favorite: Boolean(c.favorite),
            rank: q ? suggestRank(name, email, q) : 0,
            // Where this address sits on its contact, so a person's several
            // addresses keep the order they were entered in rather than being
            // shuffled by the alphabetical tiebreak below.
            pos: pos++,
          })
        }
      }

      entries.sort(
        (a, b) =>
          a.rank - b.rank ||
          Number(b.favorite) - Number(a.favorite) ||
          byName(a, b) ||
          a.pos - b.pos ||
          a.email.localeCompare(b.email),
      )
      return {
        suggestions: entries.slice(0, take).map(({ rank: _rank, pos: _pos, ...rest }) => rest),
        total: entries.length,
      }
    },

    /** One contact, in full (photo and notes included). */
    async get({ id } = {}) {
      await ensureLoaded()
      if (!str(id).trim()) throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required')
      return { contact: requireContact(id) }
    },

    /**
     * Add a contact. Any `id` or timestamps in the payload are ignored — a
     * create always mints a new contact, so it can never overwrite one.
     * @param {{ contact?: object }} params
     */
    async create({ contact } = {}) {
      await ensureLoaded()
      const fields = pickWritable(contact)
      if (!Object.keys(fields).length) {
        throw new ApiError(ERRORS.BAD_REQUEST, '`contact` is required')
      }
      const { valid, errors } = validateContact(fields)
      if (!valid) throw new ApiError(ERRORS.INVALID, 'The contact is not valid', errors)
      return { contact: await persist(createContact(fields)) }
    },

    /**
     * Patch an existing contact. Only the fields present in `patch` change;
     * array fields (emails, phones, …) are replaced wholesale.
     * @param {{ id?: string, patch?: object }} params
     */
    async update({ id, patch } = {}) {
      await ensureLoaded()
      if (!str(id).trim()) throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required')
      const existing = requireContact(id)
      const fields = pickWritable(patch)
      if (!Object.keys(fields).length) {
        throw new ApiError(ERRORS.BAD_REQUEST, '`patch` must set at least one field')
      }
      const merged = normalizeContact({ ...existing, ...fields, id: existing.id })
      const { valid, errors } = validateContact(merged)
      if (!valid) throw new ApiError(ERRORS.INVALID, 'The contact is not valid', errors)
      return { contact: await persist(merged) }
    },

    /**
     * Remove one contact (`id`) or a batch of them (`ids`, up to DELETE_MAX).
     * Deleting an id that isn't there is an error, not a silent success, so a
     * caller can tell the two apart — and for a batch that check runs over the
     * whole list first: if any id is unknown, nothing is deleted at all. A
     * caller working from a stale list of ids gets its mistake back intact
     * rather than a half-applied delete it now has to reconstruct.
     *
     * The result follows the parameter rather than the count, so a caller always
     * knows which shape it will get: `{ id }` answers `{ deleted: true, id }` as
     * it always has, and `{ ids }` answers with two lists. A batch is a delete
     * per contact, so the cloud can fail partway through and leave some gone and
     * some not; `failed` is how the caller learns which, and only a batch that
     * deleted nothing at all is raised as an error.
     * @param {{ id?: string, ids?: string[] }} params
     */
    async delete({ id, ids } = {}) {
      await ensureLoaded()
      if (id !== undefined && ids !== undefined) {
        throw new ApiError(ERRORS.BAD_REQUEST, 'Pass either `id` or `ids`, not both')
      }

      if (ids === undefined) {
        if (!str(id).trim()) {
          throw new ApiError(ERRORS.BAD_REQUEST, '`id` is required (or `ids`, to delete several)')
        }
        const existing = requireContact(id)
        try {
          await store.remove(existing.id)
        } catch (err) {
          throw new ApiError(ERRORS.STORAGE, `Could not delete the contact: ${err.message}`)
        }
        return { deleted: true, id: existing.id }
      }

      if (!Array.isArray(ids)) throw new ApiError(ERRORS.BAD_REQUEST, '`ids` must be an array')
      const wanted = idsFrom(ids)
      if (!wanted.length) throw new ApiError(ERRORS.BAD_REQUEST, '`ids` must name at least one contact')
      if (wanted.length > DELETE_MAX) {
        throw new ApiError(
          ERRORS.BAD_REQUEST,
          `Delete at most ${DELETE_MAX} contacts at a time (asked for ${wanted.length})`,
        )
      }
      const missing = wanted.filter((each) => !store.get(each))
      if (missing.length) {
        throw new ApiError(
          ERRORS.NOT_FOUND,
          missing.length === 1
            ? `No contact with id ${idList(missing)}`
            : `No contacts with ids ${idList(missing)} — nothing was deleted`,
        )
      }

      try {
        await store.removeMany(wanted)
      } catch (err) {
        throw new ApiError(ERRORS.STORAGE, `Could not delete the contacts: ${err.message}`)
      }
      // removeMany absorbs a per-contact failure and leaves that contact in the
      // book, so what's still there is exactly what didn't get deleted.
      const failed = wanted.filter((each) => store.get(each))
      const deleted = wanted.filter((each) => !store.get(each))
      if (!deleted.length) {
        throw new ApiError(ERRORS.STORAGE, `Could not delete ${idList(failed)}`)
      }
      return { deleted, failed }
    },
  }

  return methods
}
