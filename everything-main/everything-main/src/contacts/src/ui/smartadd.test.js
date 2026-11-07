// @vitest-environment happy-dom
//
// Smart Add behaviors that need a real DOM: the keyboard shortcut must not
// fire a duplicate AI request while one is already in flight.
import { describe, it, expect, beforeEach } from 'vitest'
import { openSmartAdd } from './smartadd.js'

function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}
function press(key, opts = {}) {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('smart add extraction', () => {
  beforeEach(() => {
    document.body.className = ''
    document.body.innerHTML = ''
  })

  it('ignores a repeat Cmd+Enter while a request is in flight', async () => {
    let calls = 0
    window.puter = {
      env: 'web',
      ui: {},
      // Never resolves within the test — the request stays "in flight".
      ai: { chat: () => (calls++, new Promise(() => {})) },
    }

    openSmartAdd()
    const overlay = document.querySelector('.overlay--editor')
    overlay.querySelector('[data-text]').value = 'Jane Doe · jane@acme.com'

    press('Enter', { metaKey: true })
    press('Enter', { metaKey: true }) // must be swallowed, not start a second call
    await tick()
    expect(calls).toBe(1)

    // Teardown: Escape → the pasted text raises the discard confirm → discard,
    // so the modal's capture-phase keydown listener doesn't leak.
    press('Escape')
    await tick()
    click([...document.querySelectorAll('[data-confirm="ok"]')].pop())
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('extracts once the request settles again after a failure', async () => {
    let calls = 0
    window.puter = {
      env: 'web',
      ui: {},
      ai: { chat: async () => (calls++, Promise.reject(new Error('boom'))) },
    }

    openSmartAdd()
    const overlay = document.querySelector('.overlay--editor')
    overlay.querySelector('[data-text]').value = 'Jane Doe · jane@acme.com'

    press('Enter', { metaKey: true })
    await tick()
    expect(calls).toBe(1)
    expect(overlay.querySelector('[data-error]').hidden).toBe(false)

    // The in-flight guard must have been released: a new attempt goes through.
    press('Enter', { metaKey: true })
    await tick()
    expect(calls).toBe(2)

    press('Escape')
    await tick()
    click([...document.querySelectorAll('[data-confirm="ok"]')].pop())
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })
})
