// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { toast, progressToast } from './toast.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('toast', () => {
  it('renders an action button that runs its handler (used for Undo)', () => {
    let ran = false
    toast('Contact deleted', 'success', 6000, { label: 'Undo', onClick: () => (ran = true) })
    const btn = document.querySelector('.toast__action')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('Undo')
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(ran).toBe(true)
  })

  it('shows no action button for a plain toast', () => {
    toast('Copied to clipboard', 'success', 1600)
    expect(document.querySelector('.toast__action')).toBeFalsy()
  })
})

describe('progressToast', () => {
  it('counts up and fills its bar as the job reports progress', async () => {
    const p = progressToast('Deleting contacts…', { delay: 0 })
    await wait(5)
    const el = document.querySelector('.toast--progress')
    expect(el).toBeTruthy()
    expect(el.querySelector('.toast__msg').textContent).toBe('Deleting contacts…')
    // No ratio yet: the bar stays hidden rather than sitting at a phantom zero.
    expect(el.querySelector('.toast__track').hidden).toBe(true)

    p.update('Deleting 3 of 12…', 3 / 12)
    expect(el.querySelector('.toast__msg').textContent).toBe('Deleting 3 of 12…')
    const track = el.querySelector('.toast__track')
    expect(track.hidden).toBe(false)
    expect(track.getAttribute('aria-valuenow')).toBe('25')
    expect(el.querySelector('.toast__bar').style.width).toBe('25%')

    p.done()
    await wait(260)
    expect(document.querySelector('.toast--progress')).toBeFalsy()
  })

  it('never appears for a job that finishes inside the anti-flicker delay', async () => {
    const p = progressToast('Importing…', { delay: 40 })
    p.done()
    await wait(80)
    expect(document.querySelector('.toast--progress')).toBeFalsy()
  })

  it('show() puts it on screen immediately, before any progress is known', async () => {
    const p = progressToast('Reading contacts…', { delay: 10_000 })
    p.show()
    expect(document.querySelector('.toast--progress')).toBeTruthy()
    p.done()
  })

  it('stays silent for screen readers while ticking (the summary toast announces)', async () => {
    const p = progressToast('Importing…', { delay: 0 })
    await wait(5)
    expect(document.querySelector('.toast--progress').getAttribute('aria-live')).toBe('off')
    p.done()
  })
})
