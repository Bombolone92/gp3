import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCalendar } from './calendar.js'

// Every client built by harness() below, torn down after each test: one left
// running can land a reply (or a launch) in the middle of the next test.
const clients = []
afterEach(() => {
  clients.forEach((c) => c.dispose())
  clients.length = 0
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A stand-in for the Calendar app on the other end of an AppConnection: it
 * speaks the same little protocol (a `ready` notice, then one reply per
 * request), and records what it was launched with.
 */
function makeService({ answer = null, ready = true } = {}) {
  const listeners = new Map()
  const service = {
    launches: [],
    requests: [],
    closed: false,
    /** Fire one of the AppConnection's events at the client. */
    fire(event, msg) {
      for (const fn of [...(listeners.get(event) || [])]) fn(msg)
    },
    /** Push an unsolicited message (e.g. `changed`) at the client. */
    emit(msg) {
      service.fire('message', msg)
    },
  }

  const connection = {
    usesSDK: true,
    postMessage(msg) {
      service.requests.push(msg)
      setTimeout(() => {
        const reply = answer ? answer(msg) : { ok: true, result: { events: [] } }
        if (reply) service.emit({ $: 'calendar-api', v: 1, id: msg.id, ...reply })
      }, 0)
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn)
    },
    close() {
      service.closed = true
    },
  }

  const puter = {
    env: 'app',
    ui: {
      launchApp: vi.fn(async (opts) => {
        service.launches.push(opts)
        if (ready) {
          setTimeout(() => service.emit({ $: 'calendar-api', v: 1, type: 'ready', methods: ['search'] }), 0)
        }
        return connection
      }),
    },
  }

  return { service, connection, puter }
}

function harness(options = {}, clientOptions = {}) {
  const { service, puter } = makeService(options)
  const calendar = createCalendar({
    getPuter: () => puter,
    launchTimeoutMs: 60,
    requestTimeoutMs: 60,
    idleCloseMs: 20,
    ...clientOptions,
  })
  clients.push(calendar)
  return { service, puter, calendar }
}

/** An event as the Calendar API returns one. */
const event = (over = {}) => ({
  id: 'e1',
  title: 'Design review',
  start: Date.now() + 3600_000,
  end: Date.now() + 7200_000,
  allDay: false,
  recurring: false,
  ...over,
})

describe('calendar client — where it works at all', () => {
  it('is inert outside the Puter desktop', async () => {
    const calendar = createCalendar({ getPuter: () => ({ env: 'web', ui: { launchApp: vi.fn() } }) })
    clients.push(calendar)
    expect(calendar.supported()).toBe(false)
    expect(await calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
    await expect(calendar.create({ title: 'x', start: 1 })).rejects.toThrow()
  })

  it('is inert with no SDK at all', async () => {
    const calendar = createCalendar({ getPuter: () => undefined })
    clients.push(calendar)
    expect(calendar.supported()).toBe(false)
    expect(await calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
  })
})

describe('calendar client — asking', () => {
  it('launches the Calendar headless, in service mode', async () => {
    const { calendar, service } = harness()
    await calendar.upcomingWith(['ada@analytical.co'])
    expect(service.launches).toEqual([
      { name: 'calendar', args: { service: 'calendar-api' }, background: true },
    ])
  })

  it('asks for the events involving every address the contact has', async () => {
    const { calendar, service } = harness({
      answer: () => ({ ok: true, result: { events: [event()], total: 1 } }),
    })
    const found = await calendar.upcomingWith(['Ada@Analytical.co', 'ada@home.example'])
    expect(found.map((e) => e.title)).toEqual(['Design review'])
    const [request] = service.requests
    expect(request.method).toBe('search')
    expect(request.params.guest).toEqual(['ada@analytical.co', 'ada@home.example'])
    expect(request.params.limit).toBe(3)
    // A forward window: what's *coming up* with them.
    expect(request.params.to).toBeGreaterThan(request.params.from)
  })

  it('never asks about a contact with no addresses', async () => {
    const { calendar, service } = harness()
    expect(await calendar.upcomingWith([])).toBeNull()
    expect(await calendar.upcomingWith([''])).toBeNull()
    expect(service.launches).toHaveLength(0)
  })

  it('reuses one connection for a burst, then lets the window go', async () => {
    const { calendar, service } = harness()
    await Promise.all([
      calendar.upcomingWith(['a@example.com']),
      calendar.upcomingWith(['b@example.com']),
    ])
    await calendar.upcomingWith(['c@example.com'])
    expect(service.launches).toHaveLength(1)
    expect(service.closed).toBe(false)
    await sleep(60)
    expect(service.closed).toBe(true)
    // …and re-launches on demand once it has.
    await calendar.upcomingWith(['d@example.com'])
    expect(service.launches).toHaveLength(2)
  })

  it('tells "nothing coming up" apart from "could not ask"', async () => {
    const empty = harness()
    expect(await empty.calendar.upcomingWith(['ada@analytical.co'])).toEqual([])

    const broken = harness({ answer: () => ({ ok: false, error: { message: 'nope' } }) })
    expect(await broken.calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
  })

  it('gives up on a Calendar that never says hello, and stops relaunching it', async () => {
    const { calendar, service } = harness({ ready: false })
    expect(await calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
    expect(service.closed).toBe(true) // no window left behind
    expect(calendar.available()).toBe(false)
    expect(await calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
    expect(service.launches).toHaveLength(1) // backed off, not tried again
  })

  it('gives up as soon as the service window closes on us', async () => {
    // A Calendar that will not serve us — not installed, not allowed, nobody
    // signed in — exits as soon as it works that out, without ever saying
    // hello. `launchTimeoutMs` is long here so that waiting it out would show.
    const { calendar, service } = harness({ ready: false }, { launchTimeoutMs: 5000 })
    const asked = calendar.upcomingWith(['ada@analytical.co'])
    await sleep(5) // the launch resolves and our listeners go on
    const started = Date.now()
    service.fire('close')

    expect(await asked).toBeNull()
    expect(Date.now() - started).toBeLessThan(500) // not the five seconds
    expect(calendar.available()).toBe(false) // and backed off straight away
  })

  it('times out a request the Calendar never answers', async () => {
    const { calendar } = harness({ answer: () => null })
    await expect(calendar.create({ title: 'Lunch', start: Date.now() })).rejects.toThrow(/timed out/)
  })

  /**
   * A Calendar that says "no event with that id" is a Calendar that is running,
   * listening, and answering. Reading that as "the Calendar is unreachable"
   * took the upcoming events off every contact card for a minute — doubling
   * each time — over one undo of an event somebody had already deleted.
   */
  describe('an answer we did not like is still an answer', () => {
    const refuses = () =>
      harness({
        answer: () => ({ ok: false, error: { code: 'not_found', message: 'No event with id "gone"' } }),
      })

    it('keeps the Calendar available after a refusal', async () => {
      const { calendar, service } = refuses()
      await expect(calendar.remove('gone')).rejects.toThrow('No event with id "gone"')
      expect(calendar.available()).toBe(true)
      // …so the next contact card still gets to ask.
      expect(await calendar.upcomingWith(['ada@analytical.co'])).toBeNull()
      expect(service.requests.map((r) => r.method)).toEqual(['delete', 'search'])
    })

    it('carries the API error code, so a caller can tell them apart', async () => {
      const { calendar } = refuses()
      const err = await calendar.remove('gone').catch((e) => e)
      expect(err.code).toBe('not_found')
      expect(err.fromCalendar).toBe(true)
    })

    it('resets the doubling, so a refusal is not held against the next failure', async () => {
      let clock = 1_000_000
      let answering = false
      const { calendar } = harness(
        { answer: () => (answering ? { ok: false, error: { code: 'invalid', message: 'nope' } } : null) },
        { now: () => clock, retryAfterMs: 60_000 },
      )

      // Unreachable once: blocked for the base wait.
      await expect(calendar.create({ title: 'Lunch', start: 1 })).rejects.toThrow(/timed out/)
      expect(calendar.available()).toBe(false)
      clock += 61_000
      expect(calendar.available()).toBe(true)

      // The Calendar answers, refusing us. That is still contact, so the run of
      // failures ends here.
      answering = true
      await expect(calendar.create({ title: 'Lunch' })).rejects.toThrow('nope')
      expect(calendar.available()).toBe(true)

      // Unreachable again: the base wait, not a doubled one.
      answering = false
      await expect(calendar.create({ title: 'Lunch', start: 1 })).rejects.toThrow(/timed out/)
      clock += 61_000
      expect(calendar.available()).toBe(true)
    })

    it('still backs off when the Calendar genuinely cannot be reached', async () => {
      const { calendar } = harness({ answer: () => null })
      await expect(calendar.create({ title: 'Lunch', start: 1 })).rejects.toThrow(/timed out/)
      expect(calendar.available()).toBe(false)
    })
  })
})

describe('calendar client — writing', () => {
  it('creates, updates and deletes through the API', async () => {
    const { calendar, service } = harness({
      answer: (msg) =>
        msg.method === 'delete'
          ? { ok: true, result: { deleted: true, id: 'e1', scope: 'event' } }
          : { ok: true, result: { event: event({ id: 'made' }) } },
    })

    const created = await calendar.create({ title: 'Birthday', start: 1, allDay: true })
    expect(created.id).toBe('made')
    await calendar.update('made', { start: 2 })
    await calendar.remove('made')

    expect(service.requests.map((r) => r.method)).toEqual(['create', 'update', 'delete'])
    expect(service.requests[0].params.event).toMatchObject({ title: 'Birthday', allDay: true })
    expect(service.requests[1].params).toEqual({ id: 'made', patch: { start: 2 } })
    expect(service.requests[2].params).toEqual({ id: 'made' })
  })

  it('surfaces the error message the Calendar sent, not one of its own', async () => {
    const { calendar } = harness({
      answer: () => ({ ok: false, error: { code: 'invalid', message: '`start` is required' } }),
    })
    await expect(calendar.create({ title: 'Someday' })).rejects.toThrow('`start` is required')
  })

  it('passes on the `changed` notice, so what we drew can be redrawn', async () => {
    const { calendar, service } = harness()
    const seen = vi.fn()
    const off = calendar.onChange(seen)
    await calendar.upcomingWith(['ada@analytical.co'])
    service.emit({ $: 'calendar-api', v: 1, type: 'changed' })
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    service.emit({ $: 'calendar-api', v: 1, type: 'changed' })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('ignores traffic that is not the calendar answering', async () => {
    const { calendar, service } = harness()
    const seen = vi.fn()
    calendar.onChange(seen)
    await calendar.upcomingWith(['ada@analytical.co'])
    service.emit({ $: 'contacts-api', type: 'changed' })
    service.emit(null)
    service.emit({ $: 'calendar-api', id: 'nobody-is-waiting', ok: true, result: {} })
    expect(seen).not.toHaveBeenCalled()
  })

  it('closes the service window when disposed mid-flight', async () => {
    const { calendar, service } = harness()
    const inflight = calendar.upcomingWith(['ada@analytical.co'])
    calendar.dispose()
    expect(await inflight).toBeNull()
    await sleep(10)
    expect(service.closed).toBe(true)
  })
})
