/**
 * Links into the app itself, read as words. A permalink the app writes for
 * itself — the "Also sent from" line under a reply sent to the channel too, a
 * forward's link back to the original, a copied message link — names a place
 * in the workspace, and a reader is better served by the place ("thread in
 * #general") than by sixty characters of address. The message renderer draws
 * such a link as words (see decorateAppLink in message.js); the previews of a
 * message elsewhere (the Sent tab, Activity, the DMs pane, the pinned list, a
 * notification's body, a search result's line) read it the same way through
 * previewWords and appLinkWords here, and the Files & links list leaves it out
 * (workspaceLinkRoute).
 */
import { store } from '../lib/store.js';
import { parseAppLink } from '../lib/router.js';
import { parseRef } from '../lib/refs.js';
import { previewText } from '../lib/format.js';

/**
 * Whether a link stays inside this served app — the origin and path the app's
 * own permalinks carry (absoluteLink), with no query. Routes are recognized
 * by fragment shape alone, so without this check a foreign address wearing a
 * workspace-shaped fragment (https://evil.example/#/ws/…, and every member
 * knows the refs) could be dressed up as a trusted-looking internal link.
 */
export function inAppUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname === location.pathname && !u.search;
  } catch {
    return false;
  }
}

/** The route behind a link into THIS workspace, or null: another workspace's link keeps its address. */
export function hereRoute(url) {
  const route = parseAppLink(url);
  if (!route) return null;
  const here = parseRef(store.wsId);
  const there = parseRef(route.ws);
  return here && there && here.id === there.id && here.server === there.server ? route : null;
}

/** What a link into this workspace is, in words, or null for one this client cannot name. */
export function appLinkLabel(route) {
  if (!route.conv || !store.canAccess(route.conv)) return null;
  const title = store.convTitle(route.conv);
  const where = store.channel(route.conv) ? title : `your DM with ${title}`;
  if (route.thread != null) return route.message != null ? `reply in ${where}` : `thread in ${where}`;
  if (route.message != null) return `message in ${where}`;
  return where;
}

/**
 * The route behind a permalink into this workspace from this served app, or
 * null for any other address. Such a link is a way around the workspace, not
 * something shared into it: the Files & links list leaves it out, where a
 * page of raw addresses would otherwise say nothing a reader wants.
 */
export function workspaceLinkRoute(url) {
  return inAppUrl(url) ? hereRoute(url) : null;
}

/**
 * A permalink into this workspace as the renderer would draw it ("thread in
 * #general"), or null for an address that is not one, or one this client
 * cannot name (a conversation it cannot read, another workspace's): those
 * keep their address, as they do in the message.
 */
export function appLinkWords(url) {
  const route = workspaceLinkRoute(url);
  return route ? appLinkLabel(route) : null;
}

/** previewText with the app's own permalinks read as words (see appLinkWords). */
export function previewWords(text, max) {
  return previewText(text, max, { appLink: appLinkWords });
}
