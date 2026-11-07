// @vitest-environment happy-dom
//
// The two things Contacts actually does with the Calendar app, driven against a
// stubbed Calendar service: adding a birthday (without ever adding it twice),
// and asking what is coming up with the contact on screen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addBirthdayToCalendar,
  calendarSupported,
  disposeCalendar,
  initCalendar,
  upcomingFor,
} from './calendar.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Stand-in for the Calendar app: records requests and answers them from
 *  `answer`, which is given the request message. */
function stubCalendar({ env = 'app', answer = () => ({ ok: true, result: { events: [] } }) } = {}) {
  const listeners = new Map()
  const state = { launches: 0, requests: [], closed: false }
  const emit = (msg) => {
    for (const fn of [...(listeners.get('message') || [])]) fn(msg)
  }
  const connection = {
    usesSDK: true,
    postMessage(msg) {
      state.requests.push(msg)
      setTimeout(() => {
        const reply = answer(msg)
        if (reply) emit({ $: 'calendar-api', v: 1, id: msg.id, ...reply })
      }, 0)
    },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
    },
    off: (event, fn) => listeners.get(event)?.delete(fn),
    close: () => {
      state.closed = true
    },
  }
  window.puter = {
    env,
    ui: {
      launchApp: async () => {
        state.launches++
        setTimeout(() => emit({ $: 'calendar-api', v: 1, type: 'ready', methods: ['search'] }), 0)
        return connection
      },
    },
  }
  /** The Calendar telling us it changed under us. */
  state.changed = () => emit({ $: 'calendar-api', v: 1, type: 'changed' })
  return state
}

const ada = {
  id: 'c1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  birthday: '1815-12-10',
  emails: [{ label: 'Work', value: 'ada@analytical.co' }],
}

/** Wait for the client to launch, answer, and land its result. */
const settle = () => sleep(20)

beforeEach(() => {
  disposeCalendar()
})

afterEach(() => {
  disposeCalendar()
  delete window.puter
  document.body.innerHTML = ''
})

