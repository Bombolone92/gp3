// @vitest-environment happy-dom
//
// Editor behaviors that need a real DOM: focus/keyboard handling around the
// nested delete confirmation, and Enter-to-save.
import { describe, it, expect, beforeEach } from 'vitest'
import { store } from '../store.js'
import { openEditor } from './editor.js'
import { normalizeContact } from '../model.js'

function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}
function press(key, opts = {}) {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('editor delete confirmation (stacked dialog)', () => {
  beforeEach(() => {
    store.contacts.clear()
    store.ui.selectedId = null
    document.body.className = ''
    document.body.innerHTML = ''
  })

  it('Escape dismisses the delete confirm but keeps the editor open', async () => {
    const c = normalizeContact({ id: 'x1', firstName: 'Grace', lastName: 'Hopper' })
    store.contacts.set(c.id, c)

    openEditor(c)
    const editor = document.querySelector('.overlay--editor')
    expect(editor).toBeTruthy()
    expect(document.body.classList.contains('has-overlay')).toBe(true)

    // Open the nested delete confirmation.
    click(editor.querySelector('[data-action="delete"]'))
    await tick()
    expect(document.querySelector('.overlay--confirm')).toBeTruthy()

    // Escape belongs to the dialog on top: it must dismiss the confirm and
    // leave the editor open (regression guard for the missing `confirming` flag).
    press('Escape')
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(true)
    expect(document.querySelector('.overlay--editor')).toBeTruthy()

    // With the confirm gone, Escape closes the editor as usual (no regression).
    press('Escape')
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('treats removing a filled row as an unsaved edit (discard guard fires)', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true
    const c = normalizeContact({
      id: 'row1',
      firstName: 'Ada',
      emails: [{ label: 'Work', value: 'ada@engine.io' }],
    })
    store.contacts.set(c.id, c)

    openEditor(c)
    const editor = document.querySelector('.overlay--editor')
    // Remove the (filled) email row without typing anything else…
    click(editor.querySelector('.form-group[data-group="emails"] [data-action="remove-row"]'))
    // …then try to close: the "Discard changes?" confirm must appear instead
    // of the editor silently closing and dropping the removal.
    press('Escape')
    await tick()
    expect(document.querySelector('.overlay--confirm')).toBeTruthy()
    expect(document.querySelector('.overlay--editor')).toBeTruthy()

    // Confirming the discard closes the editor (and tears its listeners down).
    click([...document.querySelectorAll('[data-confirm="ok"]')].pop())
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('closing without edits never asks to discard (empty rows are not edits)', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor() // brand-new, untouched contact
    const editor = document.querySelector('.overlay--editor')
    // Adding an empty row and removing it again changes no data.
    click(editor.querySelector('[data-action="add-row"][data-group="emails"]'))
    click(editor.querySelector('.form-group[data-group="emails"] [data-action="remove-row"]'))
    press('Escape')
    await tick()
    expect(document.querySelector('.overlay--confirm')).toBeFalsy()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('ignores a backdrop "click" from a drag that started inside the panel', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor()
    const overlay = document.querySelector('.overlay--editor')
    const input = overlay.querySelector('input[name="firstName"]')

    // Select-text drag: pointer goes down on an input, up over the backdrop.
    // The resulting click (target: overlay) must not dismiss the editor.
    input.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    overlay.dispatchEvent(new window.Event('pointerup', { bubbles: false }))
    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: false }))
    await tick()
    // close() drops has-overlay synchronously (the node itself lingers through
    // its exit animation), so this is the reliable "still open" signal.
    expect(document.body.classList.contains('has-overlay')).toBe(true)

    // A real backdrop click (down and up both on the backdrop) still closes.
    overlay.dispatchEvent(new window.Event('pointerdown', { bubbles: false }))
    overlay.dispatchEvent(new window.Event('pointerup', { bubbles: false }))
    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: false }))
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('saves on a bare Enter from a single-line input', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor() // new contact
    const editor = document.querySelector('.overlay--editor')
    const firstName = editor.querySelector('input[name="firstName"]')
    firstName.value = 'Zed'
    firstName.dispatchEvent(new window.Event('input', { bubbles: true }))

    const before = store.all.length
    firstName.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    await tick()

    expect(store.all.length).toBe(before + 1)
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('shows and persists an editable nickname', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true
    const c = normalizeContact({ id: 'nick1', firstName: 'Margaret', nickname: 'Peggy' })
    store.contacts.set(c.id, c)

    openEditor(c)
    const editor = document.querySelector('.overlay--editor')
    const nick = editor.querySelector('input[name="nickname"]')
    expect(nick).toBeTruthy()
    expect(nick.value).toBe('Peggy')

    nick.value = 'Meg'
    nick.dispatchEvent(new window.Event('input', { bubbles: true }))
    click(editor.querySelector('[data-action="save"]'))
    await tick()
    await tick()

    expect(store.get('nick1').nickname).toBe('Meg')
  })

  it('preserves a year-less birthday through an edit (no data loss)', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true
    const c = normalizeContact({ id: 'b1', firstName: 'Ada', birthday: '0000-04-15' })
    store.contacts.set(c.id, c)

    openEditor(c)
    const editor = document.querySelector('.overlay--editor')
    expect(editor.querySelector('input[name="birthday"]').value).toBe('2000-04-15')
    expect(editor.querySelector('input[name="birthdayNoYear"]').checked).toBe(true)

    // Save untouched — the year-less birthday must survive, not get wiped.
    click(editor.querySelector('[data-action="save"]'))
    await tick()
    await tick()
    expect(store.get('b1').birthday).toBe('0000-04-15')
  })

  it('labels the birthday field without nesting labels (valid HTML)', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor()
    const editor = document.querySelector('.overlay--editor')
    // No <label> may nest inside another (the old markup wrapped the date
    // input and the "Hide year" checkbox+label in one outer label).
    expect(editor.querySelector('label label')).toBeFalsy()
    // The date input keeps a real label via for/id instead.
    const bday = editor.querySelector('input[name="birthday"]')
    expect(bday.id).toBe('editor-birthday')
    expect(editor.querySelector('label[for="editor-birthday"]').textContent).toBe('Birthday')
    // And every label wraps at most one labelable control.
    for (const label of editor.querySelectorAll('label')) {
      expect(label.querySelectorAll('input, select, textarea').length).toBeLessThanOrEqual(1)
    }

    press('Escape')
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('names every repeat-row value input for assistive tech', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor()
    const editor = document.querySelector('.overlay--editor')
    for (const [group, expected] of [
      ['emails', 'Email address'],
      ['phones', 'Phone number'],
      ['urls', 'Link URL'],
    ]) {
      click(editor.querySelector(`[data-action="add-row"][data-group="${group}"]`))
      const input = editor.querySelector(`.form-group[data-group="${group}"] .repeat-row__value`)
      expect(input.getAttribute('aria-label')).toBe(expected)
    }

    press('Escape')
    await tick()
    expect(document.body.classList.contains('has-overlay')).toBe(false)
  })

  it('stores a year-less birthday when "Hide year" is checked', async () => {
    window.puter = { env: 'web', kv: { set: async () => true }, ui: {} }
    store.loaded = true

    openEditor() // new contact
    const editor = document.querySelector('.overlay--editor')
    const fn = editor.querySelector('input[name="firstName"]')
    fn.value = 'Bee'
    fn.dispatchEvent(new window.Event('input', { bubbles: true }))
    editor.querySelector('input[name="birthday"]').value = '1990-04-15'
    editor.querySelector('input[name="birthdayNoYear"]').checked = true

    click(editor.querySelector('[data-action="save"]'))
    await tick()
    await tick()
    expect(store.all.find((x) => x.firstName === 'Bee').birthday).toBe('0000-04-15')
  })
})
