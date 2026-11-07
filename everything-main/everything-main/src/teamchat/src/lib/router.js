/**
 * Hash routes, so deep links and the back button work without a server.
 * Workspaces are addressed by reference (`{wsId}@{server}`, see refs.js), so
 * a link carries everything needed to reach the right worker:
 *
 *   #/                                   home (first workspace or onboarding)
 *   #/join/:server/XXXX-XXXX-XXXX        accept an invite
 *   #/connect/:server/XXXX-XXXX-XXXX     accept a share link: add another workspace's channel to one of yours
 *   #/ws/:ref                            workspace (conversation list on small screens)
 *   #/ws/:ref/c/:conv                    conversation
 *   #/ws/:ref/c/:conv/t/:seq             conversation with a thread open
 *   #/ws/:ref/c/:conv/details            conversation with its details open
 *   #/ws/:ref/c/:conv/files              the conversation's Files & links tab
 *   #/ws/:ref/c/:conv/m/:seq             conversation scrolled to one message
 *   #/ws/:ref/c/:conv/t/:root/m/:seq     thread open, scrolled to one reply
 *   #/ws/:ref/search[/:query]            search results for a query
 *   #/ws/:ref/threads | drafts | files | directory   main-column views: Threads, Drafts & sent, Files, Directory
 *   #/ws/:ref/dms | activity | later     a list pane in place of the sidebar (the rail's views)
 *   #/ws/:ref/dms/c/:conv[/...]          that pane, with a conversation open beside it
 */
export const PANE_VIEWS = ['dms', 'activity', 'later'];
export const VIEWS = ['threads', 'activity', 'later', 'drafts', 'dms', 'files', 'directory'];
import { isServerKey, serverKeyOf, canonicalRef } from './refs.js';
import { normalizeInviteCode } from '../shared/ids.js';

