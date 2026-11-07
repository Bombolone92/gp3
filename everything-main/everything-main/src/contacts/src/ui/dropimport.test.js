// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { isVCardFile, startDropImport } from './dropimport.js'

/** A drag event carrying `files`, as a browser would deliver it. */
function dragEvent(type, files = []) {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  e.dataTransfer = {
    types: files.length ? ['Files'] : [],
    files,
    dropEffect: 'none',
  }
  return e
}

function vcf(name = 'ada.vcf', body = 'BEGIN:VCARD\r\nEND:VCARD\r\n') {
  return new window.File([body], name, { type: 'text/vcard' })
}

/** Wire up against a throwaway target, with a zone element to watch. */
function setup({ win } = {}) {
  const target = document.createElement('div')
  const zone = document.createElement('div')
  zone.setAttribute('hidden', '')
  document.body.append(target, zone)

  const onFiles = vi.fn()
  const onRejected = vi.fn()
  const server = startDropImport({ zone, onFiles, onRejected, target, win: win || {} })
  return {
    target,
    onFiles,
    onRejected,
    server,
    shown: () => !zone.hasAttribute('hidden'),
    cleanup: () => {
      server.stop()
      target.remove()
      zone.remove()
    },
  }
}

describe('isVCardFile', () => {
  it('accepts vCards by extension, whatever the case or MIME type', () => {
    expect(isVCardFile({ name: 'ada.vcf' })).toBe(true)
    expect(isVCardFile({ name: 'Ada Lovelace.VCF' })).toBe(true)
    expect(isVCardFile({ name: 'contacts.vcard' })).toBe(true)
    // Some browsers send no type at all for .vcf — the name has to be enough.
    expect(isVCardFile({ name: 'export.vcf', type: '' })).toBe(true)
  })

  it('accepts a vCard MIME type even when the name has no extension', () => {
    expect(isVCardFile({ name: 'download', type: 'text/vcard' })).toBe(true)
    expect(isVCardFile({ name: 'download', type: 'text/x-vcard' })).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isVCardFile({ name: 'photo.png', type: 'image/png' })).toBe(false)
    expect(isVCardFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false)
    expect(isVCardFile({ name: 'Documents' })).toBe(false)
    expect(isVCardFile(null)).toBe(false)
  })
})

