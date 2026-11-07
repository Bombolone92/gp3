import { describe, it, expect } from 'vitest'
import {
  birthdayTitle,
  buildBirthdayEvent,
  findBirthdayEvent,
  formatDayOfYear,
  nextBirthday,
  parseBirthday,
  sameDayOfYear,
} from './birthday.js'

const ada = { firstName: 'Ada', lastName: 'Lovelace', birthday: '1815-12-10' }
const may = (day, year = 2031) => new Date(year, 4, day, 9, 30).getTime()

describe('parseBirthday', () => {
  it('reads a full date, and the vCard "no year" convention', () => {
    expect(parseBirthday('1815-12-10')).toEqual({ month: 12, day: 10, year: 1815 })
    expect(parseBirthday('0000-05-04')).toEqual({ month: 5, day: 4, year: null })
  })

  it('rejects anything that is not a date we could put on a calendar', () => {
    expect(parseBirthday('')).toBeNull()
    expect(parseBirthday('sometime in May')).toBeNull()
    expect(parseBirthday('1990-13-01')).toBeNull()
    expect(parseBirthday('1990-02-31')).toBeNull()
  })

  it('keeps Feb 29 for a leap year, and for a birthday with no year', () => {
    expect(parseBirthday('2024-02-29')).toEqual({ month: 2, day: 29, year: 2024 })
    expect(parseBirthday('0000-02-29')).toEqual({ month: 2, day: 29, year: null })
    expect(parseBirthday('2023-02-29')).toBeNull()
  })
})

describe('nextBirthday', () => {
  it('picks this year while it is still to come', () => {
    const start = nextBirthday({ month: 12, day: 10 }, may(1))
    expect(new Date(start)).toEqual(new Date(2031, 11, 10))
  })

  it('counts today as still to come', () => {
    const start = nextBirthday({ month: 5, day: 4 }, may(4))
    expect(new Date(start)).toEqual(new Date(2031, 4, 4))
  })

  it('rolls to next year once the day has passed', () => {
    const start = nextBirthday({ month: 5, day: 3 }, may(4))
    expect(new Date(start)).toEqual(new Date(2032, 4, 3))
  })

  it('anchors a Feb 29 birthday on a year that actually has one', () => {
    const start = nextBirthday({ month: 2, day: 29 }, new Date(2031, 5, 1).getTime())
    expect(new Date(start)).toEqual(new Date(2032, 1, 29))
  })

  it('starts the day at local midnight, not at the current time of day', () => {
    const start = nextBirthday({ month: 5, day: 20 }, may(1))
    const d = new Date(start)
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })
})

describe('buildBirthdayEvent', () => {
  it('builds an all-day yearly event on the next birthday', () => {
    const event = buildBirthdayEvent(ada, may(1))
    expect(event.title).toBe('Ada Lovelace’s birthday')
    expect(event.allDay).toBe(true)
    expect(event.recurrence).toEqual({ freq: 'yearly' })
    expect(new Date(event.start)).toEqual(new Date(2031, 11, 10))
    // One whole day, ending on its last millisecond.
    expect(new Date(event.end)).toEqual(new Date(2031, 11, 10, 23, 59, 59, 999))
  })

  it('carries the birth year in the description, where a yearly event can keep it', () => {
    expect(buildBirthdayEvent(ada, may(1)).description).toBe('Born in 1815')
    expect(buildBirthdayEvent({ ...ada, birthday: '0000-12-10' }, may(1)).description).toBe('')
  })

  it('is nothing at all without a usable birthday', () => {
    expect(buildBirthdayEvent({ firstName: 'Ada' }, may(1))).toBeNull()
    expect(buildBirthdayEvent({ firstName: 'Ada', birthday: 'unknown' }, may(1))).toBeNull()
    expect(buildBirthdayEvent(null, may(1))).toBeNull()
  })

  it('titles a contact the same way the rest of the app names them', () => {
    expect(birthdayTitle({ company: 'Analytical Engines' })).toBe('Analytical Engines’s birthday')
  })
})

describe('findBirthdayEvent', () => {
  const title = 'Ada Lovelace’s birthday'
  const mine = { id: 'a::1', seriesId: 'a', title, allDay: true, recurring: true, start: may(4) }

  it('finds the event we would have added, whatever its case or padding', () => {
    expect(findBirthdayEvent([mine], title)).toBe(mine)
    expect(findBirthdayEvent([{ ...mine, title: `  ${title.toUpperCase()} ` }], title)).toBeTruthy()
  })

  it('ignores an event that only looks like one', () => {
    const dinner = { id: 'b', title: 'Ada Lovelace’s birthday dinner', allDay: true, recurring: true }
    const oneOff = { ...mine, id: 'c', recurring: false }
    const timed = { ...mine, id: 'd', allDay: false }
    expect(findBirthdayEvent([dinner, oneOff, timed], title)).toBeNull()
    expect(findBirthdayEvent([], title)).toBeNull()
    expect(findBirthdayEvent(null, title)).toBeNull()
  })
})

describe('sameDayOfYear / formatDayOfYear', () => {
  it('compares the day and month, across years', () => {
    expect(sameDayOfYear(may(4, 2031), may(4, 2032))).toBe(true)
    expect(sameDayOfYear(may(4, 2031), may(5, 2031))).toBe(false)
  })

  it('names a day the way a toast would', () => {
    expect(formatDayOfYear(may(4))).toBe('May 4')
  })
})
