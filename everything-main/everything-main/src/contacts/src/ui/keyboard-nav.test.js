// @vitest-environment happy-dom
//
// The contact list is a roving-tabindex listbox: arrows / Home / End move a
// single focus cursor, focus follows the selection, and select mode gains a
// tri-state "select all" plus a Cmd/Ctrl+A shortcut.
import { describe, it, expect, beforeEach } from 'vitest'
import { store } from '../store.js'
import { mountApp } from './app.js'
import { contactKey } from '../model.js'

function stubPuter() {
  const kv = new Map()
  window.puter = {
    env: 'web',
    auth: { isSignedIn: () => true, getUser: async () => ({}) },
    kv: {
      list: async () => [...kv.entries()].map(([key, value]) => ({ key, value })),
      set: async (k, v) => {
        kv.set(k, v)
        return true
      },
      del: async (k) => {
        kv.delete(k)
        return true
      },
    },
    ui: {},
  }
  return kv
}
function press(el, key, opts = {}) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}
function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}
function shiftClick(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }))
}

async function boot() {
  const kv = stubPuter()
  // Sorted first-name order is Ann, Bea, Cal.
  kv.set(contactKey('a'), { id: 'a', firstName: 'Ann' })
  kv.set(contactKey('b'), { id: 'b', firstName: 'Bea' })
  kv.set(contactKey('c'), { id: 'c', firstName: 'Cal' })
  const root = document.createElement('div')
  document.body.appendChild(root)
  mountApp(root, {})
  await store.load()
  return root
}

describe('contacts list keyboard navigation', () => {
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

  it('moves focus and selection with arrows, Home and End', async () => {
    const root = await boot()
    const ids = [...root.querySelectorAll('.contact-item')].map((el) => el.dataset.id)
    expect(ids).toEqual(['a', 'b', 'c'])

    // First ArrowDown enters the list on the first row (does not skip it).
    press(document.body, 'ArrowDown')
    expect(store.ui.selectedId).toBe('a')
    expect(document.activeElement.dataset.id).toBe('a')

    press(document.activeElement, 'ArrowDown')
    expect(store.ui.selectedId).toBe('b')
    expect(document.activeElement.dataset.id).toBe('b')

    press(document.activeElement, 'ArrowUp')
    expect(store.ui.selectedId).toBe('a')

    press(document.activeElement, 'End')
    expect(store.ui.selectedId).toBe('c')
    expect(document.activeElement.dataset.id).toBe('c')

    press(document.activeElement, 'Home')
    expect(store.ui.selectedId).toBe('a')
    expect(document.activeElement.dataset.id).toBe('a')
  })

  it('exposes exactly one tab stop, on the selected row', async () => {
    const root = await boot()
    press(document.body, 'ArrowDown') // a
    press(document.activeElement, 'ArrowDown') // b
    const tabbable = [...root.querySelectorAll('.contact-item')].filter((el) => el.tabIndex === 0)
    expect(tabbable.map((el) => el.dataset.id)).toEqual(['b'])
  })

  it('navigates rows in select mode without checking them', async () => {
    await boot()
    store.enterSelectMode()
    press(document.body, 'ArrowDown')
    expect(document.activeElement.dataset.id).toBe('a')
    press(document.activeElement, 'ArrowDown')
    expect(document.activeElement.dataset.id).toBe('b')
    // Moving the cursor must not select anything — that's Space/Enter's job.
    expect(store.ui.checked.size).toBe(0)
  })
})

describe('tri-state select all', () => {
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

  it('cycles empty → indeterminate → all → empty', async () => {
    const root = await boot()
    store.enterSelectMode()
    const selAll = () => root.querySelector('[data-action="select-all"]')
    expect(selAll().getAttribute('aria-checked')).toBe('false')

    // Checking one of three rows puts the master control in the mixed state.
    store.toggleCheck('a')
    expect(selAll().getAttribute('aria-checked')).toBe('mixed')

    click(selAll())
    expect(store.ui.checked.size).toBe(3)
    expect(selAll().getAttribute('aria-checked')).toBe('true')

    click(selAll())
    expect(store.ui.checked.size).toBe(0)
    expect(selAll().getAttribute('aria-checked')).toBe('false')
  })

  it('selects everything visible on Cmd/Ctrl+A in select mode', async () => {
    await boot()
    store.enterSelectMode()
    press(document.body, 'a', { metaKey: true })
    expect(store.ui.checked.size).toBe(3)
  })

  it('exits select mode on Escape', async () => {
    await boot()
    store.enterSelectMode()
    store.toggleCheck('a')
    press(document.body, 'Escape')
    expect(store.ui.selectMode).toBe(false)
    expect(store.ui.checked.size).toBe(0)
  })
})

describe('shift-click range selection', () => {
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

  const row = (root, id) => root.querySelector(`.contact-item[data-id="${id}"]`)

  it('checks every row between the anchor and the shift-clicked row', async () => {
    const root = await boot()
    store.enterSelectMode()
    click(row(root, 'a')) // anchor
    shiftClick(row(root, 'c')) // extend across b
    expect([...store.ui.checked].sort()).toEqual(['a', 'b', 'c'])
  })

  it('extends in either direction and keeps the anchor for repeat shift-clicks', async () => {
    const root = await boot()
    store.enterSelectMode()
    click(row(root, 'c')) // anchor at the bottom
    shiftClick(row(root, 'a')) // extend upward → a, b, c
    expect([...store.ui.checked].sort()).toEqual(['a', 'b', 'c'])
    // A second shift-click re-extends from the same anchor (c), not from a.
    shiftClick(row(root, 'b'))
    expect([...store.ui.checked].sort()).toEqual(['b', 'c'])
  })

  it('begins a multi-selection when shift-clicking from single-select mode', async () => {
    const root = await boot()
    click(row(root, 'a')) // plain select, still single-select mode
    expect(store.ui.selectMode).toBe(false)
    shiftClick(row(root, 'c'))
    expect(store.ui.selectMode).toBe(true)
    expect([...store.ui.checked].sort()).toEqual(['a', 'b', 'c'])
  })
})
