// Renders the scrollable contact list in the sidebar, with A–Z section headers
// (for name sorts) and graceful empty / no-results states.
import { icons } from '../icons.js'
import { avatarMarkup } from '../avatar.js'
import { displayName, subtitle } from '../model.js'
import { escapeHtml, escapeAttr } from '../format.js'
import { filterContacts, groupContacts } from '../search.js'

// `active` marks the single row that is the list's tab stop (roving tabindex):
// arrow keys move it, everything else stays out of the Tab order.
function itemHtml(contact, ui, active) {
  const id = escapeAttr(contact.id)
  const tabindex = active ? 0 : -1
  if (ui.selectMode) {
    const checked = ui.checked.has(contact.id)
    return `
      <button class="contact-item contact-item--check ${checked ? 'is-checked' : ''}" id="opt-${id}" role="option" aria-selected="${checked}" tabindex="${tabindex}" data-action="toggle-check" data-id="${id}">
        <span class="checkbox ${checked ? 'is-on' : ''}" aria-hidden="true">${checked ? icons.check : ''}</span>
        ${avatarMarkup(contact)}
        <span class="contact-item__body">
          <span class="contact-item__name">
            <span class="contact-item__name-text">${escapeHtml(displayName(contact))}</span>
            ${contact.favorite ? `<span class="contact-item__fav" aria-label="Favorite">${icons.starFilled}</span>` : ''}
          </span>
          ${subtitle(contact) ? `<span class="contact-item__sub">${escapeHtml(subtitle(contact))}</span>` : ''}
        </span>
      </button>`
  }
  const selected = contact.id === ui.selectedId
  return `
    <button class="contact-item ${selected ? 'is-selected' : ''}" id="opt-${id}" role="option" aria-selected="${selected}" tabindex="${tabindex}" data-action="select" data-id="${id}">
      ${avatarMarkup(contact)}
      <span class="contact-item__body">
        <span class="contact-item__name">
          <span class="contact-item__name-text">${escapeHtml(displayName(contact))}</span>
          ${contact.favorite ? `<span class="contact-item__fav" aria-label="Favorite">${icons.starFilled}</span>` : ''}
        </span>
        ${subtitle(contact) ? `<span class="contact-item__sub">${escapeHtml(subtitle(contact))}</span>` : ''}
      </span>
    </button>`
}

function listEmpty(hasAnyContacts, ui) {
  if (!hasAnyContacts) {
    return `
      <div class="list-empty">
        <p class="list-empty__title">Your address book is empty</p>
        <p class="list-empty__hint">Add your first contact or import an existing <code>.vcf</code> file.</p>
        <div class="list-empty__actions">
          <button class="btn btn--primary btn--sm" data-action="new">${icons.plus}<span>New contact</span></button>
          <button class="btn btn--soft btn--sm" data-action="import">${icons.upload}<span>Import</span></button>
        </div>
      </div>`
  }
  let title = 'No matches'
  let hint = 'Try a different search or clear your filters.'
  if (!ui.query) {
    if (ui.favoritesOnly) {
      title = 'No favorites'
      hint = 'Open a contact and tap the star to add it to your favorites.'
    } else if (ui.tag) {
      title = `No “${escapeHtml(ui.tag)}”`
      hint = 'No contacts have this tag yet.'
    }
  }
  return `
    <div class="list-empty">
      <p class="list-empty__title">${title}</p>
      <p class="list-empty__hint">${hint}</p>
    </div>`
}

/** Skeleton shown while the first cloud load is in flight. */
export function listLoading() {
  return `
    <div class="list-loading" role="status" aria-label="Loading contacts">
      <span class="list-loading__spinner"></span>
    </div>`
}

/** Build the full list markup from the current store state. */
export function renderList(store) {
  const visible = filterContacts(store.all, store.ui)
  if (!visible.length) {
    return listEmpty(store.all.length > 0, store.ui)
  }
  const groups = groupContacts(visible, store.ui.sort)
  // Pick the roving tab stop: the keyboard cursor if it's still visible, else
  // (in single-select) the selected contact, else the first row — so the list
  // always has exactly one predictable entry point for the keyboard.
  const visibleIds = new Set(visible.map((c) => c.id))
  const ui = store.ui
  let activeId = ui.cursorId && visibleIds.has(ui.cursorId) ? ui.cursorId : null
  if (!activeId && !ui.selectMode && ui.selectedId && visibleIds.has(ui.selectedId)) activeId = ui.selectedId
  if (!activeId && groups[0] && groups[0].contacts[0]) activeId = groups[0].contacts[0].id
  const parts = []
  for (const g of groups) {
    if (g.key) parts.push(`<div class="list-section" aria-hidden="true">${escapeHtml(g.key)}</div>`)
    for (const c of g.contacts) parts.push(itemHtml(c, ui, c.id === activeId))
  }
  const multi = store.ui.selectMode ? ' aria-multiselectable="true"' : ''
  return `<div class="contact-list__inner" id="contacts-listbox" role="listbox" aria-label="Contacts"${multi}>${parts.join('')}</div>`
}

/** Count summary shown under the list. */
export function listCount(store) {
  const total = store.all.length
  const visible = filterContacts(store.all, store.ui).length
  if (!total) return ''
  if (visible === total) return `${total} contact${total === 1 ? '' : 's'}`
  return `${visible} of ${total}`
}
