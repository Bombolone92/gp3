// Context menu helper. Uses Puter's native puter.ui.contextMenu() whenever the
// SDK provides it, and only falls back to a styled DOM menu if that API is
// entirely unavailable (so menus never become dead).
import { escapeHtml } from './format.js'

let openMenu = null

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/**
 * Show a context menu.
 * @param {MouseEvent} event - the triggering event (used for positioning)
 * @param {Array} items - [{ label, action, danger?, disabled?, items? } | '-']
 * @param {{ onClose?: () => void }} [opts] - onClose fires once when the menu is
 *   dismissed (pick, Escape, or click-away), letting callers clear open state
 *   such as a highlighted row.
 */
export function showContextMenu(event, items, opts = {}) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault()
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : null

  if (window.puter && window.puter.ui && typeof window.puter.ui.contextMenu === 'function') {
    try {
      window.puter.ui.contextMenu({ theme: currentTheme(), items: toPuterItems(items) })
      // Puter renders the menu itself and gives us no close event, so fall back
      // to clearing caller state on the user's next interaction.
      if (onClose) armNextInteractionClose(onClose)
      return
    } catch (_e) {
      /* SDK menu unavailable in this context — fall back to the DOM menu */
    }
  }
  showDomMenu(event, items, onClose)
}

// Best-effort close signal for the Puter native menu: fire onClose on the next
// pointer/key interaction (deferred so the event that opened the menu doesn't
// immediately trigger it).
function armNextInteractionClose(onClose) {
  const fire = () => {
    document.removeEventListener('pointerdown', fire, true)
    document.removeEventListener('keydown', fire, true)
    onClose()
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', fire, true)
    document.addEventListener('keydown', fire, true)
  }, 0)
}

function toPuterItems(items) {
  return items.map((item) => {
    if (item === '-') return '-'
    const out = { label: item.label }
    if (item.disabled) out.disabled = true
    if (item.danger) out.type = 'danger'
    if (Array.isArray(item.items)) out.items = toPuterItems(item.items)
    else if (typeof item.action === 'function') out.action = item.action
    return out
  })
}

// --- DOM fallback -----------------------------------------------------------
// Submenus open on hover (desktop), tap (touch), and arrow keys (keyboard), and
// flip to stay on-screen — so Sort/Theme are never dead on the open web.

let triggerEl = null
let menuOnClose = null
let outsideHandler = null

function closeDomMenu() {
  if (!openMenu) return
  openMenu.remove()
  openMenu = null
  document.removeEventListener('keydown', onKeydown, true)
  // Always disarm the outside-click listener, however the menu was dismissed
  // (Escape, item pick, Tab) — a stale one would close the *next* menu on its
  // first pointerdown, swallowing that click's action.
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true)
    outsideHandler = null
  }
  // Notify the caller (e.g. to un-highlight the row this menu belongs to).
  const done = menuOnClose
  menuOnClose = null
  if (done) done()
  // Return focus to whatever opened the menu (e.g. the list-options button).
  const t = triggerEl
  triggerEl = null
  if (t && typeof t.focus === 'function' && document.contains(t)) t.focus()
}

const canHover = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches

function subMenuOf(item) {
  return item.querySelector(':scope > .ctx-menu--sub')
}

function closeSub(item) {
  if (!item) return
  item.classList.remove('is-open')
  item.setAttribute('aria-expanded', 'false')
  const sub = subMenuOf(item)
  if (sub) {
    sub.classList.remove('ctx-menu--sub-left')
    sub.style.top = ''
  }
}

function openSub(item) {
  // Close sibling submenus at the same level first.
  item.parentElement
    .querySelectorAll(':scope > .ctx-menu__item--has-sub.is-open')
    .forEach((sib) => sib !== item && closeSub(sib))
  item.classList.add('is-open')
  item.setAttribute('aria-expanded', 'true')
  const sub = subMenuOf(item)
  if (!sub) return
  // Now that it's visible, flip horizontally / clamp vertically to fit.
  sub.classList.remove('ctx-menu--sub-left')
  sub.style.top = ''
  const ir = item.getBoundingClientRect()
  const sr = sub.getBoundingClientRect()
  if (ir.right + sr.width > window.innerWidth - 8) sub.classList.add('ctx-menu--sub-left')
  const overflowY = ir.top + sr.height - (window.innerHeight - 8)
  if (overflowY > 0) sub.style.top = `${-6 - overflowY}px`
}

