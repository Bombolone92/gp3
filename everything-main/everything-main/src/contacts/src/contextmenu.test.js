// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { showContextMenu } from './contextmenu.js'

beforeEach(() => {
  document.body.innerHTML = ''
  delete window.puter // force the DOM fallback rather than puter.ui.contextMenu
})

function clickEl(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

const evt = { clientX: 10, clientY: 10, preventDefault() {} }

describe('context menu DOM fallback', () => {
  it('opens a submenu on tap/click and runs nested actions (not hover-only)', () => {
    let ran = null
    showContextMenu(evt, [
      {
        label: 'Sort by',
        items: [
          { label: 'First', action: () => (ran = 'first') },
          { label: 'Last', action: () => (ran = 'last') },
        ],
      },
    ])
    const parent = document.querySelector('.ctx-menu__item--has-sub')
    expect(parent).toBeTruthy()
    expect(parent.classList.contains('is-open')).toBe(false)

    clickEl(parent) // a tap, with no hover, must open it
    expect(parent.classList.contains('is-open')).toBe(true)

    const first = parent.querySelector('.ctx-menu--sub .ctx-menu__item')
    clickEl(first)
    expect(ran).toBe('first')
    expect(document.querySelector('.ctx-menu')).toBeFalsy() // menu closed after action
  })

  it('builds submenu parents as <div> and leaves as <button> (no nested buttons)', () => {
    showContextMenu(evt, [{ label: 'Theme', items: [{ label: 'Light', action() {} }] }])
    const parent = document.querySelector('.ctx-menu__item--has-sub')
    expect(parent.tagName).toBe('DIV')
    expect(parent.querySelector('.ctx-menu--sub .ctx-menu__item').tagName).toBe('BUTTON')
  })

  it('fires onClose once when an item is picked', () => {
    let closed = 0
    showContextMenu(evt, [{ label: 'Edit', action() {} }], { onClose: () => closed++ })
    clickEl(document.querySelector('.ctx-menu__item'))
    expect(closed).toBe(1)
  })

  it('owns the keyboard while open: keys never reach document-level handlers', () => {
    showContextMenu(evt, [
      { label: 'One', action() {} },
      { label: 'Two', action() {} },
    ])
    const first = document.querySelector('.ctx-menu__item')
    first.focus()
    // A global shortcut handler (like the app's) listens on document; while the
    // menu is open none of these may leak through and act on the page beneath.
    let leaked = 0
    const spy = () => leaked++
    document.addEventListener('keydown', spy)
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'n', '/']) {
      first.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    }
    document.removeEventListener('keydown', spy)
    expect(leaked).toBe(0)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

  it('closes on Tab so focus can move on (menu pattern)', () => {
    showContextMenu(evt, [{ label: 'Edit', action() {} }])
    const first = document.querySelector('.ctx-menu__item')
    first.focus()
    first.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    )
    expect(document.querySelector('.ctx-menu')).toBeFalsy()
  })

  it('a menu closed via Escape leaves no stale outside-listener to kill the next menu', async () => {
    // Open and Escape-dismiss a first menu (its outside listener must be
    // disarmed even though no outside click ever happened)…
    showContextMenu(evt, [{ label: 'Old', action() {} }])
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeFalsy()

    // …then open a second menu (as via keyboard: no pointerdown in between).
    let ran = false
    showContextMenu(evt, [{ label: 'New', action: () => (ran = true) }])
    await new Promise((r) => setTimeout(r, 0))
    const item = document.querySelector('.ctx-menu__item')

    // The first pointerdown lands on the new menu itself: it must survive so
    // the click that follows still runs the item's action.
    item.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    clickEl(item)
    expect(ran).toBe(true)
  })

  it('fires onClose on Escape and on click-away', async () => {
    let closed = 0
    showContextMenu(evt, [{ label: 'Edit', action() {} }], { onClose: () => closed++ })
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closed).toBe(1)
    expect(document.querySelector('.ctx-menu')).toBeFalsy()

    // Re-open and dismiss by clicking outside. The outside listener is armed on a
    // macrotask, so flush one before dispatching — and it must not re-fire the
    // already-closed first menu.
    showContextMenu(evt, [{ label: 'Edit', action() {} }], { onClose: () => closed++ })
    await new Promise((r) => setTimeout(r, 0))
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    expect(closed).toBe(2)
  })
})
