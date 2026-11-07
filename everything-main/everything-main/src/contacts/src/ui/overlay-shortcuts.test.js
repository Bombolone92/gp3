// @vitest-environment happy-dom
//
// Global shortcuts must stand down while something modal is on top of the app:
// an open context menu or a confirmation dialog. Regression guards for keys
// leaking through and acting on the page beneath (moving list focus/selection,
// opening the editor over a delete confirm, …).
import { describe, it, expect, beforeEach } from 'vitest'
import { store } from '../store.js'
import { mountApp } from './app.js'
import { confirmDialog } from './confirm.js'
import { showContextMenu } from '../contextmenu.js'
import { contactKey } from '../model.js'

function stubPuter() {
  const kv = new Map()
  window.puter = {
    env: 'web',
    auth: { isSignedIn: () => true, getUser: async () => ({}) },
    kv: {
      list: async () => [...kv.entries()].map(([key, value]) => ({ key, value })),
      set: async (k, v) => (kv.set(k, v), true),
      del: async (k) => (kv.delete(k), true),
    },
    ui: {},
  }
  return kv
}
function press(el, key, opts = {}) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

async function boot() {
  const kv = stubPuter()
  kv.set(contactKey('a'), { id: 'a', firstName: 'Ann' })
  kv.set(contactKey('b'), { id: 'b', firstName: 'Bea' })
  const root = document.createElement('div')
  document.body.appendChild(root)
  mountApp(root, {})
  await store.load()
  return root
}

describe('shortcuts stand down under modal UI', () => {
  beforeEach(() => {
    document.body.className = ''
    document.body.innerHTML = ''
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.exitSelectMode()
    store.ui.selectedId = null
    store.ui.cursorId = null
  })

  it('arrow keys and "n" act on the menu, not the list, while a context menu is open', async () => {
    await boot()
    showContextMenu({ clientX: 10, clientY: 10, preventDefault() {} }, [
      { label: 'One', action() {} },
      { label: 'Two', action() {} },
    ])
    const menu = document.querySelector('.ctx-menu')
    // happy-dom can't run the menu's own ":scope >" initial-focus selector, so
    // place focus on the first item the way a browser would have.
    menu.querySelector('.ctx-menu__item').focus()

    press(document.activeElement, 'ArrowDown')
    expect(menu.contains(document.activeElement)).toBe(true)
    expect(store.ui.selectedId).toBe(null) // the list must not react

    press(document.activeElement, 'n')
    expect(document.querySelector('.overlay--editor')).toBeFalsy()

    press(document.activeElement, 'Escape')
    expect(document.querySelector('.ctx-menu')).toBeFalsy()
  })

  it('"n" and arrows do nothing while a confirm dialog is open', async () => {
    await boot()
    const confirmed = confirmDialog({ title: 'Delete Ann?', confirmLabel: 'Delete', danger: true })
    await tick()
    expect(document.querySelector('.overlay--confirm')).toBeTruthy()
    expect(document.body.classList.contains('has-overlay')).toBe(true)

    press(document.activeElement || document.body, 'n')
    expect(document.querySelector('.overlay--editor')).toBeFalsy()

    press(document.activeElement || document.body, 'ArrowDown')
    expect(store.ui.selectedId).toBe(null)

    press(document.activeElement || document.body, 'Escape')
    expect(await confirmed).toBe(false)
    // The dialog restores the page: shortcuts (and scrolling) work again.
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })
})
