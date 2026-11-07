/**
 * The "Files & links" tab of a conversation:
 * everything shared here, newest first, filterable to files, media, or
 * links. It is fed by the search index (`has:file` and `has:link` scoped to
 * the conversation), so it costs nothing extra to keep and only sees what
 * the index knows; each row opens the message in place.
 */
import { el, listKeyNav, rerender, keepFocus, focusMemo, clearOnEscape, radioNav } from './dom.js';
import { icon, fileIcon } from './icons.js';
import { avatar } from './avatar.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { api, isOldServer } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { formatBytes } from '../lib/format.js';
import { relativeLong, fullDateTime } from '../lib/time.js';
import { attachmentUrl, isImage, isVideo, isMedia, downloadAttachment } from '../lib/files.js';
import { openMediaViewer } from './mediaviewer.js';
import { searchIndexDialog } from './dialogs.js';
import { parentOfThread } from '../shared/blocks.js';
import { LINK_RE } from '../shared/limits.js';
import { normalize } from '../shared/search.js';
import { workspaceLinkRoute } from './applink.js';
import { fileLabel, fileLabelShort } from './filename.js';

const URL_RE = LINK_RE;
const FILTERS = [['all', 'All'], ['files', 'Files'], ['media', 'Media'], ['links', 'Links']];

