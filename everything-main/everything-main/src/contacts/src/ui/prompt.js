// A small promise-based text-input dialog (e.g. renaming a tag). Mirrors
// confirm.js in structure and styling so the two read as one dialog family.
import { escapeHtml, escapeAttr } from '../format.js'
import { trapTab, focusKeeper, backdropDismisser } from './modal.js'

/**
 * Ask the user for a single line of text.
 * @param {(value: string) => string} [opts.validate] - receives the trimmed
 *   value on submit; returns an error message to show inline (keeping the
 *   dialog open), or '' when the value is fine. Defaults to requiring
 *   non-empty text.
 * @returns {Promise<string|null>} the trimmed value, or null if cancelled.
 */
export function promptDialog({
  title = '',
  message = '',
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  validate = (v) => (v ? '' : 'Enter a value.'),
} = {}) {
  return new Promise((resolve) => {
    const restoreFocus = focusKeeper()
    const overlay = document.createElement('div')
    overlay.className = 'overlay overlay--confirm'
    overlay.innerHTML = `
      <div class="confirm" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h2 id="prompt-title" class="confirm__title">${escapeHtml(title)}</h2>
        ${message ? `<p class="confirm__msg">${escapeHtml(message)}</p>` : ''}
        <input class="input confirm__input" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttr(title)}" />
        <p class="form-error confirm__error" data-error hidden></p>
        <div class="confirm__actions">
          <button class="btn btn--soft" data-confirm="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn btn--primary" data-confirm="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`
    const dialog = overlay.querySelector('.confirm')
    const input = overlay.querySelector('.confirm__input')
    const errorEl = overlay.querySelector('[data-error]')
    document.body.appendChild(overlay)
    // Same shortcut stand-down / scroll lock dance as confirm.js, including
    // stacking over an already-open overlay.
    const hadOverlay = document.body.classList.contains('has-overlay')
    document.body.classList.add('has-overlay')
    requestAnimationFrame(() => overlay.classList.add('overlay--in'))

    const close = (result) => {
      overlay.classList.remove('overlay--in')
      document.removeEventListener('keydown', onKey, true)
      if (!hadOverlay) document.body.classList.remove('has-overlay')
      setTimeout(() => overlay.remove(), 180)
      restoreFocus()
      resolve(result)
    }
    const submit = () => {
      const v = input.value.trim()
      const err = validate(v)
      if (err) {
        errorEl.textContent = err
        errorEl.hidden = false
        input.classList.add('input--error')
        input.focus()
        return
      }
      close(v)
    }
    const onKey = (e) => {
      if (trapTab(e, dialog)) return
      if (e.key === 'Escape') return close(null)
      if (e.key === 'Enter') {
        // Enter submits from the input or the OK button, but a focused Cancel
        // stays a cancel (mirrors confirm.js's focus-respecting Enter).
        e.preventDefault()
        const focused = document.activeElement
        if (focused && focused.dataset && focused.dataset.confirm === 'cancel') return close(null)
        submit()
      }
    }
    input.addEventListener('input', () => {
      errorEl.hidden = true
      input.classList.remove('input--error')
    })
    const isBackdropDismiss = backdropDismisser(overlay)
    overlay.addEventListener('click', (e) => {
      if (isBackdropDismiss(e)) return close(null)
      const btn = e.target.closest('[data-confirm]')
      if (!btn) return
      if (btn.dataset.confirm === 'ok') submit()
      else close(null)
    })
    document.addEventListener('keydown', onKey, true)
    input.focus()
    if (typeof input.select === 'function') input.select()
  })
}
