/**
 * The file picker behind Settings' "Import backup" and the recovery screen's
 * "Restore from a backup file": one judge of what a picked file is, so the
 * two say the same things about the same files. The parsed file is handed
 * on only when it is worth replacing a company with.
 */
import { el } from './dom.js';
import { toast } from './toast.js';

/* A ceiling before the file is read: nothing caps the records a backup can
   hold, and a hundred-thousand-security file parsed, imported, and then cost
   sixty KV writes on every later edit. A real export is well under a
   megabyte. */
export const BACKUP_MAX_BYTES = 20 * 1_048_576;

/**
 * Worth replacing everything with: one of our own exports, or a file
 * carrying at least one collection we recognize - a hand-assembled dataset,
 * or an export from before the envelope existed. Anything else is a
 * mis-picked file, and importing it would empty the cap table without a
 * word, because every sanitizer would simply find nothing to keep.
 */
export function looksLikeCapTableData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.app === 'captable') return true;
  return ['company', 'classes', 'stakeholders', 'securities']
    .some((k) => data[k] && typeof data[k] === 'object');
}

/** Open the picker; `onData` gets the parsed file once it has passed every check above. */
export function pickBackupFile(onData) {
  const picker = el('input', { type: 'file', accept: 'application/json,.json' });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) {
      // Rounded up to a tenth: a file just over the limit read "20 MB, larger than ... 20 MB".
      toast(`That file is ${Math.ceil((file.size / 1_048_576) * 10) / 10} MB, larger than any Cap Table export (the limit is ${BACKUP_MAX_BYTES / 1_048_576} MB)`, { icon: 'alert' });
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('That file isn’t valid JSON', { icon: 'alert' });
      return;
    }
    // Checked before any confirm, not after: there is nothing here worth
    // asking someone to trade their cap table for.
    if (!looksLikeCapTableData(data)) {
      toast('That file isn’t a Cap Table export', { icon: 'alert' });
      return;
    }
    onData(data);
  });
  picker.click();
}
