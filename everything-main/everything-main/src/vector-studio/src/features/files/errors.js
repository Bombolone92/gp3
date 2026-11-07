/**
 * Turning storage failures into messages people can act on, and the
 * "could not save" dialog with Retry and a local-copy escape hatch.
 */
import { h } from '../../lib/dom.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { isMissing } from './backends.js';

export function errorText(err) {
  return String(err?.message || err?.error?.message || (typeof err === 'string' ? err : '') || '');
}

/**
 * Classify an error: { kind, message, transient }.
 * kind: offline | quota | permission | missing | format | other
 */
export function classifyError(err, { online = typeof navigator === 'undefined' ? true : navigator.onLine !== false } = {}) {
  const code = String(err?.code || err?.error?.code || '');
  const msg = errorText(err);
  if (err?.name === 'FileFormatError') return { kind: 'format', message: msg, transient: false };
  if (!online || /network|failed to fetch|offline|timed? ?out|ECONN|socket/i.test(msg) || err?.name === 'NetworkError') {
    return { kind: 'offline', message: 'You appear to be offline or the connection dropped. Check your connection and try again.', transient: true };
  }
  if (/quota|storage_limit|storage limit|insufficient|no space|disk full|exceed/i.test(code + ' ' + msg) || err?.name === 'QuotaExceededError') {
    return { kind: 'quota', message: 'Your storage is full. Free up space (empty the Trash or delete files you no longer need), then try again.', transient: false };
  }
  if (/permission|forbidden|not allowed|access denied|unauthori[sz]ed|403|401/i.test(code + ' ' + msg) || err?.name === 'NotAllowedError' || err?.status === 403 || err?.status === 401) {
    return { kind: 'permission', message: 'Vector Studio is not allowed to write to this location. Choose another location with Save As.', transient: false };
  }
  if (isMissing(err)) return { kind: 'missing', message: 'The file or its folder no longer exists. It may have been moved or deleted.', transient: false };
  return { kind: 'other', message: msg ? `The storage service reported: ${msg}` : 'Something went wrong while talking to the storage service.', transient: true };
}

/** Resolves 'retry' | 'download' | 'saveAs' | null. */
export function saveErrorDialog(name, info, { canSaveAs = true } = {}) {
  return openDialog({
    title: 'Could Not Save',
    body: h('div.files-error', h('p.dialog-message', `"${name}" could not be saved.`), h('p.dialog-message.muted', info.message)),
    buttons: [
      { label: 'Save a Copy to This Computer', value: 'download', left: true },
      ...(canSaveAs && (info.kind === 'permission' || info.kind === 'missing') ? [{ label: 'Save As...', value: 'saveAs' }] : [{ label: 'Cancel', value: null }]),
      { label: 'Retry', value: 'retry', primary: true },
    ],
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
