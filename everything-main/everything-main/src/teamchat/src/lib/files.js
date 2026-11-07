/**
 * Attachments are fetched through the worker (which checks membership) and
 * turned into object URLs for <img> and downloads. URLs are cached per
 * session and revoked when a workspace is left.
 */
import { api } from './api.js';

const cache = new Map(); // `${ws}/${id}` -> Promise<string>

/**
 * How long a fetch that failed stands in for the file before it is tried
 * again. Forgotten at once, a picture whose bytes are gone (a file deleted
 * from the owner's storage, a photo an imported card still names) was asked
 * for again by every row that drew it, on every redraw of the list, and a
 * conversation with a hundred such rows sent a hundred requests each time
 * the list was drawn. A refusal (the worker has no such file, or will not
 * hand it over) is unlikely to change within minutes; nobody answering (the
 * network, a worker being redeployed) is tried again soon. So is a 401: the
 * worker answers it whenever Puter's word on who is asking cannot be had
 * (see worker/lib.js identify), which is Puter not answering the worker for
 * a moment as often as a sign-in that has lapsed, and the polls and sends
 * refused in that moment go through again on their next try. Remembered as
 * a refusal, every photo and picture drawn during it stayed broken (initials
 * for the photo, a blank card for the picture) for five minutes after the
 * rest of the app had recovered. And so is the host of a shared channel
 * asking for a fresh attestation (403 `reattest`: an external member's seat
 * there lapsed), which the store renews on its own at the next poll or
 * send, as it does for the sends and reads refused the same way (see the
 * store's _loadLink and _readRenewable); remembered as a refusal, the
 * pictures and photos of the shared channel stayed broken for five minutes
 * after the seat was renewed and everything else there worked again.
 */
const FAIL_REFUSED_MS = 5 * 60_000;
const FAIL_UNREACHED_MS = 15_000;
// Nor a 408 or a 425, which are only ever a gateway's word (the request timed
// out on its way, or came too early), never the worker's, and pass as a 429
// does: remembered as refusals, every picture asked for in that moment stayed
// broken for five minutes after the rest of the app had recovered. Nor any
// page the platform answered with in the worker's place (`http_NNN`, an
// answer with none of the worker's words; see the store's isPlatformPage): a
// firewall's 403 page is no word of the worker's on the file.
const refused = (e) => typeof e?.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 425 && e.code !== 'no_backend' && e.code !== 'reattest' && !/^http_\d{3}$/.test(String(e.code || ''));

/**
 * The address an <img> or a download is given for a blob: an object URL,
 * except for an SVG. An object URL carries the app's own origin, and an SVG
 * is a document the browser runs scripts in when it is opened on its own,
 * which the browser's own menu on the very <img> that draws it offers
 * ("Open image in new tab"; dragging the picture to the address bar does
 * the same), so a hostile SVG posted in a channel ran with the app's origin
 * for anyone who did. The app's own ways of opening a file keep such types
 * out (see canOpenInTab), the browser's menu was open all the same. A data:
 * URL draws the same in <img> and downloads the same, and opened on its own
 * stands in an origin of its own, with nothing of the app's within reach.
 */
async function urlFor(blob) {
  if (blob.type !== 'image/svg+xml') return URL.createObjectURL(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(s)}`;
}

/**
 * One URL per key for the life of the tab (or until `clear`), made from
 * `fetch()`'s blob on the first ask (see urlFor); a fetch that failed is
 * remembered for a while (see FAIL_REFUSED_MS) rather than asked for again
 * by every caller. Shared with lib/avatars.js.
 */
export function cachedObjectUrl(map, key, fetch) {
  const hit = map.get(key);
  if (hit) {
    if (!hit.failedUntil || Date.now() < hit.failedUntil) return hit.p;
    map.delete(key);
  }
  const entry = { p: fetch().then(urlFor), failedUntil: 0 };
  entry.p.catch((e) => { entry.failedUntil = Date.now() + (refused(e) ? FAIL_REFUSED_MS : FAIL_UNREACHED_MS); });
  map.set(key, entry);
  return entry.p;
}

/** Revoke every URL a cache made and forget it all (a workspace left, another account signing in). */
export function clearObjectUrls(map) {
  for (const { p } of map.values()) p.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  map.clear();
}

export function attachmentUrl(wsId, id) {
  return cachedObjectUrl(cache, `${wsId}/${id}`, () => api.fileBlob(wsId, id));
}

/** A link preview's thumbnail, stored by and served from the worker (readers never touch the target). */
export function unfurlImageUrl(wsId, hash) {
  return cachedObjectUrl(cache, `${wsId}/uf/${hash}`, () => api.unfurlImageBlob(wsId, hash));
}

export function clearAttachmentCache() {
  clearObjectUrls(cache);
}

export function isImage(type = '') {
  return /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(type);
}

/** The video types a <video> element plays in the browsers the app runs in (QuickTime only where H.264 is built in; the player says so when it cannot). */
export function isVideo(type = '') {
  return /^video\/(mp4|webm|ogg|quicktime|x-m4v)$/.test(type);
}

/** What the media viewer shows: an image or a video. */
export function isMedia(type = '') {
  return isImage(type) || isVideo(type);
}

/**
 * Whether an attachment may be opened in a tab. Object URLs keep the app's
 * origin, so a document the browser would run scripts in (SVG above all)
 * must never be navigated to; those are downloaded instead. Raster images
 * are inert, and rendering any image inside <img> is safe either way.
 */
export function canOpenInTab(type = '') {
  return /^image\/(png|jpe?g|gif|webp|avif)$/.test(type);
}

/** Trigger a download of an attachment with its original name. */
export async function downloadAttachment(wsId, att) {
  const url = await attachmentUrl(wsId, att.id);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.name || 'file';
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}