describe('upcomingFor', () => {
  it('asks the Calendar once per contact and re-renders when the answer lands', async () => {
    const events = [{ id: 'e1', title: 'Design review', start: Date.now() + 3600_000 }]
    const calendar = stubCalendar({ answer: () => ({ ok: true, result: { events } }) })
    const render = vi.fn()
    initCalendar({ onUpdate: render })

    // The first pass has nothing to draw and starts a read.
    expect(upcomingFor(ada)).toBeNull()
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
    expect(upcomingFor(ada)).toEqual(events)
    // Drawing it again is free: no second launch, no second request.
    upcomingFor(ada)
    await settle()
    expect(calendar.launches).toBe(1)
    expect(calendar.requests).toHaveLength(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('never launches anything for a contact there is nothing to ask about', async () => {
    const calendar = stubCalendar()
    initCalendar({ onUpdate: () => {} })
    expect(upcomingFor(null)).toBeNull()
    expect(upcomingFor({ id: 'c2', firstName: 'Nobody' })).toBeNull() // no email
    await settle()
    expect(calendar.launches).toBe(0)
  })

  it('is inert on the open web, where there is no app to launch', async () => {
    const calendar = stubCalendar({ env: 'web' })
    initCalendar({ onUpdate: () => {} })
    expect(calendarSupported()).toBe(false)
    expect(upcomingFor(ada)).toBeNull()
    await settle()
    expect(calendar.launches).toBe(0)
  })

  it('shows nothing, and says nothing, when the Calendar cannot answer', async () => {
    const render = vi.fn()
    stubCalendar({ answer: () => ({ ok: false, error: { message: 'nope' } }) })
    initCalendar({ onUpdate: render })
    expect(upcomingFor(ada)).toBeNull()
    await settle()
    expect(upcomingFor(ada)).toBeNull()
    // Nothing changed on screen, so nothing was re-rendered for.
    expect(render).not.toHaveBeenCalled()
  })

  it('keeps the answer on screen while a `changed` notice is revalidated', async () => {
    const events = [{ id: 'e1', title: 'Design review', start: Date.now() + 3600_000 }]
    const calendar = stubCalendar({ answer: () => ({ ok: true, result: { events } }) })
    // Every render draws whatever upcomingFor() gives it, which is exactly what
    // the app's own render does.
    const drawn = []
    initCalendar({ onUpdate: () => drawn.push(upcomingFor(ada)) })

    upcomingFor(ada)
    await settle()
    expect(upcomingFor(ada)).toEqual(events)

    calendar.changed()
    await settle()
    // The notice re-read the calendar...
    expect(calendar.requests).toHaveLength(2)
    // ...without the section ever having nothing to draw in between.
    expect(drawn.length).toBeGreaterThan(1)
    expect(drawn).not.toContain(null)
    expect(upcomingFor(ada)).toEqual(events)
  })

  it('re-renders when an event was retitled but not moved', async () => {
    // The card draws the title and the time (see ui/detail.js). An event kept
    // its id and its start, so an answer that differed only in the title used
    // to compare equal — and the card went on showing the old one.
    let title = 'Design review'
    const calendar = stubCalendar({
      answer: () => ({
        ok: true,
        result: { events: [{ id: 'e1', title, start: 1_800_000_000_000, allDay: false }] },
      }),
    })
    const render = vi.fn(() => upcomingFor(ada)) // what the app's render does
    initCalendar({ onUpdate: render })

    upcomingFor(ada)
    await settle()
    expect(render).toHaveBeenCalledTimes(1) // the first answer landed
    expect(upcomingFor(ada)[0].title).toBe('Design review')

    title = 'Design review (moved rooms)'
    calendar.changed()
    await settle()

    // Two renders: one for the notice, one for the new answer it fetched. The
    // second is the one an id-and-start fingerprint misses.
    expect(render).toHaveBeenCalledTimes(3)
    expect(upcomingFor(ada)[0].title).toBe('Design review (moved rooms)')
  })

  it('asks again when a change lands while we were already asking', async () => {
    const events = [{ id: 'e1', title: 'Design review', start: Date.now() + 3600_000 }]
    let calendar
    let first = true
    calendar = stubCalendar({
      answer: (msg) => {
        // The calendar moves between our question and its answer, so the answer
        // we are about to be given already describes a calendar that is gone.
        if (msg.method === 'search' && first) {
          first = false
          calendar.changed()
        }
        return { ok: true, result: { events } }
      },
    })
    // What the app's own render does.
    initCalendar({ onUpdate: () => upcomingFor(ada) })

    upcomingFor(ada)
    await settle()
    await settle()

    // The dropped answer was replaced rather than simply lost.
    expect(calendar.requests.length).toBeGreaterThan(1)
    expect(upcomingFor(ada)).toEqual(events)
  })
})

describe('addBirthdayToCalendar', () => {
  const toastText = () => document.body.textContent

  it('creates an all-day yearly event and offers to undo it', async () => {
    const created = { id: 'made', title: 'Ada Lovelace’s birthday' }
    const calendar = stubCalendar({
      answer: (msg) =>
        msg.method === 'search'
          ? { ok: true, result: { events: [] } }
          : msg.method === 'create'
            ? { ok: true, result: { event: created } }
            : { ok: true, result: { deleted: true, id: 'made' } },
    })
    initCalendar({ onUpdate: () => {} })

    await addBirthdayToCalendar(ada)
    const create = calendar.requests.find((r) => r.method === 'create')
    expect(create.params.event).toMatchObject({
      title: 'Ada Lovelace’s birthday',
      allDay: true,
      recurrence: { freq: 'yearly' },
      description: 'Born in 1815',
    })
    expect(toastText()).toContain('Added to your calendar on December 10')

    // Undo takes back exactly the event we made.
    document.querySelector('[data-toast-action]').click()
    await settle()
    expect(calendar.requests.find((r) => r.method === 'delete').params).toEqual({ id: 'made' })
  })

  it('looks first, and does not add a second copy of one already there', async () => {
    const existing = {
      id: 'series::1',
      seriesId: 'series',
      title: 'Ada Lovelace’s birthday',
      allDay: true,
      recurring: true,
      start: new Date(new Date().getFullYear() + 1, 11, 10).getTime(),
    }
    const calendar = stubCalendar({
      answer: (msg) =>
        msg.method === 'search' ? { ok: true, result: { events: [existing] } } : { ok: true, result: {} },
    })
    initCalendar({ onUpdate: () => {} })

    await addBirthdayToCalendar(ada)
    expect(calendar.requests.map((r) => r.method)).toEqual(['search'])
    expect(toastText()).toContain('Already in your calendar on December 10')
  })

  it('moves the existing series when the birthday has been corrected since', async () => {
    const existing = {
      id: 'series::1',
      seriesId: 'series',
      title: 'Ada Lovelace’s birthday',
      allDay: true,
      recurring: true,
      start: new Date(new Date().getFullYear() + 1, 10, 2).getTime(), // November 2
    }
    const calendar = stubCalendar({
      answer: (msg) =>
        msg.method === 'search'
          ? { ok: true, result: { events: [existing] } }
          : { ok: true, result: { event: { ...existing } } },
    })
    initCalendar({ onUpdate: () => {} })

    await addBirthdayToCalendar(ada)
    const update = calendar.requests.find((r) => r.method === 'update')
    // The series, not the occurrence we found it through.
    expect(update.params.id).toBe('series')
    expect(new Date(update.params.patch.start).getMonth()).toBe(11)
    expect(calendar.requests.some((r) => r.method === 'create')).toBe(false)
    expect(toastText()).toContain('Birthday moved to December 10')
  })

  it('says so, once, when the calendar cannot be reached', async () => {
    stubCalendar({ answer: () => ({ ok: false, error: { message: 'no' } }) })
    initCalendar({ onUpdate: () => {} })
    await addBirthdayToCalendar(ada)
    expect(toastText()).toContain('Could not reach your calendar')
  })

  it('refuses a birthday that is not a date, without launching anything', async () => {
    const calendar = stubCalendar()
    initCalendar({ onUpdate: () => {} })
    await addBirthdayToCalendar({ ...ada, birthday: 'sometime in May' })
    expect(calendar.launches).toBe(0)
    expect(toastText()).toContain('isn’t a date we can add')
  })
})
