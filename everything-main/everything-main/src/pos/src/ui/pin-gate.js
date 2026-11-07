/**
 * The gate in front of money-sensitive actions when a manager PIN is set.
 *
 * requirePin('refund a sale') resolves true when the action may proceed:
 * immediately if no PIN is configured or a recent entry is still in grace,
 * otherwise after a correct entry in a dialog. Failed attempts back off
 * with an increasing delay that survives a reload.
 */

import { el, clear } from './dom.js';
import { openModal } from './modal.js';
import { store } from '../lib/store.js';
import { verifyPin, needsRehash, makePinRecord, lockDelayMs, PIN_GRACE_MS } from '../lib/pin.js';

let unlockedUntil = 0;

/** Attempt bookkeeping lives in localStorage so a reload doesn't reset it. */
const ATTEMPTS_KEY = 'pos:pin-attempts:v1';

function readAttempts() {
  try {
    const v = JSON.parse(localStorage.getItem(ATTEMPTS_KEY));
    return { count: Number(v?.count) || 0, lockUntil: Number(v?.lockUntil) || 0 };
  } catch {
    return { count: 0, lockUntil: 0 };
  }
}

function writeAttempts(a) {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
  } catch { /* rate limiting degrades, the PIN itself still holds */ }
}

export function pinEnabled() {
  return !!store.settings?.pin?.hash;
}

/** True when no PIN is set, or a successful entry is still in its grace. */
export function pinUnlocked() {
  return !pinEnabled() || Date.now() < unlockedUntil;
}

/** Start the grace period now - a PIN just set shouldn't prompt its setter. */
export function grantPinGrace() {
  unlockedUntil = Date.now() + PIN_GRACE_MS;
}

/** End the grace period (sign-out, PIN removal). */
export function relockPin() {
  unlockedUntil = 0;
}

/**
 * Ask for the PIN unless the gate is already open. Resolves true to
 * proceed, false when the dialog is dismissed.
 */
export function requirePin(action = 'continue') {
  if (pinUnlocked()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let verifying = false;
    let timer = null;

    const input = el('input.input.pay-tender.pin-input', {
      type: 'password', inputmode: 'numeric', autocomplete: 'off',
      maxLength: 6, placeholder: '••••', 'aria-label': 'Manager PIN',
    });
    const note = el('div.pay-change', { 'aria-live': 'polite' });
    const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Unlock');

    /** Reflect the current lockout, ticking down while one is active. */
    const renderLock = () => {
      clearInterval(timer);
      timer = null;
      const { lockUntil } = readAttempts();
      const tick = () => {
        const left = Math.ceil((lockUntil - Date.now()) / 1000);
        if (left <= 0) {
          clearInterval(timer);
          timer = null;
          clear(note);
          submit.disabled = false;
          input.disabled = false;
          // Disabling the field dropped focus to nowhere; hand it back for
          // the retype the moment entry is allowed again.
          input.focus();
          return;
        }
        submit.disabled = true;
        input.disabled = true;
        clear(note);
        note.append(el('span.pay-short', {}, `Too many tries. Wait ${left}s`));
      };
      if (lockUntil > Date.now()) {
        timer = setInterval(tick, 250);
        tick();
      }
    };

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (verifying || readAttempts().lockUntil > Date.now()) return;
        verifying = true;
        submit.disabled = true;
        const ok = await verifyPin(input.value, store.settings.pin).catch(() => false);
        verifying = false;
        if (ok) {
          writeAttempts({ count: 0, lockUntil: 0 });
          // A record from before the stretching just verified as one bare
          // SHA-256. This is the only moment the code itself is in hand, so
          // rewrite it under the current scheme; if the write doesn't land,
          // the old record still works and the next entry tries again.
          if (needsRehash(store.settings.pin)) {
            makePinRecord(input.value)
              .then((record) => store.updateSettings({ pin: record }))
              .catch(() => {});
          }
          grantPinGrace();
          resolve(true);
          modal.close();
          return;
        }
        const failed = readAttempts().count + 1;
        writeAttempts({ count: failed, lockUntil: Date.now() + lockDelayMs(failed) });
        input.value = '';
        submit.disabled = false;
        clear(note);
        note.append(el('span.pay-short', {}, 'Wrong PIN'));
        renderLock();
        input.focus();
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        `Enter the manager PIN to ${action}.`),
      el('div.field', {}, input),
      note,
      submit
    );

    const modal = openModal({
      title: 'Manager PIN',
      content: form,
      onClose: () => {
        clearInterval(timer);
        resolve(false);
      },
    });
    renderLock();
    input.focus();
  });
}
