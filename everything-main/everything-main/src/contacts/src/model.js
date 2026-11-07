// Pure contact model: shape, normalization, validation, and derived fields.
// Kept free of any I/O so it can be unit-tested and reused anywhere.

export const EMAIL_LABELS = ['Personal', 'Work', 'Other']
export const PHONE_LABELS = ['Mobile', 'Home', 'Work', 'Main', 'Other']
export const URL_LABELS = ['Website', 'Work', 'Blog', 'Other']
export const ADDRESS_LABELS = ['Home', 'Work', 'Other']

// A loose-but-useful email check. Deliberately not RFC-exhaustive: it should
// accept anything a person would reasonably type and reject obvious mistakes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Coerce an arbitrary array of {label,value} entries into a clean array.
// Empty values are dropped; labels and values are trimmed.
function normalizeEntries(arr, fallbackLabel) {
  if (!Array.isArray(arr)) return []
  return arr
    .map((e) => {
      if (e == null) return null
      if (typeof e === 'string') return { label: fallbackLabel, value: e.trim() }
      return { label: str(e.label).trim() || fallbackLabel, value: str(e.value).trim() }
    })
    .filter((e) => e && e.value)
}

// Structured postal addresses. Accepts the canonical shape, migrates the older
// freeform { label, value } shape, and drops addresses with no real content.
function normalizeAddresses(arr) {
  if (!Array.isArray(arr)) return []
  return arr
    .map((a) => {
      if (a == null) return null
      if (typeof a === 'string') {
        return { label: '', country: '', street: a.trim(), street2: '', city: '', state: '', postalCode: '', poBox: '' }
      }
      // Migrate legacy freeform addresses into the street field.
      if (a.value !== undefined && a.street === undefined) {
        return { label: str(a.label).trim(), country: '', street: str(a.value).trim(), street2: '', city: '', state: '', postalCode: '', poBox: '' }
      }
      return {
        label: str(a.label).trim(),
        country: str(a.country).trim(),
        street: str(a.street).trim(),
        street2: str(a.street2).trim(),
        city: str(a.city).trim(),
        state: str(a.state).trim(),
        postalCode: str(a.postalCode).trim(),
        poBox: str(a.poBox).trim(),
      }
    })
    .filter((a) => a && (a.street || a.street2 || a.city || a.state || a.postalCode || a.poBox))
}

/**
 * Coerce tags into a clean array: accepts a comma-separated string or an
 * array, trims entries, and drops empties and case-insensitive duplicates
 * (keeping the first spelling encountered).
 */
export function normalizeTags(tags) {
  let list = tags
  if (typeof tags === 'string') list = tags.split(',')
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const t of list) {
    const tag = str(t).trim()
    const key = tag.toLowerCase()
    if (tag && !seen.has(key)) {
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}

/**
 * Bring any raw object (e.g. read back from KV) into the canonical contact
 * shape. Always returns a fresh object with every field present.
 */
export function normalizeContact(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    id: str(c.id) || uid(),
    firstName: str(c.firstName).trim(),
    lastName: str(c.lastName).trim(),
    nickname: str(c.nickname).trim(),
    company: str(c.company).trim(),
    jobTitle: str(c.jobTitle).trim(),
    emails: normalizeEntries(c.emails, 'Personal'),
    phones: normalizeEntries(c.phones, 'Mobile'),
    urls: normalizeEntries(c.urls, 'Website'),
    addresses: normalizeAddresses(c.addresses),
    birthday: str(c.birthday).trim(),
    notes: str(c.notes),
    tags: normalizeTags(c.tags),
    photo: str(c.photo).trim(),
    favorite: Boolean(c.favorite),
    createdAt: Number(c.createdAt) || Date.now(),
    updatedAt: Number(c.updatedAt) || Date.now(),
  }
}

/** Create a brand-new contact from a partial, assigning id/timestamps. */
export function createContact(partial = {}) {
  const now = Date.now()
  return normalizeContact({ ...partial, id: partial.id || uid(), createdAt: now, updatedAt: now })
}

/** Human-readable name with sensible fallbacks. */
export function displayName(c) {
  if (!c) return 'No Name'
  const full = `${str(c.firstName)} ${str(c.lastName)}`.trim()
  if (full) return full
  if (c.nickname) return c.nickname
  if (c.company) return c.company
  if (c.emails && c.emails[0]) return c.emails[0].value
  if (c.phones && c.phones[0]) return c.phones[0].value
  return 'No Name'
}

/** Secondary line shown under the name in the list (role @ company / email). */
export function subtitle(c) {
  if (!c) return ''
  if (c.jobTitle && c.company) return `${c.jobTitle} · ${c.company}`
  if (c.company) return c.company
  if (c.jobTitle) return c.jobTitle
  if (c.emails && c.emails[0]) return c.emails[0].value
  if (c.phones && c.phones[0]) return c.phones[0].value
  return ''
}

export function isValidEmail(value) {
  return EMAIL_RE.test(str(value).trim())
}

/**
 * Validate a contact prior to saving.
 * Returns { valid, errors } where errors maps field -> message.
 */
export function validateContact(input) {
  const c = normalizeContact(input)
  const errors = {}

  const hasIdentity =
    c.firstName || c.lastName || c.company || c.nickname || c.emails.length || c.phones.length
  if (!hasIdentity) {
    errors.general = 'Add at least a name, email, phone, or company.'
  }

  const badEmail = c.emails.find((e) => !isValidEmail(e.value))
  if (badEmail) errors.emails = `"${badEmail.value}" is not a valid email address.`

  if (c.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(c.birthday)) {
    errors.birthday = 'Use the date picker for the birthday.'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

/** The KV key under which a contact is stored. */
export function contactKey(id) {
  return `contact:${id}`
}