/** decodeURIComponent that keeps a segment as typed when its escapes are broken (a mangled link). */
function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function parseHash(hash = '') {
  // A query tacked onto the end of a link (`…/m/5?utm_source=mail`,
  // `…/CODE?ref=x`: a tracker's, or a hand's, after the fragment) is nobody's
  // segment. The app writes none (buildHash encodes a "?" a search query
  // holds as %3F, which stays), so a raw one begins something to leave off:
  // kept, it made the code of an invite "not valid", and a permalink open
  // the conversation without the jump to its message.
  const path = String(hash).replace(/^#/, '').replace(/^\/+/, '').replace(/\?.*$/, '');
  const seg = path.split('/').filter(Boolean).map(decodeSegment);
  const route = { name: 'home', ws: null, conv: null, thread: null, message: null, details: false, files: false, query: null, view: null, code: null, server: null };
  if (!seg.length) return route;
  if (seg[0] === 'join') {
    // Links from the single-worker era had no server segment. The server by
    // its short name (see serverKeyOf), as a reference carries it.
    if (seg.length >= 3) return { ...route, name: 'join', server: serverKeyOf(seg[1]) || seg[1].toLowerCase(), code: seg[2] };
    if (seg[1]) return { ...route, name: 'join', server: null, code: seg[1] };
    return route;
  }
  if (seg[0] === 'connect') {
    if (seg.length >= 3) return { ...route, name: 'connect', server: serverKeyOf(seg[1]) || seg[1].toLowerCase(), code: seg[2] };
    // A share link is always server and code; one that lost a part (cut
    // short in a paste) is still a share link, and is judged as one, so the
    // reader is told it is not valid rather than landed at home in silence.
    if (seg[1]) return { ...route, name: 'connect', server: null, code: seg[1] };
    return route;
  }
  if (seg[0] === 'ws' && seg[1]) {
    route.name = 'workspace';
    // Under the one spelling of the reference (see refs.js canonicalRef), so
    // that the shell, the store and every route built from the store's id
    // agree on it from the first route on: a link with the server in
    // capitals, or by its long name, opened the workspace, and the first
    // conversation picked in it built a route under the other spelling,
    // which read as a switch to another workspace and reopened this one.
    // What is not a reference is carried as typed, for the loader to refuse.
    route.ws = canonicalRef(seg[1]) || seg[1];
    let base = 2;
    if (VIEWS.includes(seg[2])) {
      route.name = 'view';
      route.view = seg[2];
      base = 3;
    }
    if (seg[base] === 'c' && seg[base + 1]) {
      route.name = 'conversation';
      route.conv = seg[base + 1];
      let i = base + 2;
      if (seg[i] === 't' && /^\d+$/.test(seg[i + 1] || '')) {
        route.thread = Number(seg[i + 1]);
        i += 2;
      }
      if (seg[i] === 'm' && /^\d+$/.test(seg[i + 1] || '')) route.message = Number(seg[i + 1]);
      else if (seg[i] === 'details' && route.thread == null) route.details = true;
      else if (seg[i] === 'files' && route.thread == null) route.files = true;
    } else if (base === 2 && seg[2] === 'search') {
      route.name = 'search';
      route.query = seg.slice(3).join('/') || '';
    }
    return route;
  }
  return route;
}

export function buildHash({ ws, conv, thread, message, details, files, query, view, code, server, connect } = {}) {
  if (code && connect) return `#/connect/${encodeURIComponent(server)}/${encodeURIComponent(code)}`;
  if (code) return server ? `#/join/${encodeURIComponent(server)}/${encodeURIComponent(code)}` : `#/join/${encodeURIComponent(code)}`;
  if (!ws) return '#/';
  let h = `#/ws/${encodeURIComponent(ws)}`;
  if (query != null) return `${h}/search${query ? `/${encodeURIComponent(query)}` : ''}`;
  if (view) h += `/${view}`;
  if (conv) {
    h += `/c/${encodeURIComponent(conv)}`;
    if (thread != null) h += `/t/${thread}`;
    if (message != null) h += `/m/${message}`;
    else if (details && thread == null) h += '/details';
    else if (files && thread == null) h += '/files';
  }
  return h;
}

/** Absolute link to a route, for sharing. */
export function absoluteLink(route) {
  return `${location.origin}${location.pathname}${typeof route === 'string' ? route : buildHash(route)}`;
}

/**
 * The workspace route behind a full link into the app, or null. Recognized
 * by the fragment's shape, not the link's host — the app is served from
 * wherever it is served, and the reference in the fragment already names
 * the workspace (see isAppLink in shared/limits.js, kept to the same
 * shapes). Join and connect links stay null on purpose: their codes are
 * credentials, and a renderer has no business dressing those up.
 */
export function parseAppLink(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (!/^#\/ws\//.test(u.hash)) return null;
  const route = parseHash(u.hash);
  return route.ws ? route : null;
}

export function navigate(route, { replace = false } = {}) {
  // Opening a conversation from inside a pane (DMs, Activity, Later) keeps
  // the pane beside it unless the caller says otherwise with `view: null`.
  if (route && typeof route === 'object' && route.conv && !('view' in route)) {
    const cur = parseHash(location.hash);
    if (PANE_VIEWS.includes(cur.view)) route = { ...route, view: cur.view };
  }
  const h = typeof route === 'string' ? route : buildHash(route);
  if (location.hash === h) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function inviteLink(server, code) {
  return `${location.origin}${location.pathname}${buildHash({ server, code })}`;
}

/** The link that shares a channel with another workspace (#/connect/server/code). */
export function connectLink(server, code) {
  return `${location.origin}${location.pathname}${buildHash({ server, code, connect: true })}`;
}

/**
 * Pull a share link's code and server out of whatever was pasted: the link
 * itself (#/connect/server/code), or the code with its server
 * (CODE@server). Null when it is not one; a plain invite link is not.
 */
export function parseConnectInput(input) {
  const s = String(input || '').trim();
  const link = /#\/connect\/([^/\s]+)\/([^/\s?#]+)/.exec(s);
  if (link) return { code: normalizeInviteCode(decodeSegment(link[2])), server: decodeSegment(link[1]).toLowerCase() };
  if (/#\/join\//.test(s)) return null;
  const at = s.lastIndexOf('@');
  if (at > 0) {
    const key = serverKeyOf(s.slice(at + 1).trim()); // a URL, a puter.work host, or the bare name: one key
    const code = normalizeInviteCode(s.slice(0, at));
    return code && isServerKey(key) ? { code, server: key } : null;
  }
  return null;
}

/**
 * Pull an invite out of whatever was pasted: a link (#/join/server/code), an
 * invite token (CODE@server), or a bare code. Returns { code, server } with
 * `server` null when the input did not name one, or null when there is no
 * code at all.
 */
export function parseInviteInput(input) {
  const s = String(input || '').trim();
  const link = /#\/join\/([^/\s]+)(?:\/([^/\s?#]+))?/.exec(s);
  if (link) {
    if (link[2]) return { code: normalizeInviteCode(decodeSegment(link[2])), server: decodeSegment(link[1]).toLowerCase() };
    return { code: normalizeInviteCode(decodeSegment(link[1])), server: null };
  }
  const at = s.lastIndexOf('@');
  if (at > 0) {
    const key = serverKeyOf(s.slice(at + 1).trim());
    return { code: normalizeInviteCode(s.slice(0, at)), server: isServerKey(key) ? key : null };
  }
  const code = normalizeInviteCode(s);
  return code ? { code, server: null } : null;
}
