// @vitest-environment happy-dom
//
// Global keyboard shortcuts must not hijack browser/OS modifier chords.
import { describe, it, expect, beforeEach } from 'vitest'
import { store } from '../store.js'
import { mountApp } from './app.js'

function stubPuter() {
  window.puter = {
    env: 'web',
    auth: { isSignedIn: () => true },
    kv: { list: async () => [] },
    ui: {},
  }
}
function press(key, opts = {}) {
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }),
  )
}

describe('global keyboard shortcuts', () => {
  beforeEach(() => {
    document.body.className = ''
    document.body.innerHTML = ''
    store.contacts.clear()
    store.loaded = true
    store.error = null
    store.ui.selectedId = null
  })

  it('opens the editor on a bare "n" but ignores Cmd/Ctrl+N', () => {
    stubPuter()
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})

    // Modifier chords are the browser's (new window, etc.) — never ours.
    press('n', { metaKey: true })
    expect(document.querySelector('.overlay--editor')).toBeFalsy()
    press('n', { ctrlKey: true })
    expect(document.querySelector('.overlay--editor')).toBeFalsy()

    // A bare press is the actual shortcut.
    press('n')
    expect(document.querySelector('.overlay--editor')).toBeTruthy()
  })
})
