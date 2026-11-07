import { toast } from './toast.js';

/** A link that opens a record in the current view. */
export function recordUrl(page, recId) {
  const base = location.href.split('#')[0];
  return `${base}#/${[page.baseId, page.tableId, page.viewId, recId].map(encodeURIComponent).join('/')}`;
}

export async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    if (message) toast(message);
  } catch {
    toast('Could not copy to the clipboard.', { error: true });
  }
}