export function createFilesView(convId = null) {
  // With no conversation: everything shared anywhere the reader may see.
  const everywhere = !convId;
  const root = el('div.files-view', { role: 'region', 'aria-label': 'Files and links' });
  const search = el('input.input.files-search', { type: 'search', placeholder: 'Filter by name or address', 'aria-label': 'Filter files and links', autocomplete: 'off' });
  const seg = el('div.seg.view-seg', { role: 'radiogroup', 'aria-label': 'Show' });
  const body = el('div.files-body');
  // Said aloud as well as shown: that an older page could not be read (see nextPage).
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  root.append(el('div.files-tools', {}, search, seg), body, status);

  let filter = 'all';
  let items = []; // { key, kind: 'file'|'link', ts, user, seq, conv, ...detail }
  let loading = true;
  let loadingMore = false;
  let error = null;
  let pageError = null; // an older page could not be read; the rows that came stand (see load and nextPage)
  let indexed = undefined;
  let destroyed = false;
  // Each index read (files, links) pages on its own: where to resume, and whether there is more.
  const streams = { file: { cursor: null, more: false }, link: { cursor: null, more: false } };
  let request = 0;

  const rove = radioNav(seg);
  function renderSeg() {
    rerender(seg, ...FILTERS.map(([v, label]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(filter === v),
      onclick: () => { filter = v; renderSeg(); render(); },
    }, label)));
    rove();
  }
  renderSeg();
  search.addEventListener('input', render);
  clearOnEscape(search);

  /**
   * Two index reads (files, links) merged by message, newest first. With
   * `more`, the next page of whichever read still has one, appended. With
   * `refresh` (a message arrived that may carry a file or link), the newest
   * page again, merged into what is shown: the list stays on screen, the
   * older pages already loaded stay with it, and what that page no longer
   * holds (a deleted message's file) comes off.
   */
  async function load({ more = false, refresh = false } = {}) {
    if (more && (loading || loadingMore)) return;
    // Nothing on screen worth keeping: a refresh loads afresh.
    if (refresh && (loading || error)) refresh = false;
    // A refresh does not take the place of a load in flight; merging by key,
    // its answer is right whenever it lands, and a later load supersedes it.
    const id = refresh ? request : ++request;
    // Where the keyboard is in the list before the wait takes its place (on
    // Try again, pressed): the wait has nothing to hold it, so it fell to
    // the page, and a load that failed again brought the words back with
    // nobody on the button. It comes back to the button then, and lands on
    // the list when the load comes (the list views do the same).
    const back = more || refresh ? null : focusMemo(body);
    if (more) {
      loadingMore = true;
    } else if (!refresh) {
      loading = true;
      error = null;
      pageError = null;
      streams.file = { cursor: null, more: false };
      streams.link = { cursor: null, more: false };
    }
    if (!refresh) render();
    try {
      // One conversation's files come from wherever it lives (a shared channel's host).
      const ask = (has) => {
        const s = streams[has];
        if (more && !s.more) return Promise.resolve(null);
        const params = { has, cursor: more ? s.cursor : null };
        return everywhere ? api.search(store.wsId, params) : store.searchIn(convId, params);
      };
      const [files, links] = await Promise.all([ask('file'), ask('link')]);
      if (destroyed || id !== request) return;
      indexed = files?.indexed ?? links?.indexed ?? indexed;
      // A page that came (this one, or a fresh load) clears the word of one
      // that did not; and what the column said of itself, so a list loaded
      // afresh that is empty again says so again (see say).
      if (!refresh) {
        pageError = null;
        status.textContent = '';
        saidHere = '';
      }
      const fresh = [];
      // Who shared it, as the message has it: an integration's post carries
      // its own name and colour (see store.author), and a row without them
      // read "App" in grey for every webhook and bot, whatever they were
      // called, where the message itself and a search hit name them.
      for (const m of files?.results || []) {
        for (const a of m.attachments || []) fresh.push({ key: `${m.conv}:${m.seq}:${a.id}`, kind: 'file', ts: m.ts, user: m.user, bot: m.bot || null, seq: m.seq, conv: m.conv, file: a });
      }
      for (const m of links?.results || []) {
        // A permalink into this workspace (the "Also sent from" line under a
        // reply sent to the channel too, a forward's link back) is the app's
        // own wayfinding, drawn as words in the message; it is not a link
        // someone shared, and listed here it would read as a raw address.
        const urls = [...new Set(String(m.text || '').match(URL_RE) || [])].filter((url) => !workspaceLinkRoute(url));
        for (const url of urls) fresh.push({ key: `${m.conv}:${m.seq}:${url}`, kind: 'link', ts: m.ts, user: m.user, bot: m.bot || null, seq: m.seq, conv: m.conv, url, unfurl: m.unfurl && m.unfurl.url === url ? m.unfurl : null, text: m.text });
      }
      let out = [];
      if (refresh) {
        // The newest page says what a read holds now for the span it covers:
        // everything newer than its oldest result, or everything when it is
        // the last page. An item shown from that span the page no longer has
        // is gone (its message deleted, its link edited out) and comes off;
        // one it still has is replaced with what the index says now. A page
        // that came back empty settles nothing and leaves the list as it is.
        const floor = { file: Infinity, link: Infinity };
        for (const [has, data] of [['file', files], ['link', links]]) {
          if (data?.results?.length) floor[has] = data.hasMore ? data.results[data.results.length - 1].ts : -Infinity;
        }
        const shown = new Set(fresh.map((it) => it.key));
        out = items.filter((it) => !shown.has(it.key) && !(it.ts > floor[it.kind]));
      } else if (more) {
        out = items.slice();
      }
      const have = new Set(out.map((it) => it.key));
      for (const it of fresh) {
        if (have.has(it.key)) continue;
        have.add(it.key);
        out.push(it);
      }
      out.sort((a, b) => b.ts - a.ts);
      items = out;
      for (const [has, data] of [['file', files], ['link', links]]) {
        if (!data) continue;
        // A refresh keeps a read's place: its cursor points past the pages
        // loaded, and the newest page merged above leaves no gap before it.
        // Unless that page was the last there is, which settled the list above.
        if (refresh && streams[has].cursor && (data.hasMore || !data.results?.length)) continue;
        streams[has] = { cursor: data.cursor || null, more: !!data.hasMore && !!data.cursor };
      }
    } catch (e) {
      if (destroyed || id !== request) return;
      // A refresh that fails leaves what is shown as it was; the next message tries again.
      if (refresh) return;
      // An older page refused (the network gone for a moment, the worker
      // down): the rows already read stand, and the failure is said under
      // them with a way to ask for that page again (see nextPage). Drawn as
      // the list having failed, the rows went from the screen for "Could not
      // load files and links", and its Try again read the list over from the
      // newest.
      if (more) {
        pageError = e;
        status.textContent = 'Could not load older files and links';
      } else error = e;
    }
    if (!refresh) {
      loading = false;
      loadingMore = false;
    }
    render();
    back?.();
  }
  const hasMore = () => streams.file.more || streams.link.more;

  function visible() {
    // Names and what was typed are compared as search reads them, lowercase
    // with accents and other marks stripped: "resume" finds Résumé.pdf.
    const q = normalize(search.value.trim());
    return items.filter((it) => {
      if (filter === 'files' && it.kind !== 'file') return false;
      if (filter === 'media' && !(it.kind === 'file' && isMedia(it.file.type))) return false;
      if (filter === 'links' && it.kind !== 'link') return false;
      if (!q) return true;
      const hay = it.kind === 'file' ? it.file.name : `${it.url} ${it.unfurl?.title || ''}`;
      return normalize(hay).includes(q);
    });
  }

  // The list is redrawn under the keyboard (a message with a file landing
  // while a row is focused, Load older pressed): the control comes back to
  // its place rather than falling to the page, as the Later view keeps its.
  function render() {
    if (destroyed) return;
    keepFocus(body, draw);
  }

  /**
   * Said aloud as well as shown, once: the words the column stands on when
   * it has no rows (nothing matches the words in the box, nothing shared
   * here yet, the list could not load), as the search view says its. The
   * box keeps the keyboard while the list empties under the words typed,
   * so a screen reader heard nothing of it. The region is the one that says
   * an older page could not be read (see load), whose words stand while
   * the rows do: only what was said here is taken back when rows come, and
   * words already said are not said over a later page's failure.
   */
  let saidHere = '';
  function say(text) {
    if (!text) {
      if (saidHere && status.textContent === saidHere) status.textContent = '';
      saidHere = '';
      return;
    }
    if (text === saidHere) return;
    status.textContent = text;
    saidHere = text;
  }

  function draw() {
    body.replaceChildren();
    if (error) {
      const old = isOldServer(error);
      const heading = old ? 'This needs a newer server' : 'Could not load files and links';
      body.append(el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon(old ? 'cloud' : 'wifiOff', 24) }),
        el('h3', {}, heading),
        el('p', {}, old ? 'The workspace server updates the next time its owner opens Teamchat.' : error.message),
        !old && el('button.btn.mt', { type: 'button', onclick: () => load() }, 'Try again')));
      say(heading);
      return;
    }
    if (loading) {
      body.append(skeleton());
      return;
    }
    const list = visible();
    if (!list.length) {
      const what = filter === 'files' ? 'files' : filter === 'media' ? 'photos or videos' : filter === 'links' ? 'links' : 'files or links';
      const filtering = !!search.value.trim();
      // The index answers a page at a time, newest first: an empty page with
      // older ones still to read says so, rather than that nothing was shared.
      const more = hasMore();
      const heading = filtering ? (more ? 'Nothing matches so far' : 'Nothing matches') : more ? `No recent ${what}` : `No ${what} here yet`;
      body.append(el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon(filter === 'links' ? 'link' : 'files', 24) }),
        el('h3', {}, heading),
        el('p', {}, more
          ? filtering ? 'Try another word, or look through older files and links.' : 'Older files and links have not been loaded yet.'
          : filtering ? 'Try another word.' : everywhere ? 'Anything shared in a channel or conversation you are in shows up here.' : 'Anything shared in this conversation shows up here.')));
      if (more) body.append(nextPage());
      if (indexed === null) body.append(unindexedNotice());
      say(heading);
      return;
    }
    say('');
    if (indexed === null) body.append(unindexedNotice());
    // Photos and videos first as a strip, when showing everything.
    const media = filter === 'all' ? list.filter((it) => it.kind === 'file' && isMedia(it.file.type)).slice(0, 8) : [];
    if (media.length) {
      body.append(el('h2.files-head', {}, media.some((it) => isVideo(it.file.type)) ? 'Photos and videos' : 'Photos')); // one level under the view's title
      body.append(el('div.files-strip', {}, ...media.map(thumb)));
    }
    const rows = el('div.files-list', { role: 'list' });
    for (const it of list) rows.append(it.kind === 'file' ? fileRow(it) : linkRow(it));
    body.append(rows);
    if (hasMore()) body.append(nextPage());
  }

  /**
   * The way to the older pages: the button alone, or, after a page that
   * could not be read (see load), why it could not over a Try again that
   * asks for that page again. Under the rows, which stand.
   */
  function nextPage() {
    if (!pageError) return moreButton();
    return el('div', {},
      el('p.search-more-note.small', {}, `Could not load older files and links. ${pageError.message}`),
      moreButton('Try again'));
  }

  /**
   * The index answers a page at a time; older files and links come on
   * request. Busy rather than disabled while the page is read (see
   * pressOnce in dom.js): disabled, the button pressed from the keyboard
   * was out of the tab order, so the redraw put the keyboard on the last
   * row's button instead, where it then stayed; busy, the keyboard stays on
   * the button, and lands on the rows that came when they are drawn. The
   * load itself takes one page at a time (see load).
   */
  function moreButton(label = 'Load older files and links') {
    return el('div.search-more', {}, el('button.btn.btn-outline', {
      type: 'button', 'aria-busy': loadingMore ? 'true' : null,
      onclick: () => load({ more: true }),
    }, loadingMore ? 'Loading' : label));
  }

  function unindexedNotice() {
    const admin = store.isAdmin();
    return el('div.callout.search-notice', { html: icon('info', 16) },
      el('span', {}, admin
        ? 'Only what was shared since search arrived is listed. Build the index to see everything.'
        : 'Only what was shared since search arrived is listed. An admin can build the full index from Workspace settings.'),
      admin && el('button.btn.btn-sm', { type: 'button', onclick: () => searchIndexDialog({ onDone: load }) }, 'Build index'));
  }

  function openMessage(it) {
    const thread = parentOfThread(it.conv);
    navigate(thread ? { ws: store.wsId, conv: thread.conv, thread: thread.seq, message: it.seq, view: null } : { ws: store.wsId, conv: it.conv, message: it.seq, view: null });
  }

  function thumb(it) {
    // A video is not fetched to draw the strip: a tile with a play mark stands for it.
    if (isVideo(it.file.type)) {
      return el('button.files-thumb.video', { type: 'button', 'aria-label': `Play ${fileLabel(it.file.name)}`, onclick: () => openFile(it) },
        el('span.attachment-video-play', { html: icon('play', 20, 2.4) }));
    }
    const img = el('img', { alt: fileLabel(it.file.name), loading: 'lazy', hidden: true });
    const btn = el('button.files-thumb', { type: 'button', 'aria-label': `Open ${fileLabel(it.file.name)}`, onclick: () => openFile(it) }, el('div.skeleton'), img);
    attachmentUrl(store.hostRef(it.conv), it.file.id).then((url) => { img.src = url; img.hidden = false; btn.querySelector('.skeleton')?.remove(); }).catch(() => {
      // Bytes that do not come (offline, the host of a shared channel out of
      // reach, a file removed): the tile stands for the picture with its
      // icon rather than pulsing as if still loading; the viewer it opens
      // says what went wrong and offers the download.
      btn.querySelector('.skeleton')?.remove();
      btn.classList.add('broken');
      btn.append(el('span', { html: icon('image', 22, 1.8) }));
    });
    return btn;
  }

  /** An image or a video opens in the viewer, with the other media on screen an arrow away; anything else downloads. */
  function openFile(it) {
    if (isMedia(it.file.type)) {
      const media = visible().filter((x) => x.kind === 'file' && isMedia(x.file.type));
      openMediaViewer({
        items: media.map((x) => ({ file: x.file, ref: store.hostRef(x.conv), author: store.author(x), ts: x.ts })),
        index: media.indexOf(it),
      });
      return;
    }
    downloadAttachment(store.hostRef(it.conv), it.file).catch(() => toast('Could not download the file', { icon: 'alert' }));
  }

  function meta(it) {
    const by = store.author(it);
    // Across the workspace, each row says where it was shared.
    const thread = parentOfThread(it.conv);
    const where = everywhere ? el('span.files-where', {}, `in ${store.convTitle(thread ? thread.conv : it.conv)}`) : null;
    return el('div.files-meta', {}, avatar(by, { size: 'xs' }), el('span', { dir: 'auto' }, by.name), where, el('time', { datetime: new Date(it.ts).toISOString(), title: fullDateTime(it.ts) }, relativeLong(it.ts)));
  }

  function fileRow(it) {
    const a = it.file;
    // The name as shown (see fileLabel), on the row cut in the middle when
    // long so its end (the date, the version, the extension) stays in view
    // however narrow the row (see fileLabelShort); whole in the title then,
    // and always in the accessible name.
    const shown = fileLabel(a.name);
    const short = fileLabelShort(a.name, 40, 14);
    return el('div.files-row', { role: 'listitem' },
      el('button.files-main', { type: 'button', 'aria-label': `${isVideo(a.type) ? 'Play' : isImage(a.type) ? 'Open' : 'Download'} ${shown}`, onclick: () => openFile(it) },
        el('span.att-icon', { html: icon(fileIcon(a.type), 18) }),
        el('span.files-text', {}, el('strong', { title: short === shown ? null : shown }, short), el('span', {}, formatBytes(a.size))),
        meta(it)),
      el('button.icon-btn.icon-btn-sm', { type: 'button', html: icon('messageText', 16), 'aria-label': 'Open in conversation', title: 'Open in conversation', onclick: () => openMessage(it) }));
  }

  function linkRow(it) {
    let host = it.url;
    try {
      host = new URL(it.url).hostname.replace(/^www\./, '');
    } catch { /* keep the raw address */ }
    // Without a title, the address as written, cut to fit: the message
    // preview's cleaner takes markdown's marks out of a text, and an address
    // is allowed its underscores and tildes. Cut as a file's name is cut
    // (see fileLabelShort): in the middle, whole characters, the end kept.
    // Cut at a count of code units, an address with an emoji or a
    // non-Latin domain at the cut showed half of one as a broken glyph.
    const address = fileLabel(it.url);
    const shown = it.unfurl?.title || fileLabelShort(it.url, 80, 20);
    return el('div.files-row', { role: 'listitem' },
      el('a.files-main', { href: it.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
        el('span.att-icon', { html: icon('link', 18) }),
        el('span.files-text', {}, el('strong', { title: shown === address || it.unfurl?.title ? null : address }, shown), el('span', {}, host)),
        meta(it)),
      el('button.icon-btn.icon-btn-sm', { type: 'button', html: icon('messageText', 16), 'aria-label': 'Open in conversation', title: 'Open in conversation', onclick: () => openMessage(it) }));
  }

  function skeleton() {
    const box = el('div', { 'aria-busy': 'true', 'aria-label': 'Loading', style: { padding: '12px 20px' } });
    for (let i = 0; i < 5; i++) {
      box.append(el('div', { style: { display: 'grid', gridTemplateColumns: '36px 1fr', gap: '12px', padding: '10px 0' } },
        el('div.skeleton', { style: { width: '36px', height: '36px', borderRadius: '8px' } }),
        el('div', {}, el('div.skeleton', { style: { width: '200px', height: '12px', marginBottom: '8px' } }),
          el('div.skeleton', { style: { width: `${30 + ((i * 29) % 40)}%`, height: '12px' } }))));
    }
    return box;
  }

  listKeyNav(body, '.files-main');

  /**
   * Rows whose message this device holds and which no longer carry what the
   * row lists: the message deleted (by its author, by an admin), or edited
   * so that the link is no longer in it or the file no longer on it. Taken
   * off the list at once, from the window in the store; true when any went.
   * The list is read again only when a message lands (the counter moves), and
   * a deletion or an edit moves no counter, so a deleted message's file and an
   * edited-out link stood on the list, each opening onto a message that was
   * gone or said no such thing, until the next message landed. A message not
   * loaded here says nothing either way, and its row stands.
   */
  function prune(conv) {
    const c = store.convs.get(conv);
    if (!c) return false;
    const before = items.length;
    items = items.filter((it) => {
      if (it.conv !== conv) return true;
      const m = c.messages.find((x) => x.seq === it.seq);
      if (!m) return true;
      if (m.deleted) return false;
      if (it.kind === 'file') return (m.attachments || []).some((a) => a.id === it.file.id);
      return (String(m.text || '').match(URL_RE) || []).includes(it.url);
    });
    return items.length !== before;
  }

  /**
   * What is shared is read again as messages land: in this conversation, its
   * counter moving; in its threads, a reply landing (see newestReply); and,
   * workspace-wide, anywhere the reader may see, as the activity document
   * counts it (see offActivity). Reading the list again on the 'messages'
   * events alone, as the page did, listed a message only from a conversation
   * whose window stood in this tab (no window, no event): a file shared in a
   * channel the reader had not opened since loading the app was not listed
   * until the page was opened again.
   */
  let latest = convId ? store.latestSeq(convId) : 0;
  /**
   * When the newest reply in a conversation's threads was posted, as far as
   * the roots in its window say (the worker stamps each root with its last
   * reply's time). The index lists a thread's files and links under its
   * parent, so a reply with a file or a link belongs on this list the moment
   * it lands; a reply moves no counter of the conversation's own, and the
   * list, watching the counter alone, listed it only once a message landed
   * in the conversation itself (or the tab was opened again).
   */
  const newestReply = (conv) => (store.convs.get(conv)?.messages || []).reduce((t, m) => (m.lastReplyAt > t ? m.lastReplyAt : t), 0);
  const lastReply = new Map();
  for (const conv of store.convs.keys()) lastReply.set(conv, newestReply(conv));
  let reloadTimer = null;
  const soon = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => load({ refresh: true }), 1500);
  };
  const ours = (conv) => everywhere || conv === convId || parentOfThread(conv)?.conv === convId;
  const offMessages = store.on('messages', (ev) => {
    if (destroyed) return;
    if (ev.conv && !loading && !error && prune(ev.conv)) render();
    if (!ev.conv || !ours(ev.conv)) return;
    if (!everywhere && ev.conv === convId) {
      const now = store.latestSeq(convId);
      if (now !== latest) {
        latest = now;
        load({ refresh: true });
        return;
      }
    } else if (ev.reason === 'newer' || ev.reason === 'sent') {
      // A reply landing in one of this conversation's threads, sent from
      // here or read into an open thread panel; workspace-wide, a message
      // landing anywhere a window stands for.
      soon();
      return;
    }
    // Someone else's reply in a thread whose panel is not open is seen here
    // only as its root's stamp moving when the window is read again (see
    // the store's _refreshRange, reason 'range'; an own reply counted on
    // its root, reason 'local', is listed by the thread's own event above).
    // Roots first read into the window (the page loading, older pages) say
    // nothing new: the list was read from the index alongside them.
    const reply = newestReply(ev.conv);
    if (reply > (lastReply.get(ev.conv) || 0)) {
      lastReply.set(ev.conv, reply);
      if (ev.reason === 'range') soon();
    }
  });
  // Workspace-wide: every conversation's counter, as the polls bring them,
  // whether or not a window stands for it here. Read again when any moves;
  // coalesced, so a busy minute costs one read.
  const counted = () => Object.values(store.act?.c || {}).reduce((n, c) => n + (Number(c?.s) || 0), 0);
  let seen = everywhere ? counted() : 0;
  const offActivity = everywhere ? store.on('activity', () => {
    if (destroyed) return;
    const now = counted();
    if (now === seen) return;
    seen = now;
    soon();
  }) : null;
  load();

  return {
    el: root,
    destroy() {
      destroyed = true;
      clearTimeout(reloadTimer);
      offMessages();
      offActivity?.();
    },
  };
}

/** The rail's Files view: everything shared across the workspace, in the main column. */
export function createFilesPage() {
  const files = createFilesView(null);
  const header = el('div.conv-header.view-header', {},
    el('button.icon-btn.back', {
      type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to conversations',
      onclick: () => navigate({ ws: store.wsId, view: null }),
    }),
    el('div.view-title', {}, el('h1.conv-title', {}, 'Files'), el('span.view-sub', {}, 'Files and links shared in the channels and conversations you are in')));
  return {
    el: el('div.main.list-view', {}, header, files.el),
    destroy: () => files.destroy(),
  };
}
