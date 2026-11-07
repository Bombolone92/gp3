// A small promise-based confirmation dialog, used for destructive actions.
import { escapeHtml } from '../format.js'
import { trapTab, focusKeeper, backdropDismisser } from './modal.js'

/**
 * @returns {Promise<boolean>} resolves true if confirmed, false otherwise.
 */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const restoreFocus = focusKeeper()
    const overlay = document.createElement('div')
    overlay.className = 'overlay overlay--confirm'
    overlay.innerHTML = `
      <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title" class="confirm__title">${escapeHtml(title)}</h2>
        ${message ? `<p class="confirm__msg">${escapeHtml(message)}</p>` : ''}
        <div class="confirm__actions">
          <button class="btn btn--soft" data-confirm="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`
    const dialog = overlay.querySelector('.confirm')
    document.body.appendChild(overlay)
    // Stand the app's global shortcuts down (and lock background scroll) while
    // the dialog is up — otherwise "n", "/" or the arrow keys still act on the
    // page underneath. When stacked over another overlay (e.g. the editor's
    // discard confirm), that overlay still owns the class, so leave it in place.
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
    const onKey = (e) => {
      if (trapTab(e, dialog)) return
      if (e.key === 'Escape') return close(false)
      if (e.key === 'Enter') {
        // Activate whichever button is focused — never force "confirm"
        // regardless of focus (which would let Enter delete/discard even when
        // the user has tabbed to Cancel). Default focus sits on the primary
        // action, so the common case still confirms.
        const focused = document.activeElement
        const choice = focused && focused.dataset ? focused.dataset.confirm : null
        close(choice ? choice === 'ok' : true)
      }
    }
    const isBackdropDismiss = backdropDismisser(overlay)
    overlay.addEventListener('click', (e) => {
      if (isBackdropDismiss(e)) close(false)
      const btn = e.target.closest('[data-confirm]')
      if (btn) close(btn.dataset.confirm === 'ok')
    })
    document.addEventListener('keydown', onKey, true)
    overlay.querySelector('[data-confirm="ok"]').focus()
  })
}
