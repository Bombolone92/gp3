// Formatting + escaping helpers (pure functions, no DOM dependency).

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape a string for safe interpolation into innerHTML. */
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/** Escape a value for use inside an HTML attribute value. */
export function escapeAttr(value) {
  return escapeHtml(value)
}

/** Strip everything but digits and a leading +, for use in tel: links. */
export function telHref(phone) {
  // A "+" is only valid at the very start of a tel: number (RFC 3966) — one
  // anywhere else (a typo, or "ext+12" notation) would make the URI invalid.
  const cleaned = String(phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
  return `tel:${cleaned}`
}

/**
 * Tidy display for North American (NANP) numbers as (xxx) xxx-xxxx. Anything
 * else — international numbers, short codes, vanity numbers — is returned
 * exactly as the user entered it.
 */
export function formatPhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/[a-z]/i.test(raw)) return raw // vanity numbers / extensions: leave alone
  const plus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  let national
  let prefix = ''
  if (!plus && digits.length === 10) {
    national = digits
  } else if (digits.length === 11 && digits[0] === '1') {
    national = digits.slice(1)
    prefix = plus ? '+1 ' : '1 '
  } else {
    return raw
  }
  return `${prefix}(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

/** Normalize a user-entered URL to an absolute, safe http(s) href. */
export function normalizeUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  // Reject anything that looks like another scheme (javascript:, data:, etc.).
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return ''
  return `https://${raw}`
}

/** A short, human label for a URL (host without the leading www.). */
export function displayUrl(url) {
  const normalized = normalizeUrl(url)
  if (!normalized) return String(url || '')
  try {
    return new URL(normalized).host.replace(/^www\./, '') + new URL(normalized).pathname.replace(/\/$/, '')
  } catch (_e) {
    return String(url || '')
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Format a YYYY-MM-DD birthday as "Month D" or "Month D, YYYY". */
export function formatBirthday(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!m) return String(value || '')
  const [, year, month, day] = m
  const monthName = MONTHS[Number(month) - 1] || ''
  const base = `${monthName} ${Number(day)}`
  // Year 0000 (or absent) is a common "no year" convention from vCards.
  return year === '0000' ? base : `${base}, ${year}`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * When something on the calendar happens, from the reader's point of view:
 * "Today · 3:00 PM", "Tomorrow", "Thursday · 9:30 AM", "May 4", "May 4, 2027".
 *
 * Near dates are named rather than dated — for anything in the next week that
 * is what a person actually wants to know — and the year appears only when it
 * isn't this one. An all-day event gets no clock time, because it has none.
 */
export function formatWhen(ms, { allDay = false, now = Date.now() } = {}) {
  const at = new Date(Number(ms) || 0)
  const today = new Date(now)
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(at) - midnight(today)) / 86_400_000)

  let day
  if (days === 0) day = 'Today'
  else if (days === 1) day = 'Tomorrow'
  else if (days > 1 && days < 7) day = WEEKDAYS[at.getDay()]
  else {
    day = `${MONTHS[at.getMonth()]} ${at.getDate()}`
    if (at.getFullYear() !== today.getFullYear()) day += `, ${at.getFullYear()}`
  }
  if (allDay) return day

  let time
  try {
    time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch (_e) {
    time = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
  }
  return `${day} · ${time}`
}

/** Compact "added/updated" relative time, e.g. "2 days ago". */
export function relativeTime(ts, now = Date.now()) {
  const diff = Math.max(0, now - Number(ts || 0))
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (sec < 45) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const yr = Math.round(day / 365)
  return `${yr} year${yr === 1 ? '' : 's'} ago`
}

let _baseCollator
function baseEquals(a, b) {
  if (!_baseCollator) _baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' })
  return _baseCollator.compare(a, b) === 0
}

/**
 * First letter (uppercased) used for the alphabetical section header.
 * Accented and stroked letters file under the base letter the locale-aware
 * sort groups them with ("Émile" → E, "Østergaard" → O), instead of spilling
 * into a stray "#" section in the middle of the list.
 */
export function sectionLetter(name) {
  const first = String(name || '').trim().charAt(0)
  if (!first) return '#'
  const ch = first.toUpperCase()
  if (/[A-Z]/.test(ch)) return ch
  const stripped = ch.normalize('NFD').replace(/\p{M}/gu, '').charAt(0)
  if (/[A-Z]/.test(stripped)) return stripped
  // Letters with no decomposition (Ø, Đ, …): ask the collator which section
  // the sort files them under.
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (baseEquals(ch, letter)) return letter
  }
  return '#'
}