// Focusable item buttons/rows directly within the menu level containing `el`.
function levelItems(el) {
  const menu = el && el.closest('.ctx-menu')
  if (!menu) return []
  return [...menu.querySelectorAll(':scope > .ctx-menu__item')].filter(
    (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true',
  )
}

function focusFirstSub(item) {
  const sub = subMenuOf(item)
  const first = sub && sub.querySelector(':scope > .ctx-menu__item:not([disabled])')
  if (first) first.focus()
}

function buildItem(item) {
  if (item === '-') {
    const sep = document.createElement('div')
    sep.className = 'ctx-menu__sep'
    return sep
  }
  const hasSub = Array.isArray(item.items)
  // A submenu container can't live inside a <button> (nested buttons are
  // invalid), so parent rows are <div> menuitems and leaves are <button>.
  const el = document.createElement(hasSub ? 'div' : 'button')
  el.className = 'ctx-menu__item' + (item.danger ? ' ctx-menu__item--danger' : '')
  el.setAttribute('role', 'menuitem')
  el.tabIndex = -1
  if (!hasSub) el.type = 'button'
  el.innerHTML = `<span>${escapeHtml(item.label)}</span>${hasSub ? '<span class="ctx-menu__chev">›</span>' : ''}`

  if (item.disabled) {
    if (hasSub) el.setAttribute('aria-disabled', 'true')
    else el.disabled = true
    return el
  }
  if (hasSub) {
    el.classList.add('ctx-menu__item--has-sub')
    el.setAttribute('aria-haspopup', 'true')
    el.setAttribute('aria-expanded', 'false')
    el.appendChild(buildMenu(item.items, true))
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      // On touch there's no hover, so tap toggles. On desktop hover manages it
      // and a click simply ensures it's open.
      if (el.classList.contains('is-open') && !canHover()) closeSub(el)
      else openSub(el)
    })
    if (canHover()) {
      el.addEventListener('mouseenter', () => openSub(el))
      el.addEventListener('mouseleave', () => closeSub(el))
    }
  } else if (typeof item.action === 'function') {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      closeDomMenu()
      item.action()
    })
  }
  return el
}

function buildMenu(items, isSub = false) {
  const menu = document.createElement('div')
  menu.className = 'ctx-menu' + (isSub ? ' ctx-menu--sub' : '')
  menu.setAttribute('role', 'menu')
  if (!isSub) menu.tabIndex = -1
  for (const item of items) menu.appendChild(buildItem(item))
  return menu
}

function onKeydown(e) {
  if (!openMenu) return
  // While the menu is open it owns the keyboard: no key may fall through to
  // global shortcut handlers underneath (list navigation, "n", "/", …), which
  // would move focus/selection behind the menu. Stopping propagation leaves
  // native default actions (Enter/Space activating the focused item) intact.
  e.stopPropagation()
  const a = document.activeElement
  switch (e.key) {
    case 'Escape': {
      e.preventDefault()
      const sub = a && openMenu.contains(a) ? a.closest('.ctx-menu--sub') : null
      if (sub) {
        const parent = sub.closest('.ctx-menu__item--has-sub')
        closeSub(parent)
        if (parent) parent.focus()
      } else {
        closeDomMenu()
      }
      break
    }
    case 'ArrowDown': {
      e.preventDefault()
      const items = levelItems(a)
      focusFromList(items, items.indexOf(a) + 1)
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      const items = levelItems(a)
      focusFromList(items, items.indexOf(a) - 1)
      break
    }
    case 'Home':
    case 'End': {
      e.preventDefault()
      focusFromList(levelItems(a), e.key === 'Home' ? 0 : -1)
      break
    }
    case 'Tab': {
      // Per the menu pattern, Tab dismisses the menu; focus then moves on
      // naturally from the restored trigger element.
      closeDomMenu()
      break
    }
    case 'ArrowRight':
    case 'Enter':
    case ' ': {
      if (a && a.classList && a.classList.contains('ctx-menu__item--has-sub')) {
        e.preventDefault()
        openSub(a)
        focusFirstSub(a)
      }
      // Leaf buttons keep their native Enter/Space activation.
      break
    }
    case 'ArrowLeft': {
      const sub = a && openMenu.contains(a) ? a.closest('.ctx-menu--sub') : null
      if (sub) {
        e.preventDefault()
        const parent = sub.closest('.ctx-menu__item--has-sub')
        closeSub(parent)
        if (parent) parent.focus()
      }
      break
    }
    default:
      break
  }
}

function focusFromList(items, idx) {
  if (items.length) items[((idx % items.length) + items.length) % items.length].focus()
}

function showDomMenu(event, items, onClose = null) {
  closeDomMenu()
  triggerEl = document.activeElement
  menuOnClose = onClose
  const menu = buildMenu(items)
  openMenu = menu
  menu.style.visibility = 'hidden'
  document.body.appendChild(menu)

  // Position within the viewport, flipping when near an edge.
  const x = event ? event.clientX : 0
  const y = event ? event.clientY : 0
  const rect = menu.getBoundingClientRect()
  const left = Math.min(x, window.innerWidth - rect.width - 8)
  const top = Math.min(y, window.innerHeight - rect.height - 8)
  menu.style.left = Math.max(8, left) + 'px'
  menu.style.top = Math.max(8, top) + 'px'
  menu.style.visibility = 'visible'

  // Focus the first item so arrow-key navigation works immediately.
  const first = menu.querySelector(':scope > .ctx-menu__item:not([disabled])')
  if (first) first.focus()

  // Close on any outside interaction. The handler is armed on a macrotask so
  // the interaction that opened the menu can't immediately dismiss it, and it
  // only arms while this menu is still the open one (it may have been closed
  // or replaced in the meantime).
  outsideHandler = onOutside
  setTimeout(() => {
    if (openMenu === menu) document.addEventListener('pointerdown', onOutside, true)
  }, 0)
  document.addEventListener('keydown', onKeydown, true)

  function onOutside(e) {
    if (!menu.contains(e.target)) closeDomMenu()
  }
}
