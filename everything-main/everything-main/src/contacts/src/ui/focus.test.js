// @vitest-environment happy-dom
//
// Focus management: on the narrow single-column layout, selecting a contact
// must move focus into the detail pane (the list — and the focused row — get
// hidden); and closing a modal must hand focus back even when the opener was
// re-rendered while the modal was up.
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
      set: async (k, v) => (kv.set(k, v), true),
      del: async (k) => (kv.delete(k), true),
    },
    ui: {},
  }
  return kv
}
function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('mobile selection focus', () => {
  beforeEach(() => {
    document.body.className = ''
    document.body.innerHTML = ''
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.selectedId = null
    store.ui.selectMode = false
  })

  it('focuses the detail back button when selecting on a narrow screen', async () => {
    const realMM = window.matchMedia
    // Force the mobile layout: only the max-width:820px query matches.
    window.matchMedia = (q) => ({
      matches: /max-width:\s*820px/.test(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })
    try {
      const kv = stubPuter()
      kv.set(contactKey('f1'), { id: 'f1', firstName: 'Fia' })
      const root = document.createElement('div')
      document.body.appendChild(root)
      mountApp(root, {})
      await store.load()

      click(root.querySelector('.contact-item'))
      const back = root.querySelector('.detail__back')
      expect(back).toBeTruthy()
      expect(document.activeElement).toBe(back)

      // Going back hides the detail pane (and the Back button with it): focus
      // must return to the selected row, not fall on a hidden element or body.
      click(back)
      expect(document.activeElement).toBe(root.querySelector('.contact-item[data-id="f1"]'))
    } finally {
      window.matchMedia = realMM
    }
  })

  it('returns focus to the Edit button after saving re-renders the detail pane', async () => {
    const kv = stubPuter()
    kv.set(contactKey('e1'), { id: 'e1', firstName: 'Ada' })
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    click(root.querySelector('.contact-item'))
    const editBtn = root.querySelector('.detail__card [data-action="edit"]')
    editBtn.focus()
    click(editBtn)

    const editor = document.querySelector('.overlay--editor')
    const firstName = editor.querySelector('input[name="firstName"]')
    firstName.value = 'Ada B.'
    firstName.dispatchEvent(new window.Event('input', { bubbles: true }))
    click(editor.querySelector('[data-action="save"]'))
    await tick()
    await tick()

    // Saving re-stamped the detail pane, so the original button is detached;
    // focus must land on its freshly rendered equivalent, not fall to <body>.
    expect(document.activeElement).toBe(root.querySelector('.detail__card [data-action="edit"]'))
  })
})