describe('startDropImport', () => {
  it('imports a dropped vCard', async () => {
    const t = setup()
    const file = vcf()
    t.target.dispatchEvent(dragEvent('drop', [file]))

    expect(t.onFiles).toHaveBeenCalledTimes(1)
    expect(t.onFiles.mock.calls[0][0]).toEqual([file])
    expect(t.onRejected).not.toHaveBeenCalled()
    t.cleanup()
  })

  it('takes the drop away from the browser, which would otherwise navigate to the file', () => {
    const t = setup()
    const over = dragEvent('dragover', [vcf()])
    const drop = dragEvent('drop', [vcf()])
    t.target.dispatchEvent(over)
    t.target.dispatchEvent(drop)

    expect(over.defaultPrevented).toBe(true)
    expect(drop.defaultPrevented).toBe(true)
    t.cleanup()
  })

  it('passes on only the vCards of a mixed drop', () => {
    const t = setup()
    const card = vcf()
    const photo = new window.File(['x'], 'selfie.png', { type: 'image/png' })
    t.target.dispatchEvent(dragEvent('drop', [photo, card]))

    expect(t.onFiles.mock.calls[0][0]).toEqual([card])
    t.cleanup()
  })

  it('reports a drop with nothing importable in it rather than ignoring it', () => {
    const t = setup()
    t.target.dispatchEvent(dragEvent('drop', [new window.File(['x'], 'selfie.png')]))

    expect(t.onFiles).not.toHaveBeenCalled()
    expect(t.onRejected).toHaveBeenCalledTimes(1)
    t.cleanup()
  })

  it('ignores a drag that carries no files (dragged text, a link)', () => {
    const t = setup()
    const over = dragEvent('dragover')
    t.target.dispatchEvent(dragEvent('dragenter'))
    t.target.dispatchEvent(over)
    t.target.dispatchEvent(dragEvent('drop'))

    expect(t.shown()).toBe(false)
    expect(over.defaultPrevented).toBe(false)
    expect(t.onFiles).not.toHaveBeenCalled()
    expect(t.onRejected).not.toHaveBeenCalled()
    t.cleanup()
  })

  it('shows the drop indicator while a file is over the window, and hides it after', () => {
    const t = setup()
    expect(t.shown()).toBe(false)

    t.target.dispatchEvent(dragEvent('dragenter', [vcf()]))
    expect(t.shown()).toBe(true)

    t.target.dispatchEvent(dragEvent('dragleave', [vcf()]))
    expect(t.shown()).toBe(false)

    // A drop hides it too — there is no dragleave before one.
    t.target.dispatchEvent(dragEvent('dragenter', [vcf()]))
    t.target.dispatchEvent(dragEvent('drop', [vcf()]))
    expect(t.shown()).toBe(false)
    t.cleanup()
  })

  it('keeps the indicator up while the pointer crosses elements inside the app', () => {
    const t = setup()
    // Real sequence for a move from one element to the next: the new target's
    // dragenter arrives before the old target's dragleave. A boolean flag would
    // blink off here.
    t.target.dispatchEvent(dragEvent('dragenter', [vcf()]))
    t.target.dispatchEvent(dragEvent('dragenter', [vcf()]))
    t.target.dispatchEvent(dragEvent('dragleave', [vcf()]))
    expect(t.shown()).toBe(true)

    t.target.dispatchEvent(dragEvent('dragleave', [vcf()]))
    expect(t.shown()).toBe(false)
    t.cleanup()
  })

  it('shows the indicator for a drag that arrives without a dragenter', () => {
    const t = setup()
    t.target.dispatchEvent(dragEvent('dragover', [vcf()]))
    expect(t.shown()).toBe(true)
    t.cleanup()
  })

  it('stop() releases the app: no more indicator, no more imports', () => {
    const t = setup()
    t.server.stop()

    t.target.dispatchEvent(dragEvent('dragenter', [vcf()]))
    t.target.dispatchEvent(dragEvent('drop', [vcf()]))
    expect(t.shown()).toBe(false)
    expect(t.onFiles).not.toHaveBeenCalled()
    t.cleanup()
  })

  describe('files dragged from the Puter desktop', () => {
    // Those never fire a DOM drag event — Puter hands them over as cloud items.
    function puterWin(items) {
      let handler = null
      return {
        win: { puter: { ui: { onItemsOpened: (fn) => (handler = fn) } } },
        open: () => handler(items),
      }
    }

    function fsItem(name, text, extra = {}) {
      return {
        name,
        isDirectory: false,
        read: async () => new window.Blob([text]),
        ...extra,
      }
    }

    it('imports a vCard item, reading it from the cloud', async () => {
      const desktop = puterWin([fsItem('ada.vcf', 'BEGIN:VCARD\r\nFN:Ada\r\nEND:VCARD\r\n')])
      const t = setup({ win: desktop.win })

      desktop.open()
      expect(t.onFiles).toHaveBeenCalledTimes(1)
      const [file] = t.onFiles.mock.calls[0][0]
      expect(file.name).toBe('ada.vcf')
      expect(await file.text()).toContain('FN:Ada')
      t.cleanup()
    })

    it('falls back to the signed read URL when the path is not ours to read', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, text: async () => 'BEGIN:VCARD\r\nEND:VCARD\r\n' }))
      const realFetch = globalThis.fetch
      globalThis.fetch = fetchMock

      const desktop = puterWin([
        fsItem('shared.vcf', '', {
          read: async () => {
            throw new Error('permission denied')
          },
          readURL: 'https://api.puter.test/read?signature=abc',
        }),
      ])
      const t = setup({ win: desktop.win })

      desktop.open()
      const [file] = t.onFiles.mock.calls[0][0]
      expect(await file.text()).toContain('BEGIN:VCARD')
      expect(fetchMock).toHaveBeenCalledWith('https://api.puter.test/read?signature=abc')

      globalThis.fetch = realFetch
      t.cleanup()
    })

    it('skips folders, and reports items that hold no contacts', () => {
      const desktop = puterWin([
        { name: 'Pictures', isDirectory: true },
        fsItem('selfie.png', ''),
      ])
      const t = setup({ win: desktop.win })

      desktop.open()
      expect(t.onFiles).not.toHaveBeenCalled()
      expect(t.onRejected).toHaveBeenCalledTimes(1)
      expect(t.onRejected.mock.calls[0][0]).toHaveLength(1) // the folder is not an item to complain about
      t.cleanup()
    })

    it('survives a desktop with no onItemsOpened, leaving OS drops working', () => {
      const t = setup({ win: { puter: { ui: {} } } })
      t.target.dispatchEvent(dragEvent('drop', [vcf()]))
      expect(t.onFiles).toHaveBeenCalledTimes(1)
      t.cleanup()
    })
  })
})
