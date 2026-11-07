// Minimal, dependency-free toast notifications.
import { icons } from './icons.js'
import { escapeHtml } from './format.js'

let container = null

function ensureContainer() {
  // Re-create when the cached stack is no longer in the document: holding a
  // detached node would silently swallow every toast from then on.
  if (container && container.isConnected) return container
  container = document.createElement('div')
  container.className = 'toast-stack'
  container.setAttribute('role', 'status')
  container.setAttribute('aria-live', 'polite')
  document.body.appendChild(container)
  return container
}

/**
 * Show a transient toast.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} [timeout] - ms before auto-dismiss; defaults longer for errors
 *   so they aren't missed.
 * @param {{label: string, onClick: function}} [action] - optional inline action
 *   button (e.g. "Undo").
 */
export function toast(message, type = 'info', timeout, action) {
  const root = ensureContainer()
  const ms = timeout == null ? (type === 'error' ? 6000 : 3200) : timeout
  const el = document.createElement('div')
  el.className = `toast toast--${type}`
  const icon = type === 'success' ? icons.check : type === 'error' ? icons.close : icons.contacts
  const actionHtml =
    action && action.label
      ? `<button type="button" class="toast__action" data-toast-action>${escapeHtml(action.label)}</button>`
      : ''
  el.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${escapeHtml(message)}</span>${actionHtml}`
  root.appendChild(el)
  requestAnimationFrame(() => el.classList.add('toast--in'))
  let timer
  const dismiss = () => {
    clearTimeout(timer)
    el.classList.remove('toast--in')
    setTimeout(() => el.remove(), 220)
  }
  if (action && action.label) {
    el.querySelector('[data-toast-action]').addEventListener('click', (e) => {
      e.stopPropagation()
      dismiss()
      try {
        action.onClick && action.onClick()
      } catch (_e) {
        /* an action that throws shouldn't break the toast */
      }
    })
  }
  el.addEventListener('click', dismiss)
  timer = setTimeout(dismiss, ms)
}

/**
 * Show a sticky toast that tracks a long-running job (bulk import/delete).
 * Unlike toast() it never auto-dismisses and ignores clicks — the caller owns
 * its lifetime through the returned handle, and should call done() in a
 * `finally` so a thrown error can't strand it on screen.
 *
 * The element is created only after `delay` ms, so the common case (a job that
 * finishes in a blink) never flashes an indicator. Call show() to skip the
 * wait when you already know the job is a big one.
 *
 * @param {string} message
 * @param {{delay?: number}} [options]
 * @returns {{update: function(string, number=), show: function, done: function}}
 */
export function progressToast(message, { delay = 300 } = {}) {
  let el = null
  let msgEl = null
  let trackEl = null
  let barEl = null
  let text = message
  let ratio = null
  let finished = false

  const paint = () => {
    if (!el) return
    msgEl.textContent = text
    const pct = ratio == null ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100)
    trackEl.hidden = pct == null
    if (pct == null) trackEl.removeAttribute('aria-valuenow')
    else {
      barEl.style.width = `${pct}%`
      trackEl.setAttribute('aria-valuenow', String(pct))
    }
    trackEl.setAttribute('aria-valuetext', text)
  }

  const show = () => {
    if (el || finished) return
    clearTimeout(timer)
    el = document.createElement('div')
    el.className = 'toast toast--progress'
    // The stack is a polite live region, and a counter ticking several times a
    // second would flood a screen reader — so this toast stays silent and
    // carries its state on the progressbar. The summary toast that replaces it
    // does the announcing.
    el.setAttribute('aria-live', 'off')
    el.innerHTML =
      `<span class="toast__spinner" aria-hidden="true"></span>` +
      `<span class="toast__msg"></span>` +
      `<span class="toast__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><span class="toast__bar"></span></span>`
    msgEl = el.querySelector('.toast__msg')
    trackEl = el.querySelector('.toast__track')
    barEl = el.querySelector('.toast__bar')
    paint()
    ensureContainer().appendChild(el)
    requestAnimationFrame(() => el && el.classList.add('toast--in'))
  }

  let timer = setTimeout(show, delay)

  return {
    show,
    /** @param {string} [next] @param {number} [nextRatio] 0–1, omit to keep. */
    update(next, nextRatio) {
      if (finished) return
      if (next != null) text = next
      if (nextRatio !== undefined) ratio = nextRatio
      paint()
    },
    done() {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (!el) return
      const node = el
      el = null
      node.classList.remove('toast--in')
      setTimeout(() => node.remove(), 220)
    },
  }
}
