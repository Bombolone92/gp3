/**
 * What Contacts does with the Calendar app, and nothing more.
 *
 * Two things earn their place here, both of them things an address book cannot
 * answer on its own:
 *
 *   1. "Add birthday to Calendar" — Contacts is where a birthday is written
 *      down and the calendar is where it needs to be seen. The event is all-day,
 *      repeats yearly, and is added from an explicit menu action with a toast
 *      and an Undo, so nothing lands in someone's calendar unannounced.
 *   2. "What's coming up with this person" — the reciprocal of the guest
 *      suggestions Contacts already gives the Calendar. It appears on the
 *      contact card when there is something to show, and is silently absent
 *      otherwise.
 *
 * Everything else the Calendar API offers is deliberately unused: an address
 * book has no business listing someone's whole calendar, and the grant we hold
 * says so (see calendar.puter.com/src/js/api/protocol.js).
 *
 * The connection is opened lazily and closed again seconds after the last call.
 * Where there is no Puter desktop — the open web, or a user without the
 * Calendar app — every function here is inert: the menu item is not offered,
 * and the card shows no upcoming section.
 */
import { createCalendar, BIRTHDAY_WINDOW_DAYS } from '../calendar.js'
import { toast, progressToast } from '../toast.js'
import { track } from '../analytics.js'
import {
  buildBirthdayEvent,
  findBirthdayEvent,
  formatDayOfYear,
  sameDayOfYear,
} from '../birthday.js'

const DAY_MS = 86_400_000

/** How long an answer about one contact's upcoming events is reused. Short: it
 *  costs a round trip to a *live* calendar, and a stale "nothing coming up" on
 *  a card someone is looking at is worse than asking again. */
const UPCOMING_TTL_MS = 2 * 60 * 1000

/** Upper bound on remembered contacts, so a long browsing session doesn't grow
 *  an unbounded map. Well past what anyone clicks through in one sitting. */
const UPCOMING_MAX = 200

let client = null
let checked = false // have we already worked out whether a client is possible?
let generation = 0 // bumped when the calendar changes, to drop in-flight answers
let onUpdate = null
/** key (`contactId|emails`) -> { at, events: object[]|null }. `null` events mean
 *  "we asked and couldn't get an answer" — cached the same way, so an
 *  unreachable calendar costs one attempt per contact per TTL, not one per
 *  render. */
const upcoming = new Map()
const inFlight = new Set()

/** The client, created on first use — but only where another app can be talked
 *  to at all, so nothing is allocated (and the answer is only worked out once)
 *  on the open web, where this is asked on every render. */
function ensureClient() {
  if (checked) return client
  checked = true
  const created = createCalendar()
  if (!created.supported()) return null
  client = created
  // A write of ours is the one calendar change we can hear about; when it
  // lands, whatever the card is showing is out of date.
  client.onChange(() => {
    generation++
    expireAll()
    if (onUpdate) onUpdate()
  })
  return client
}

/**
 * Mark every remembered answer as due for a re-read, without forgetting what it
 * said.
 *
 * Clearing the map instead would be the obvious thing and is wrong: the render
 * this schedules calls `upcomingFor` synchronously, which would find nothing,
 * return null, and take the whole section off the card — then put it back a
 * round trip later. Someone who just added a birthday would watch their own
 * event's section blink out and in. Expiring keeps the last answer on screen
 * while the fresh one is fetched, which is what every other read here does.
 */
function expireAll() {
  for (const entry of upcoming.values()) entry.at = 0
}

/** True where the Calendar app can be reached at all — the test for whether to
 *  offer a calendar action in the UI. */
export function calendarSupported() {
  return Boolean(ensureClient())
}

/**
 * Start listening. `onUpdate` is called when an answer lands that the UI should
 * re-render for; the app passes its render function.
 */
export function initCalendar({ onUpdate: hook } = {}) {
  onUpdate = typeof hook === 'function' ? hook : null
}

/**
 * What a cached answer would draw, so a re-read that changed nothing doesn't
 * cost a render.
 *
 * Every field the card actually shows goes in — see `upcomingSection` in
 * ui/detail.js, which draws the title and the time, and reads `allDay` to
 * decide how to write that time. The id and start alone missed a retitled
 * event entirely: the answer was replaced correctly and then judged identical,
 * so the card kept the old title until something else re-rendered it.
 */
function signature(entry) {
  const events = entry && entry.events
  if (!events) return ''
  // The title is length-prefixed: it is the one field that can hold anything,
  // separator characters included.
  return events
    .map((e) => {
      const title = e.title || ''
      return [e.id, e.start, e.allDay ? 1 : 0, title.length, title].join('|')
    })
    .join('\n')
}

