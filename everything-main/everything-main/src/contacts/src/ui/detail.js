// Renders the detail pane for the selected contact (and the empty state).
import { icons } from '../icons.js'
import { avatarMarkup } from '../avatar.js'
import { displayName, subtitle } from '../model.js'
import { formatAddressLines } from '../address.js'
import {
  escapeHtml,
  escapeAttr,
  telHref,
  formatPhone,
  normalizeUrl,
  displayUrl,
  formatBirthday,
  formatWhen,
  relativeTime,
} from '../format.js'

function emptyState() {
  return `
    <div class="detail__empty">
      <div class="detail__empty-art">${icons.contacts}</div>
      <h1>No contact selected</h1>
      <p>Choose someone from the list, or add a new contact to get started.</p>
      <button class="btn btn--primary" data-action="new">${icons.plus}<span>New contact</span></button>
    </div>`
}

/** Neutral placeholder for the detail pane during the first cloud load, so it
 *  doesn't show the "choose someone" empty state while the list is still loading. */
export function detailLoading() {
  return `
    <div class="detail__loading" role="status" aria-label="Loading">
      <span class="list-loading__spinner"></span>
    </div>`
}

function fieldRow(icon, valueHtml, label, copyValue, field = 'other') {
  const copy = copyValue
    ? `<button class="field__copy" data-action="copy" data-copy="${escapeAttr(copyValue)}" data-field="${escapeAttr(field)}" title="Copy" aria-label="Copy">${icons.copy}</button>`
    : ''
  return `
    <div class="field">
      <span class="field__icon">${icon}</span>
      <div class="field__body">
        <div class="field__value">${valueHtml}</div>
        <div class="field__label">${escapeHtml(label)}</div>
      </div>
      ${copy}
    </div>`
}

function group(rows) {
  const filled = rows.filter(Boolean)
  return filled.length ? `<section class="field-group">${filled.join('')}</section>` : ''
}

/**
 * What's next with this person, from the Calendar app (see ui/calendar.js).
 *
 * Rendered only when there is something to say: no heading over an empty list,
 * no "couldn't reach the calendar" — someone reading a contact card has not
 * asked a question that deserves an error. Absent everywhere the Calendar app
 * isn't, which includes the whole open web.
 */
function upcomingSection(events) {
  if (!events || !events.length) return ''
  const rows = events.map((ev) =>
    fieldRow(
      icons.calendar,
      escapeHtml(ev.title || 'Untitled event'),
      formatWhen(ev.start, { allDay: ev.allDay }),
    ),
  )
  return `
    <h2 class="detail__section-title">Upcoming</h2>
    <section class="field-group">${rows.join('')}</section>`
}

export function renderDetail(contact, { upcoming = null } = {}) {
  if (!contact) return emptyState()
  const name = displayName(contact)
  const sub = subtitle(contact)

  const emailRows = (contact.emails || []).map((e) =>
    fieldRow(
      icons.mail,
      `<a href="mailto:${escapeAttr(e.value)}">${escapeHtml(e.value)}</a>`,
      e.label,
      e.value,
      'email',
    ),
  )
  const phoneRows = (contact.phones || []).map((p) => {
    const display = formatPhone(p.value)
    // Copy the number as entered (dial-able), not the prettified display form.
    return fieldRow(
      icons.phone,
      `<a href="${escapeAttr(telHref(p.value))}">${escapeHtml(display)}</a>`,
      p.label,
      p.value,
      'phone',
    )
  })
  const urlRows = (contact.urls || []).map((u) => {
    const href = normalizeUrl(u.value)
    const inner = href
      ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl(u.value))}</a>`
      : escapeHtml(u.value)
    return fieldRow(icons.globe, inner, u.label, u.value, 'url')
  })
  const addressRows = (contact.addresses || []).map((a) => {
    const lines = formatAddressLines(a)
    if (!lines.length) return ''
    const plain = lines.join('\n')
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lines.join(', '))}`
    return fieldRow(
      icons.mapPin,
      `<a href="${escapeAttr(maps)}" target="_blank" rel="noopener noreferrer">${lines.map(escapeHtml).join('<br>')}</a>`,
      a.label || 'Address',
      plain,
      'address',
    )
  })

  const birthdayRow = contact.birthday
    ? fieldRow(icons.cake, escapeHtml(formatBirthday(contact.birthday)), 'Birthday')
    : ''
  const notesRow = contact.notes
    ? fieldRow(icons.note, escapeHtml(contact.notes).replace(/\n/g, '<br>'), 'Notes')
    : ''

  const tags = (contact.tags || []).length
    ? `<div class="detail__tags">${contact.tags
        .map(
          (t) =>
            `<button class="chip chip--tag" data-action="filter-tag" data-tag="${escapeAttr(t)}">${icons.tag}<span>${escapeHtml(t)}</span></button>`,
        )
        .join('')}</div>`
    : ''

  return `
    <article class="detail__card">
      <header class="detail__top">
        <button class="detail__back" data-action="back" aria-label="Back to list">${icons.back}</button>
        <div class="detail__hero">
          ${avatarMarkup(contact, 'avatar--xl')}
          <div class="detail__title">
            <h1>${escapeHtml(name)}</h1>
            ${sub && sub !== name ? `<p class="detail__subtitle">${escapeHtml(sub)}</p>` : ''}
          </div>
        </div>
        <div class="detail__actions">
          <button class="btn btn--ghost ${contact.favorite ? 'is-active' : ''}" data-action="favorite" data-id="${escapeAttr(contact.id)}" aria-pressed="${contact.favorite ? 'true' : 'false'}" title="${contact.favorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${contact.favorite ? icons.starFilled : icons.star}
          </button>
          <button class="btn btn--ghost" data-action="edit" data-id="${escapeAttr(contact.id)}" title="Edit">${icons.edit}</button>
          <button class="btn btn--ghost" data-action="menu" data-id="${escapeAttr(contact.id)}" title="More" aria-label="More actions">${icons.more}</button>
        </div>
      </header>

      ${group([...emailRows, ...phoneRows])}
      ${group([...urlRows, ...addressRows])}
      ${group([birthdayRow])}
      ${group([notesRow])}
      ${tags}
      ${upcomingSection(upcoming)}

      <footer class="detail__meta">
        Added ${escapeHtml(relativeTime(contact.createdAt))}${
          contact.updatedAt && contact.updatedAt - contact.createdAt > 60000
            ? ` · Updated ${escapeHtml(relativeTime(contact.updatedAt))}`
            : ''
        }
      </footer>
    </article>`
}
