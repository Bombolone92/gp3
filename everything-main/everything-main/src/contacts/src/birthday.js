// Turning a contact's birthday into a calendar event, and recognizing one we
// put there before. Pure — no DOM, no connection — so the exact shape of what
// we would write to someone's calendar is testable on its own.
//
// A birthday is stored as YYYY-MM-DD, often with the vCard "no year" convention
// (0000) when only the day is known. What goes on the calendar is an all-day
// event that repeats every year, anchored at the next one to come: the calendar
// is a forward-looking thing, and a series anchored decades back would put a
// person's whole life on it to say when to send a card. The birth year, when we
// know it, is written into the description instead — the one place a repeating
// event can carry something that doesn't repeat.
import { displayName } from './model.js'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** { month: 1-12, day: 1-31, year: number|null }, or null if unusable. */
export function parseBirthday(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // A day that doesn't exist in that month (2 Feb 31st) is a typo we can't fix.
  if (day > new Date(year || 2024, month, 0).getDate()) return null
  return { month, day, year: year > 0 ? year : null }
}

/** The event title for a contact's birthday. Also the key we match on when
 *  looking for one we already added — so it has to be derived the same way
 *  every time, from the same name the app shows everywhere else. */
export function birthdayTitle(contact) {
  return `${displayName(contact)}’s birthday`
}

/**
 * Local midnight on the next occurrence of this month/day: this year while it
 * is still to come (today counts — a birthday is not over until the day is),
 * otherwise next year.
 *
 * Feb 29 is the interesting case: in a common year there is no such date, and
 * `new Date(2027, 1, 29)` would silently roll into March 1. We step to the next
 * year that actually has the day instead, so the series is anchored on a real
 * Feb 29 and the calendar's yearly rule can do what it does with it.
 */
export function nextBirthday({ month, day }, now = Date.now()) {
  const today = new Date(now)
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  // Eight years is the longest gap between two Feb 29ths (a century year that
  // isn't a leap year, e.g. 2096 → 2104); everything else lands on the first or
  // second pass.
  for (let year = today.getFullYear(); year <= today.getFullYear() + 8; year++) {
    if (new Date(year, month, 0).getDate() < day) continue // no such date this year
    const start = new Date(year, month - 1, day).getTime()
    if (start >= midnight) return start
  }
  return null
}

/**
 * The event to put on the calendar for `contact`, or null when the contact has
 * no usable birthday. `end` is the last millisecond of the same day, which is
 * how the calendar spells a one-day all-day event.
 */
export function buildBirthdayEvent(contact, now = Date.now()) {
  const parsed = parseBirthday(contact && contact.birthday)
  if (!parsed) return null
  const start = nextBirthday(parsed, now)
  if (start == null) return null
  const startDate = new Date(start)
  const end = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    23, 59, 59, 999,
  ).getTime()
  return {
    title: birthdayTitle(contact),
    description: parsed.year ? `Born in ${parsed.year}` : '',
    start,
    end,
    allDay: true,
    color: 'pink',
    recurrence: { freq: 'yearly' },
  }
}

/** Same day and month (any year) — "is this the birthday we meant?". */
export function sameDayOfYear(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/**
 * Find, among a calendar's search results, the birthday event we would have
 * created for this contact. Matching on the title is what makes "add" safe to
 * press twice: the search is already narrowed to that exact phrase, and an
 * all-day yearly event carrying it is either ours or near enough that a second
 * copy would be worse than reusing it.
 *
 * Returns the matching event, or null.
 */
export function findBirthdayEvent(events, title) {
  const wanted = String(title || '').trim().toLowerCase()
  if (!wanted) return null
  return (
    (events || []).find(
      (e) =>
        e &&
        e.allDay &&
        e.recurring &&
        String(e.title || '').trim().toLowerCase() === wanted,
    ) || null
  )
}

/** Human date for a toast: "May 4". */
export function formatDayOfYear(ms) {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