/** Every address on a contact, lowercased — how the calendar recognizes them. */
function addressesOf(contact) {
  return (contact.emails || [])
    .map((e) => String(e.value || '').trim().toLowerCase())
    .filter(Boolean)
}

/**
 * The next few events involving `contact`, for the contact card. Synchronous by
 * design — it returns what we already know and starts a read for what we don't,
 * calling back through `onUpdate` when that lands, so a render never waits on
 * another app.
 *
 * @returns {object[]|null} events, or null when we have nothing to show
 */
export function upcomingFor(contact) {
  if (!contact) return null
  const emails = addressesOf(contact)
  if (!emails.length) return null // nothing to look them up by
  const cal = ensureClient()
  if (!cal) return null

  const key = `${contact.id}|${emails.join(',')}`
  const known = upcoming.get(key)
  if (known && Date.now() - known.at < UPCOMING_TTL_MS) return known.events

  if (!inFlight.has(key)) {
    inFlight.add(key)
    const asOf = generation
    // Never rejects (see the client), so there is nothing to catch and nothing
    // that can reach a render.
    cal.upcomingWith(emails).then((events) => {
      inFlight.delete(key)
      // The calendar changed while we were asking: this answer describes a
      // calendar that no longer exists, so drop it rather than cache it. The
      // entry it would have replaced is still marked for re-reading, so ask for
      // a render — otherwise a card nobody touches keeps the older answer with
      // nothing left in flight to correct it.
      if (asOf !== generation) {
        if (onUpdate) onUpdate()
        return
      }
      const before = signature(upcoming.get(key))
      if (upcoming.size >= UPCOMING_MAX) upcoming.clear()
      upcoming.set(key, { at: Date.now(), events })
      // Only disturb the UI when the answer changes what it would draw.
      if (onUpdate && signature({ events }) !== before) onUpdate()
    })
  }
  // Serve what we had while the read runs, rather than blinking the section out.
  return known ? known.events : null
}

/**
 * Put a contact's birthday on the calendar as an all-day yearly event.
 *
 * Pressing this twice is safe and says so: we look for the event we would have
 * created before creating one. If it is already there on the right day, nothing
 * happens; if the contact's birthday has been corrected since, the existing
 * series is moved rather than joined by a second, contradictory one.
 */
export async function addBirthdayToCalendar(contact) {
  const cal = ensureClient()
  if (!cal) return
  const event = buildBirthdayEvent(contact)
  if (!event) {
    toast('That birthday isn’t a date we can add', 'error')
    return
  }

  // Launching another app takes a moment; say something if it is a slow one.
  const progress = progressToast('Adding to your calendar…')
  try {
    const from = Date.now()
    const found = findBirthdayEvent(
      await cal.search({
        query: event.title,
        from,
        to: from + BIRTHDAY_WINDOW_DAYS * DAY_MS,
        limit: 20,
      }),
      event.title,
    )

    if (found && sameDayOfYear(found.start, event.start)) {
      progress.done()
      toast(`Already in your calendar on ${formatDayOfYear(found.start)}`, 'info')
      return
    }

    if (found) {
      // The birthday was corrected in Contacts after the event was added: move
      // the series (its id, not the occurrence's) instead of adding a rival.
      await cal.update(found.seriesId || found.id, {
        start: event.start,
        end: event.end,
        description: event.description,
      })
      progress.done()
      toast(`Birthday moved to ${formatDayOfYear(event.start)} in your calendar`, 'success')
      track('Birthday Updated in Calendar')
      return
    }

    const created = await cal.create(event)
    progress.done()
    track('Birthday Added to Calendar')
    toast(`Added to your calendar on ${formatDayOfYear(event.start)}`, 'success', 6000, {
      label: 'Undo',
      onClick: () => removeBirthday(cal, created),
    })
  } catch (err) {
    console.warn('[contacts] could not reach the calendar:', err && err.message)
    toast('Could not reach your calendar', 'error')
  } finally {
    progress.done()
  }
}

/** Undo an add: take back exactly the event we just created. */
async function removeBirthday(cal, created) {
  if (!created || !created.id) return
  try {
    await cal.remove(created.id)
    toast('Removed from your calendar', 'success')
  } catch (_e) {
    toast('Could not remove it from your calendar', 'error')
  }
}

/** Forget everything and close any open connection (sign-out, teardown). */
export function disposeCalendar() {
  if (client) client.dispose()
  client = null
  checked = false
  generation++
  onUpdate = null
  upcoming.clear()
  inFlight.clear()
}
