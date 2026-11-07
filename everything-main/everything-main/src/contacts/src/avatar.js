// Deterministic initials + color for contact avatars (pure functions).
import { displayName } from './model.js'
import { escapeHtml, escapeAttr } from './format.js'

// A calm, modern palette. Each contact maps to one entry deterministically so
// the same person always gets the same color. Every swatch clears WCAG AA
// (>=4.5:1) against the white initials it carries.
const PALETTE = [
  '#2f6fed', // blue
  '#6b4ff0', // violet
  '#cf2d63', // pink
  '#b45309', // orange
  '#157f5c', // green
  '#0e7490', // teal
  '#cc3b48', // red
  '#8a6d3b', // bronze
  '#5b6b8c', // slate
  '#b0457b', // magenta
]

/** Up to two uppercase initials derived from the contact's display name. */
export function initials(contact) {
  const name = displayName(contact)
  if (!name || name === 'No Name') return '?'
  // Keep hyphens/apostrophes inside words so "Gonzalez-Smith" or "O'Hara" stays
  // a single surname token (→ first initial of the whole surname).
  const words = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  // Take characters by code point, not UTF-16 unit — indexing would split a
  // surrogate pair (astral letters, historic scripts) into mojibake halves.
  const firstChar = (w) => String.fromCodePoint(w.codePointAt(0))
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase()
  return (firstChar(words[0]) + firstChar(words[words.length - 1])).toUpperCase()
}

/** Stable color for a contact, keyed off a stable identifier. */
export function avatarColor(contact) {
  const key = (contact && (contact.id || displayName(contact))) || ''
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/**
 * Markup for an avatar: the contact's photo if set, otherwise colored initials.
 * @param {object} contact
 * @param {string} extraClass - additional avatar size/modifier class(es)
 */
export function avatarMarkup(contact, extraClass = '') {
  const cls = `avatar ${extraClass}`.trim()
  if (contact && contact.photo) {
    return `<span class="${cls}" aria-hidden="true"><img src="${escapeAttr(contact.photo)}" alt="" loading="lazy" /></span>`
  }
  return `<span class="${cls}" style="background:${avatarColor(contact)}" aria-hidden="true">${escapeHtml(initials(contact))}</span>`
}
