// @vitest-environment happy-dom
//
// Integration smoke test: boots the whole app against a stubbed Puter SDK and
// drives it through the DOM, catching wiring bugs the pure unit tests can't.
import { describe, it, expect } from 'vitest'
import { store } from '../store.js'
import { mountApp } from './app.js'
import { disposeCalendar } from './calendar.js'
import { contactKey } from '../model.js'

function stubPuter() {
  const kv = new Map()
  window.puter = {
    env: 'web',
    appID: 'contacts-test',
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'tester', email: 'tester@example.com' }),
      signOut: async () => {},
    },
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
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
    },
    ui: {},
  }
  return kv
}

function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

// Let pending promise chains (dialog resolution → store writes → re-render) run.
async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('app integration', () => {
  it('mounts, loads contacts, selects one, and opens the editor', async () => {
    const kv = stubPuter()
    kv.set(contactKey('1'), {
      id: '1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      emails: [{ label: 'Work', value: 'ada@engine.io' }],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, { email: 'tester@example.com' })

    await store.load()

    // The contact shows up in the list.
    const item = root.querySelector('.contact-item')
    expect(item).toBeTruthy()
    expect(item.textContent).toContain('Ada Lovelace')

    // Selecting it renders the detail pane with the email.
    click(item)
    expect(root.querySelector('.detail__card')).toBeTruthy()
    expect(root.querySelector('.detail__card').textContent).toContain('ada@engine.io')

    // The "New" button opens the editor modal.
    click(root.querySelector('[data-action="new"]'))
    const modal = document.querySelector('.overlay--editor .modal')
    expect(modal).toBeTruthy()
    expect(modal.textContent).toContain('New contact')
  })

  it('shows a loading state until the first load resolves (not the empty-book card)', async () => {
    stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})

    // While loading: a spinner, never the "Your address book is empty" card.
    expect(root.querySelector('.list-loading')).toBeTruthy()
    expect(root.querySelector('.list-empty')).toBeFalsy()
    // The detail shows a neutral spinner too — not the "choose someone" CTA.
    expect(root.querySelector('.detail__loading')).toBeTruthy()
    expect(root.querySelector('.detail__empty')).toBeFalsy()

    await store.load()

    // Loaded with zero contacts: now (and only now) the empty-book card.
    expect(root.querySelector('.list-loading')).toBeFalsy()
    expect(root.querySelector('.list-empty')).toBeTruthy()
    // And the detail's empty state replaces the loading spinner...
    expect(root.querySelector('.detail__loading')).toBeFalsy()
    expect(root.querySelector('.detail__empty')).toBeTruthy()
    // ...carrying the page's single <h1> (heading hierarchy).
    expect(root.querySelector('.detail__empty h1')).toBeTruthy()
  })

  it('marks the listbox multi-selectable only in select mode', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.selectMode = false
    kv.set(contactKey('m1'), { id: 'm1', firstName: 'Mary' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    expect(root.querySelector('[role="listbox"]').getAttribute('aria-multiselectable')).toBe(null)

    store.enterSelectMode()
    expect(root.querySelector('[role="listbox"]').getAttribute('aria-multiselectable')).toBe('true')
    store.exitSelectMode()
  })

  it('does not create duplicate contacts when Save is double-clicked', async () => {
    stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()
    const before = store.all.length

    click(root.querySelector('[data-action="new"]'))
    const modal = [...document.querySelectorAll('.overlay--editor .modal')].pop()
    const firstName = modal.querySelector('input[name="firstName"]')
    firstName.value = 'Zed'
    firstName.dispatchEvent(new window.Event('input', { bubbles: true }))

    const saveBtn = modal.querySelector('[data-action="save"]')
    click(saveBtn)
    click(saveBtn) // a rapid second click must be ignored, not save again

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(store.all.length).toBe(before + 1)
  })

  it('highlights the sidebar row while its context menu is open', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    kv.set(contactKey('h1'), { id: 'h1', firstName: 'Grace', lastName: 'Hopper' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const item = root.querySelector('.contact-item')
    expect(item.classList.contains('is-menu-open')).toBe(false)

    // Right-clicking the row opens its menu and marks the row.
    item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    expect(item.classList.contains('is-menu-open')).toBe(true)

    // Dismissing the menu (Escape) clears the highlight again.
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeFalsy()
    expect(item.classList.contains('is-menu-open')).toBe(false)
  })

  it('keeps the highlight when a menu re-opens over an undismissed one', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    kv.set(contactKey('h2'), { id: 'h2', firstName: 'Radia', lastName: 'Perlman' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const item = root.querySelector('.contact-item')
    item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    expect(item.classList.contains('is-menu-open')).toBe(true)

    // Open the same row's menu again without dismissing the first (no pointer-
    // down in between, as with a keyboard-invoked menu): the old menu's cleanup
    // must not strip the highlight the new menu just applied.
    item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    expect(document.querySelectorAll('.ctx-menu').length).toBe(1)
    expect(item.classList.contains('is-menu-open')).toBe(true)

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(item.classList.contains('is-menu-open')).toBe(false)
  })

  it('highlights the detail "More" button (and the row) while its menu is open', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    kv.set(contactKey('d1'), { id: 'd1', firstName: 'Katherine', lastName: 'Johnson' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Open the contact so the detail pane (with its "More" button) renders.
    click(root.querySelector('.contact-item'))
    const moreBtn = root.querySelector('.detail__card [data-action="menu"]')
    const row = root.querySelector('.contact-item')
    expect(moreBtn.classList.contains('is-menu-open')).toBe(false)

    click(moreBtn)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    expect(moreBtn.classList.contains('is-menu-open')).toBe(true)
    expect(row.classList.contains('is-menu-open')).toBe(true)

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeFalsy()
    expect(moreBtn.classList.contains('is-menu-open')).toBe(false)
    expect(row.classList.contains('is-menu-open')).toBe(false)
  })

  it('highlights the account and list-options buttons while their menus are open', async () => {
    stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, { email: 'tester@example.com' })
    await store.load()

    for (const sel of ['[data-action="account"]', '[data-action="list-options"]']) {
      const btn = root.querySelector(sel)
      expect(btn.classList.contains('is-menu-open')).toBe(false)

      click(btn)
      expect(document.querySelector('.ctx-menu')).toBeTruthy()
      expect(btn.classList.contains('is-menu-open')).toBe(true)

      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(document.querySelector('.ctx-menu')).toBeFalsy()
      expect(btn.classList.contains('is-menu-open')).toBe(false)
    }
  })

  it('renames a tag from the sidebar chip context menu (with validation)', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    kv.set(contactKey('r1'), { id: 'r1', firstName: 'Rae', tags: ['clients'] })
    kv.set(contactKey('r2'), { id: 'r2', firstName: 'Ro', tags: ['Clients', 'vip'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Right-clicking the chip opens the tag menu and highlights the chip.
    const chip = root.querySelector('[data-tags] .chip[data-tag="clients"]')
    expect(chip).toBeTruthy()
    chip.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    const menu = document.querySelector('.ctx-menu')
    expect(menu).toBeTruthy()
    expect(chip.classList.contains('is-menu-open')).toBe(true)

    const rename = [...menu.querySelectorAll('.ctx-menu__item')].find((b) =>
      b.textContent.includes('Rename tag'),
    )
    click(rename)
    // .pop(): a dismissed dialog lingers ~180ms before removal (see close()).
    const dialog = [...document.querySelectorAll('.overlay--confirm .confirm')].pop()
    expect(dialog).toBeTruthy()
    const input = dialog.querySelector('.confirm__input')
    expect(input.value).toBe('clients')

    // Empty and comma-carrying names are rejected inline; the dialog stays up.
    for (const bad of ['   ', 'a, b']) {
      input.value = bad
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      click(dialog.querySelector('[data-confirm="ok"]'))
      expect(document.querySelector('.overlay--confirm')).toBeTruthy()
      expect(dialog.querySelector('[data-error]').hidden).toBe(false)
    }

    input.value = 'customers'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    click(dialog.querySelector('[data-confirm="ok"]'))
    await flush()

    // Every carrier is renamed (case-insensitively) and the chip re-labels.
    expect(store.get('r1').tags).toEqual(['customers'])
    expect(store.get('r2').tags).toEqual(['customers', 'vip'])
    expect(root.querySelector('[data-tags] .chip[data-tag="customers"]')).toBeTruthy()
    expect(root.querySelector('[data-tags] .chip[data-tag="clients"]')).toBeFalsy()
  })

  it('deletes a tag via its chip menu, then undo restores it', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    kv.set(contactKey('u1'), { id: 'u1', firstName: 'Uma', tags: ['temp', 'keep'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Filter on the tag first, so the flows around clearing/restoring the
    // filter are exercised too (re-query the chip: filtering re-renders it).
    click(root.querySelector('[data-tags] .chip[data-tag="temp"]'))
    expect(store.ui.tag).toBe('temp')
    const chip = root.querySelector('[data-tags] .chip[data-tag="temp"]')
    chip.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    const del = [...document.querySelectorAll('.ctx-menu__item')].find((b) =>
      b.textContent.includes('Delete tag'),
    )
    click(del)

    // A danger confirm stands between the click and the data change.
    const dialog = [...document.querySelectorAll('.overlay--confirm .confirm')].pop()
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('Delete tag “temp”?')
    click(dialog.querySelector('[data-confirm="ok"]'))
    await flush()

    expect(store.get('u1').tags).toEqual(['keep'])
    expect(root.querySelector('[data-tags] .chip[data-tag="temp"]')).toBeFalsy()
    expect(store.ui.tag).toBe('') // filter cleared — no dead-end empty list

    // Undo from the toast puts the tag (and the filter) back exactly as it was.
    const undoBtn = [...document.querySelectorAll('[data-toast-action]')].pop()
    expect(undoBtn).toBeTruthy()
    click(undoBtn)
    await flush()
    expect(store.get('u1').tags).toEqual(['temp', 'keep'])
    expect(root.querySelector('[data-tags] .chip[data-tag="temp"]')).toBeTruthy()
    expect(store.ui.tag).toBe('temp')
  })

  it('undo after delete restores a contact that shares an email with another', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    store.ui.selectedId = null
    // Two people sharing one address (e.g. a family inbox): the import de-dup
    // would treat the deleted one as a duplicate of the survivor, so undo must
    // not go through it.
    kv.set(contactKey('mom'), { id: 'mom', firstName: 'Mom', emails: [{ label: 'Home', value: 'family@example.com' }] })
    kv.set(contactKey('dad'), { id: 'dad', firstName: 'Dad', emails: [{ label: 'Home', value: 'family@example.com' }] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Delete Dad through the row's context menu and its danger confirm.
    const row = root.querySelector('.contact-item[data-id="dad"]')
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    const del = [...document.querySelectorAll('.ctx-menu__item')].find((b) =>
      b.textContent.includes('Delete'),
    )
    click(del)
    const dialog = [...document.querySelectorAll('.overlay--confirm .confirm')].pop()
    click(dialog.querySelector('[data-confirm="ok"]'))
    await flush()
    expect(store.get('dad')).toBe(null)

    // Undo from the toast must bring Dad back exactly as he was.
    const undoBtn = [...document.querySelectorAll('[data-toast-action]')].pop()
    expect(undoBtn).toBeTruthy()
    click(undoBtn)
    await flush()
    expect(store.get('dad')).toBeTruthy()
    expect(store.get('dad').emails[0].value).toBe('family@example.com')
    expect(store.get('mom')).toBeTruthy()
  })

  it('reports live progress while a slow bulk delete runs, then clears it', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    // 30 contacts at 150ms each, six at a time: five rounds, so the job
    // comfortably outlives the toast's anti-flicker delay and the store's
    // emit-coalescing window — i.e. the case the user actually notices.
    const ids = Array.from({ length: 30 }, (_v, i) => `d${i}`)
    for (const id of ids) kv.set(contactKey(id), { id, firstName: `Del ${id}` })
    const realDel = window.puter.kv.del
    window.puter.kv.del = async (k) => {
      await new Promise((r) => setTimeout(r, 150))
      return realDel(k)
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()
    store.enterSelectMode()
    store.setChecked(ids)
    click(root.querySelector('[data-action="bulk-delete"]'))
    await flush()
    const dialog = [...document.querySelectorAll('.overlay--confirm .confirm')].pop()
    click(dialog.querySelector('[data-confirm="ok"]'))

    // Mid-job: a counter is on screen, and rows have already started leaving
    // the list instead of all vanishing at the end.
    await new Promise((r) => setTimeout(r, 500))
    const progress = document.querySelector('.toast--progress')
    expect(progress).toBeTruthy()
    expect(progress.querySelector('.toast__msg').textContent).toMatch(/^Deleting \d+ of 30…$/)
    expect(progress.querySelector('.toast__track').hidden).toBe(false)
    expect(root.querySelectorAll('.contact-item').length).toBeLessThan(30)

    await new Promise((r) => setTimeout(r, 900))
    window.puter.kv.del = realDel
    expect(store.all).toHaveLength(0)
    // The progress toast hands off to the summary rather than lingering.
    expect(document.querySelector('.toast--progress')).toBeFalsy()
    expect(document.body.textContent).toContain('Deleted 30 contacts')
    store.exitSelectMode()
  })

  it('keeps focus on "Select all" across the select-bar re-render it triggers', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('s1'), { id: 's1', firstName: 'Sam' })
    kv.set(contactKey('s2'), { id: 's2', firstName: 'Sue' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()
    store.enterSelectMode()

    // Activate "Select all" by keyboard: the bar re-stamps its HTML, and focus
    // must land on the fresh equivalent, not fall to <body>.
    const selectAll = root.querySelector('[data-action="select-all"]')
    selectAll.focus()
    click(selectAll)
    expect(store.ui.checked.size).toBe(2)
    expect(document.activeElement).toBe(root.querySelector('[data-action="select-all"]'))
    expect(document.activeElement).not.toBe(document.body)
    store.exitSelectMode()
  })

  it('keeps focus on a tag chip toggled by keyboard', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('c1'), { id: 'c1', firstName: 'Cam', tags: ['band', 'crew'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Activate the second chip by keyboard: the strip re-stamps, and focus
    // must land on the same chip (matched by its tag), not the first one.
    const chip = root.querySelector('[data-tags] .chip[data-tag="crew"]')
    chip.focus()
    click(chip)
    expect(store.ui.tag).toBe('crew')
    expect(document.activeElement).toBe(root.querySelector('[data-tags] .chip[data-tag="crew"]'))
  })

  it('opens the tag menu from a touch long-press (iOS has no contextmenu)', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    kv.set(contactKey('lp1'), { id: 'lp1', firstName: 'Lia', tags: ['crew'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const chip = root.querySelector('[data-tags] .chip[data-tag="crew"]')
    const down = new window.Event('pointerdown', { bubbles: true })
    down.pointerType = 'touch'
    down.clientX = 20
    down.clientY = 20
    chip.dispatchEvent(down)

    // Held still long enough: the tag menu opens without any contextmenu event.
    await new Promise((r) => setTimeout(r, 560))
    const menu = document.querySelector('.ctx-menu')
    expect(menu).toBeTruthy()
    expect(menu.textContent).toContain('Rename tag')
    expect(chip.classList.contains('is-menu-open')).toBe(true)

    // The finger-lift click is swallowed — it must not toggle the tag filter.
    chip.dispatchEvent(new window.Event('pointerup', { bubbles: true }))
    click(chip)
    expect(store.ui.tag).toBe('')

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.ctx-menu')).toBeFalsy()

    // A short tap still just filters (no menu).
    const tap = new window.Event('pointerdown', { bubbles: true })
    tap.pointerType = 'touch'
    chip.dispatchEvent(tap)
    chip.dispatchEvent(new window.Event('pointerup', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    expect(document.querySelector('.ctx-menu')).toBeFalsy()
  })

  it('exposes filter toggle state via aria-pressed, not styling alone', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('p1'), { id: 'p1', firstName: 'Pat', tags: ['crew'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const allBtn = root.querySelector('[data-action="filter-all"]')
    const favBtn = root.querySelector('[data-action="filter-fav"]')
    const chip = () => root.querySelector('[data-tags] .chip[data-tag="crew"]')
    expect(allBtn.getAttribute('aria-pressed')).toBe('true')
    expect(favBtn.getAttribute('aria-pressed')).toBe('false')
    expect(chip().getAttribute('aria-pressed')).toBe('false')

    click(chip())
    expect(allBtn.getAttribute('aria-pressed')).toBe('false')
    expect(chip().getAttribute('aria-pressed')).toBe('true')

    click(favBtn)
    expect(favBtn.getAttribute('aria-pressed')).toBe('true')
    expect(allBtn.getAttribute('aria-pressed')).toBe('false')
    expect(chip().getAttribute('aria-pressed')).toBe('false')

    click(allBtn)
    expect(allBtn.getAttribute('aria-pressed')).toBe('true')
    expect(favBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('announces the visible count as a live status region', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.query = ''
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('q1'), { id: 'q1', firstName: 'Amy' })
    kv.set(contactKey('q2'), { id: 'q2', firstName: 'Bob' })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const count = root.querySelector('[data-count]')
    expect(count.getAttribute('role')).toBe('status')
    expect(count.textContent).toBe('2 contacts')

    store.setUI({ query: 'amy' })
    expect(count.textContent).toBe('1 of 2')
    store.setUI({ query: '' })
  })

  it('filtering by a tag de-highlights the "All" segment', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('t1'), { id: 't1', firstName: 'Tagged', tags: ['friend'] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const allBtn = root.querySelector('[data-action="filter-all"]')
    expect(allBtn.classList.contains('is-active')).toBe(true)

    // Activating a tag filter must quiet "All" (the chip carries the state now).
    click(root.querySelector('[data-action="filter-tag"][data-tag="friend"]'))
    expect(allBtn.classList.contains('is-active')).toBe(false)
    expect(
      root.querySelector('[data-action="filter-tag"][data-tag="friend"]').classList.contains('is-active'),
    ).toBe(true)
  })

  it('imports a vCard dropped on the app', async () => {
    stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.query = ''
    store.ui.tag = ''
    store.ui.favoritesOnly = false

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Grace Hopper\r\nEMAIL:grace@navy.mil\r\nEND:VCARD\r\n'
    const drop = new window.Event('drop', { bubbles: true, cancelable: true })
    drop.dataTransfer = {
      types: ['Files'],
      files: [new window.File([card], 'grace.vcf', { type: 'text/vcard' })],
    }
    root.dispatchEvent(drop)

    // The drop is the browser's to act on unless we claim it — unclaimed, it
    // navigates the window to the file and the app is gone.
    expect(drop.defaultPrevented).toBe(true)

    await flush()
    await flush()

    expect([...store.contacts.values()].some((c) => c.firstName === 'Grace')).toBe(true)
    expect(root.querySelector('.contact-list').textContent).toContain('Grace Hopper')
  })

  it('waits for the address book before importing, so a drop during boot cannot duplicate', async () => {
    const kv = stubPuter()
    store.contacts.clear()
    store.loaded = false
    store.error = null
    store.ui.query = ''
    store.ui.tag = ''
    store.ui.favoritesOnly = false
    kv.set(contactKey('e1'), { id: 'e1', firstName: 'Edith', lastName: 'Clarke', emails: [{ value: 'edith@ge.com' }] })

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})

    // The drop lands *before* store.load() resolves — the case where Puter opens
    // the app with a .vcf, since mountApp runs ahead of the first load.
    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Edith Clarke\r\nEMAIL:edith@ge.com\r\nEND:VCARD\r\n'
    const drop = new window.Event('drop', { bubbles: true, cancelable: true })
    drop.dataTransfer = {
      types: ['Files'],
      files: [new window.File([card], 'edith.vcf', { type: 'text/vcard' })],
    }
    root.dispatchEvent(drop)

    await store.load()
    await flush()
    await flush()

    // Edith was already in the book, so the import is a no-op — not a second copy.
    expect([...store.contacts.values()].filter((c) => c.firstName === 'Edith')).toHaveLength(1)
  })

  /**
   * Showing what is coming up with someone means holding a Calendar service
   * window open in their session. Inside the Puter desktop, closing Contacts is
   * how a user ends this app — there is no Sign out item, because the desktop
   * owns the session — so that is where the window has to be handed back.
   */
  it('lets go of the Calendar service window when this window goes away', async () => {
    disposeCalendar() // a module singleton; an earlier test decided there was no desktop

    const kv = stubPuter()
    kv.set(contactKey('1'), {
      id: '1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      emails: [{ label: 'Work', value: 'ada@engine.io' }],
    })

    // A Calendar to launch, and a desktop to launch it into.
    const service = { launched: false, closed: false }
    const listeners = new Map()
    const connection = {
      usesSDK: true,
      postMessage: (msg) =>
        setTimeout(() => {
          for (const fn of [...(listeners.get('message') || [])]) {
            fn({ $: 'calendar-api', v: 1, id: msg.id, ok: true, result: { events: [] } })
          }
        }, 0),
      on: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event).add(fn)
      },
      off: (event, fn) => listeners.get(event)?.delete(fn),
      close: () => {
        service.closed = true
      },
    }
    window.puter.env = 'app'
    window.puter.ui.launchApp = async () => {
      service.launched = true
      setTimeout(() => {
        for (const fn of [...(listeners.get('message') || [])]) {
          fn({ $: 'calendar-api', v: 1, type: 'ready', methods: ['search'] })
        }
      }, 0)
      return connection
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    mountApp(root, {})
    await store.load()

    // Looking at someone opens the connection.
    click(root.querySelector('.contact-item'))
    await flush()
    await flush()
    expect(service.launched).toBe(true)
    expect(service.closed).toBe(false)

    // Closing the window hands it back, rather than leaving it to idle out.
    window.dispatchEvent(new window.Event('pagehide'))
    expect(service.closed).toBe(true)
  })
})
