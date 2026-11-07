/**
 * Workspace archives: walking the worker's paged export, writing it into the
 * user's own Puter drive as JSON plus readable HTML, and replaying an archive
 * into a worker (an import, or the second half of a transfer). Everything
 * reports progress through a callback and can be resumed by cursor.
 */
import { api, ApiError, isOldServer, isTransferring } from './api.js';
import { parseRef, makeRef } from './refs.js';
import { uid } from '../shared/ids.js';
import { escapeHtml, formatMessage } from './format.js';
import { formatTime, dayLabel } from './time.js';
import { parentOfThread } from '../shared/blocks.js';

/**
 * Pull the whole archive from a workspace: { header, pages, files }. `check`
 * is asked before each page and may throw to stop the walk (see
 * transferWorkspace: another session took the move over); `pause` is the
 * wait between tries of a page whose answer was lost (see retrying).
 *
 * A page whose answer is lost on the way (the connection dropping, the
 * answer outlasting the wait) is asked for again, as a page of an import is:
 * the walk is a read, named by a cursor the worker keeps the list for, so
 * the same page comes back the same. Given up on at the first such loss, as
 * it used to be, the whole export stopped with "Could not reach the
 * workspace server" and began again from its first page, and a move (the
 * export being its first half) let the freeze on the workspace go and began
 * again, for minutes on a large workspace, over one dropped answer.
 */
export async function exportWorkspace(ref, { onProgress, check = null, pause = RETRY_PAUSE_MS } = {}) {
  check?.();
  let res = await retrying(() => api.exportPage(ref, null), { check, pause });
  const archive = { header: res.header, pages: [...res.pages], files: [...res.files] };
  let guard = 0;
  while (!res.done && guard++ < 10000) {
    onProgress?.({ phase: 'messages', done: res.progress.done, total: res.progress.total });
    check?.();
    const { cursor } = res;
    res = await retrying(() => api.exportPage(ref, cursor), { check, pause });
    archive.pages.push(...res.pages);
    archive.files.push(...res.files);
  }
  onProgress?.({ phase: 'messages', done: res.progress.total, total: res.progress.total });
  return archive;
}

/**
 * A name as a path segment in the drive and in the readable pages' links:
 * the characters no file system takes made a dash, one line, clamped. The
 * clamp counts UTF-16 units, and a character written as two of them (an
 * emoji in a file's name) can straddle the cut: the half left behind goes
 * with the half taken (as the worker's cleanFileName and cleanText have it),
 * since a lone half is no character, and the link to the file could not be
 * encoded for it, which stopped the whole export at "Writing readable pages".
 */
const safeName = (s) => {
  const cut = String(s || 'workspace').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1).trimEnd() : cut) || 'workspace';
};

/**
 * Write an archive into the user's drive under Teamchat exports/{name} {date}/:
 * messages.json (the archive), index.html and one HTML page per
 * conversation, and files/ with attachment bytes fetched through the worker.
 * Returns the folder path.
 */
/**
 * The date and time in an export folder's name ("2026-09-06 20.59"), in the
 * exporter's own time, as the archive's index.html states the export time
 * and as the drive shows the folder's own dates. Written in UTC, the name
 * of an export made at nine in the evening in California carried the next
 * day's date and a small-hours time, and the dialog's "Saved to …" line
 * named a folder the reader could not square with the clock.
 */
export function exportStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

export async function writeArchiveToDrive(ref, archive, { onProgress, pause = RETRY_PAUSE_MS } = {}) {
  const folder = `Teamchat exports/${safeName(archive.header.workspace.name)} ${exportStamp(archive.header.exportedAt)}`;
  // A write the drive refuses (its storage full, the folder taken away
  // under the export) is reported as what it was: which file, into which
  // folder, and the drive's reason, with a word that what came before it is
  // there. The drive's own refusal was handed up as it came, as it used to
  // be: an object that may carry no message at all, so the dialog read
  // "Stopped: undefined" or the drive's bare words, named no step, and said
  // nothing of the half-written folder left behind, which the exporter
  // found later with an index whose pages were not all there.
  const write = async (path, data, type) => {
    try {
      return await puter.fs.write(`${folder}/${path}`, data instanceof Blob ? data : new Blob([data], { type }), { overwrite: true, dedupeName: false, createMissingParents: true });
    } catch (e) {
      throw new Error(`could not write ${path} into "${folder}" in your Puter drive (${driveReason(e)}); what was written before it is in that folder`);
    }
  };
  onProgress?.({ phase: 'write', label: 'Writing messages.json' });
  await write('messages.json', JSON.stringify(archive, null, 1), 'application/json');
  const html = renderArchiveHtml(archive);
  onProgress?.({ phase: 'write', label: 'Writing readable pages' });
  await write('index.html', html.index, 'text/html');
  for (const [name, page] of Object.entries(html.pages)) await write(`channels/${name}.html`, page, 'text/html');
  const seen = new Set();
  const files = archive.files.filter((f) => !seen.has(f.id) && seen.add(f.id));
  let n = 0;
  // Attachments whose bytes could not be written (gone from the server, or
  // the drive refusing them): not fatal, the archive stands without them,
  // but counted, and the count carried on each progress report (`missing`),
  // so the dialog can say how many rather than "Saved" over a folder with
  // files missing from it. The answer stays the folder's name. Bytes whose
  // answer was lost on the way (the connection dropping for a moment) are
  // asked for again first, as a move asks for them (see replayArchive):
  // counted missing at once, as they used to be, a blip in the connection
  // left files out of the folder, and the dialog blamed the server or the
  // drive for it.
  let missing = 0;
  // A few files at a time (see FILES_AT_ONCE), each its own read from the
  // server and write to the drive, since neither depends on another's: one
  // after another, as they used to be, an export of a few hundred pictures
  // spent most of its time waiting on one read and one write at a time. The
  // first write goes alone, so that one write makes the files folder (see
  // createMissingParents) before others could each try to make it; from the
  // first that lands, the rest go together. `done` counts the files finished,
  // and the last report says how many, as before.
  let landed = false;
  const one = async (f) => {
    onProgress?.({ phase: 'files', done: n, total: files.length, label: f.name, missing });
    try {
      const blob = await retrying(() => api.fileBlob(ref, f.id), { pause });
      await write(`files/${f.id}-${safeName(f.name)}`, blob);
      landed = true;
    } catch {
      missing += 1;
    }
    n += 1;
  };
  for (let i = 0; i < files.length;) {
    const width = landed ? FILES_AT_ONCE : 1;
    await Promise.all(files.slice(i, i + width).map(one));
    i += width;
  }
  onProgress?.({ phase: 'files', done: files.length, total: files.length, missing });
  return folder;
}

/** Attachments an export reads and writes at once, once its files folder stands (see writeArchiveToDrive). */
const FILES_AT_ONCE = 4;

/** The drive's reason for refusing a write, in words: its message, else its code, else a plain phrase (the SDK rejects with objects as well as errors). */
const driveReason = (e) => (typeof e?.message === 'string' && e.message) || (typeof e?.code === 'string' && e.code) || (typeof e === 'string' && e) || 'the drive refused the write';

/** Static, searchable-in-a-browser pages: one per conversation plus an index. */
export function renderArchiveHtml(archive) {
  const { header, pages } = archive;
  const members = header.members || {};
  // People who left keep their name on what they wrote, from the cards the
  // workspace remembered them by; the pages of a live workspace do the same.
  const former = header.former || {};
  const nameOf = (u) => members[u]?.name || former[u]?.name || (String(u).startsWith('hook_') || String(u).startsWith('bot_') ? 'App' : 'Former member');
  const byUser = {};
  for (const [u, m] of Object.entries({ ...former, ...members })) byUser[String(m.username || '').toLowerCase()] = { uuid: u, name: m.name };
  const convs = new Map();
  for (const p of pages) {
    const cur = convs.get(p.conv) || [];
    cur.push(...p.messages);
    convs.set(p.conv, cur);
  }
  const title = (conv) => {
    const t = parentOfThread(conv);
    if (t) return `Thread in ${title(t.conv)} (message ${t.seq})`;
    const ch = header.channels[conv];
    if (ch) return `#${ch.name}`;
    const dm = header.dms?.[conv];
    if (dm) return `Direct: ${dm.members.map(nameOf).join(', ')}`;
    return conv;
  };
  const fileName = (conv) => conv.replace(/[^a-z0-9_]/gi, '_');
  const style = `body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1a1a1a;background:#fff}h1{font-size:22px}
.msg{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;padding:6px 0;border-top:1px solid #eee}.who{font-weight:700}.when{color:#777;font-size:12px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.sys{color:#777;font-style:italic}.day{margin:18px 0 6px;font-weight:700;color:#555}.att a{margin-right:8px}
.r{color:#555;font-size:12px}nav a{margin-right:12px}code{background:#f3f3f3;padding:1px 4px;border-radius:4px}pre{background:#f3f3f3;padding:8px;border-radius:6px;overflow:auto}
blockquote{border-left:3px solid #ddd;margin:4px 0;padding-left:10px;color:#555}.mention{color:#4f46e5;font-weight:600}`;
  const doc = (t, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(t)}</title><style>${style}</style></head><body>${body}</body></html>`;
  const pagesOut = {};
  const ordered = [...convs.keys()].sort((a, b) => title(a).localeCompare(title(b)));
  for (const conv of ordered) {
    const msgs = convs.get(conv).slice().sort((a, b) => a.seq - b.seq);
    let last = null;
    const rows = msgs.map((m) => {
      let out = '';
      if (!last || new Date(last).toDateString() !== new Date(m.ts).toDateString()) out += `<div class="day">${escapeHtml(new Date(m.ts).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</div>`;
      last = m.ts;
      // Only reactions somebody still holds: an entry nobody is under (one a
      // bot token's removal left behind on an older server) is no reaction.
      const reactions = Object.entries(m.reactions || {}).filter(([, v]) => Object.keys(v || {}).length).map(([k, v]) => `${escapeHtml(k)} ${Object.keys(v).length}`).join(' · ');
      // The address is a path segment: a "#" or "%" in a file name would
      // otherwise be read as a fragment or an escape and the link miss the file.
      const files = (m.attachments || []).map((a) => `<a href="../files/${escapeHtml(encodeURIComponent(`${a.id}-${safeName(a.name)}`))}">${escapeHtml(a.name)}</a>`).join('');
      const text = m.deleted ? '<span class="sys">This message was deleted</span>' : m.kind === 'sys' ? `<span class="sys">${escapeHtml(m.text)}</span>` : formatMessage(m.text, { members: byUser });
      return out + `<div class="msg" id="m${m.seq}"><div><div class="who">${escapeHtml(m.bot?.name || nameOf(m.user))}</div><div class="when"><a href="#m${m.seq}">${escapeHtml(formatTime(m.ts))}</a></div></div>
<div><div class="text">${text}${m.editedAt ? ' <span class="when">(edited)</span>' : ''}</div>${files ? `<div class="att">${files}</div>` : ''}${reactions ? `<div class="r">${reactions}</div>` : ''}${m.replyCount ? `<div class="r"><a href="${fileName(`${conv}_t${m.seq}`)}.html">${m.replyCount} repl${m.replyCount === 1 ? 'y' : 'ies'}</a></div>` : ''}</div></div>`;
    }).join('\n');
    pagesOut[fileName(conv)] = doc(`${title(conv)} · ${header.workspace.name}`, `<nav><a href="../index.html">← ${escapeHtml(header.workspace.name)}</a></nav><h1>${escapeHtml(title(conv))}</h1><p class="when">${msgs.length} messages</p>${rows}`);
  }
  const list = ordered.map((c) => `<li><a href="channels/${fileName(c)}.html">${escapeHtml(title(c))}</a> <span class="when">${convs.get(c).length} messages</span></li>`).join('');
  const people = Object.values(members).map((m) => `<li>${escapeHtml(m.name)} <span class="when">@${escapeHtml(m.username)} · ${escapeHtml(m.role)}</span></li>`).join('');
  const index = doc(header.workspace.name, `<h1>${escapeHtml(header.workspace.name)}</h1><p class="when">Exported ${escapeHtml(new Date(header.exportedAt).toLocaleString())}. Open a conversation and use your browser's find (Ctrl/Cmd+F) to search.</p><h2>Conversations</h2><ul>${list}</ul><h2>People</h2><ul>${people}</ul>`);
  return { index, pages: pagesOut };
}

/**
 * Replay an archive into a worker: create, then every page, then the
 * attachment bytes (read from the source workspace when given, so a
 * transfer moves them), then finish. Returns the new reference.
 */
export async function importArchive(targetUrl, archive, { from = null, fromRef = null, profile, onProgress, check = null, onCreated = null, onGone = null, pause = RETRY_PAUSE_MS } = {}) {
  // The shape the walk below counts on, checked before anything is made: a
  // messages.json damaged in the pages (cut short, edited by hand) used to
  // get as far as creating the workspace, fail in the middle with the
  // runtime's own words ("archive.pages is not iterable"), and take the
  // stub down again. The header itself is the worker's to judge.
  assertArchiveShape(archive);
  onProgress?.({ phase: 'create', label: 'Creating the workspace' });
  check?.();
  const server = parseRef(`000000@${(targetUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.puter\.work$/, ''))}`)?.server;
  let made;
  try {
    made = await api.importCreate(targetUrl, archive.header, from, profile);
  } catch (e) {
    // The request may have reached the worker and made the copy's stub before
    // its answer was lost (the connection dropping, the answer outlasting the
    // wait, the address answering nothing for a moment). Failed outright, as
    // it used to be, the next try found the archive's id taken by that stub
    // and made another copy beside it, and the stub stood for good: a
    // workspace nobody could open, counted among the twenty its owner may be
    // in, holding their storage. The worker keeps the archive's own id for a
    // copy where nothing stands under it (see /api/workspaces/import), so the
    // stub is looked for there: one still being imported into, and ours to
    // import into (only its owner may), is the one that request made, and
    // the import goes on into it, its header written whole before the answer
    // was lost. None there, and the request is asked once more. A stub made
    // under a fresh id (the archive's taken by a live workspace here) cannot
    // be told from here, and stays as before.
    if (!isLost(e)) throw e;
    await new Promise((r) => setTimeout(r, pause));
    check?.();
    const wanted = String(archive.header?.workspace?.id || '');
    const stub = /^[a-z0-9]{6,20}$/.test(wanted) ? await api.workspace(makeRef(wanted, server)).catch(() => null) : null;
    made = stub?.workspace?.importing && stub.me?.role === 'owner'
      ? { workspace: { id: stub.workspace.id, name: stub.workspace.name } }
      : await api.importCreate(targetUrl, archive.header, from, profile);
  }
  const { workspace, scheduled = null } = made;
  const ref = makeRef(workspace.id, server);
  // The caller is told of the copy the moment it exists, and again when a
  // failed one is gone: one that could not be taken down (see below) is the
  // caller's to remember and take down on its next try (see transferWorkspace).
  // With it, what the server said of the archive's waiting messages and
  // reminders (`scheduled`: how many it kept and how many did not fit its
  // queue; see leftBehindText), for the caller's closing words.
  onCreated?.(ref, { scheduled: scheduled && typeof scheduled === 'object' ? scheduled : null });
  try {
    await replayArchive(ref, archive, { fromRef, onProgress, check, pause });
  } catch (e) {
    // A copy stopped short is a workspace nobody can open: it refuses every
    // write until an import that has lost its place finishes it, it is in
    // no one's list (the app files a workspace only once it is open), and
    // the next try makes another beside it, since its id is taken. Each
    // one held its members' documents and the pages written so far in the
    // owner's storage, was counted among the workspaces they are in (twenty
    // failed tries, and they could import nothing more), and no route ever
    // reached it again. It is taken down with the failure, best effort: the
    // original, if there is one, is untouched, and the retry starts clean.
    const gone = await api.deleteWorkspace(ref).then(() => true, () => false);
    if (gone) onGone?.(ref);
    throw e;
  }
  return ref;
}

/** The word for a messages.json whose pages are not what an export writes (read after "Stopped:" in the dialog). */
const DAMAGED = 'this messages.json is damaged: its pages are not in the shape an export writes. Export the workspace again, or pick the messages.json the export wrote';

/**
 * Refuse an archive whose pages the replay could not walk: `pages` must be
 * a list, each entry a conversation's page with a list of messages (the
 * worker admits every message field by field; only the walk's own footing
 * is checked here). `files` is read only when moving a workspace, where the
 * worker wrote it; a list is required when present all the same.
 */
export function assertArchiveShape(archive) {
  const ok = archive && typeof archive === 'object' && Array.isArray(archive.pages)
    && archive.pages.every((p) => p && typeof p === 'object' && typeof p.conv === 'string' && Array.isArray(p.messages))
    && (archive.files === undefined || Array.isArray(archive.files));
  if (!ok) throw new Error(DAMAGED);
}

/**
 * The copies a move made and could not take down (see transferWorkspace),
 * kept in the browser's own storage as well as in the dialog's state, filed
 * under the workspace being moved: remembered in the page alone, a reload
 * of the app between the failure and the next try began with nothing in
 * hand, and the copy stayed for good. Read back only in the shape written
 * here, references to servers the app may call; storage that is refused (a
 * private window) leaves the dialog's own memory to do the remembering.
 */
const partialKey = (oldRef) => `teamchat:transfer:partial:${oldRef}`;
function recallPartial(oldRef) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const list = JSON.parse(localStorage.getItem(partialKey(oldRef)) || '[]');
    return Array.isArray(list) ? list.filter((r) => typeof r === 'string' && !!parseRef(r)) : [];
  } catch {
    return [];
  }
}
function rememberPartial(oldRef, list) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (list.length) localStorage.setItem(partialKey(oldRef), JSON.stringify(list));
    else localStorage.removeItem(partialKey(oldRef));
  } catch {
    /* storage refused: the dialog's state still holds them */
  }
}

/**
 * Move a workspace onto the nominee's server (the accepting side of a
 * transfer), safe to run again after a failure. `state` is the dialog's
 * and outlives the attempts: the copy an attempt made is remembered there
 * once its import has finished, so the next attempt closes the original for
 * that copy rather than making another beside it. Before anything is
 * copied the original is read again: one already marked moved (a
 * completion whose answer was lost, or someone else's) is followed, and a
 * copy of ours it does not point at is taken down, since nobody is sent to
 * it. Resolves to { ref, icon, mine }: where the workspace lives now, the
 * icon carried across, and whether that home is the copy made here.
 */
export async function transferWorkspace(oldRef, targetUrl, state, { profile, icon = false, onProgress } = {}) {
  // `scheduled`: what the new server said of the queue when the copy was
  // made (see importArchive), for the dialog's closing words; nothing for a
  // home that is not the copy made here.
  const settle = async (movedTo) => {
    const mine = !!state.copy && state.copy.ref === movedTo;
    if (state.copy && !mine) {
      await api.deleteWorkspace(state.copy.ref).catch(() => {});
      state.copy = null;
    }
    return { ref: movedTo, icon: mine ? state.copy.icon || null : null, mine, ...(mine && state.copy.scheduled ? { scheduled: state.copy.scheduled } : {}) };
  };
  // The copies earlier tries made and could not take down (the new server
  // out of reach when their pages failed, and still when the failure was
  // tidied): workspaces nobody can open, counted among the twenty the
  // nominee may be in and holding their storage, beside which the next try
  // used to make another, their ids being taken. Taken down first, best
  // effort; one still out of reach is remembered for the try after this. The
  // dialog's own memory and the browser's (see recallPartial) are read
  // together, so a reload between the failure and this try forgets nothing.
  state.partial = [...new Set([...(Array.isArray(state.partial) ? state.partial : []), ...recallPartial(oldRef)])];
  if (state.partial.length) {
    onProgress?.({ phase: 'check', label: 'Removing the copy left by the last try' });
    const kept = [];
    for (const made of state.partial) await api.deleteWorkspace(made).then(() => {}, () => kept.push(made));
    state.partial = kept;
    rememberPartial(oldRef, kept);
  }
  onProgress?.({ phase: 'check', label: 'Checking the workspace' });
  const current = (await api.workspace(oldRef)).workspace;
  if (current.movedTo) return settle(current.movedTo);
  if (!state.copy) {
    // The old copy takes no writes from here until the move completes (which
    // lets the freeze go) or is called off: a message posted there while the
    // export ran, or the import into the new copy, was lost to the move. The
    // freeze the worker holds lapses on its own after half an hour, so it is
    // renewed while the work runs; a renewal refused because another
    // session of the nominee holds it stops this one at the next page.
    onProgress?.({ phase: 'freeze', label: 'Pausing the workspace' });
    // This attempt names its session to the worker, once per dialog: the
    // freeze is granted to a session and renewed under its name, so another
    // of the nominee's sessions asking meanwhile is refused (see
    // freezeForTransfer) rather than freezing, exporting and importing a
    // second copy beside this one; a retry from the same dialog carries the
    // name on and renews.
    state.sid = typeof state.sid === 'string' && state.sid ? state.sid : uid(16);
    await freezeForTransfer(oldRef, state.sid);
    let takenOver = null;
    const check = () => {
      if (takenOver) throw takenOver;
    };
    const renew = setInterval(() => {
      api.transferBegin(oldRef, state.sid).catch((e) => {
        if (isTransferring(e)) takenOver = takeoverError();
      });
    }, TRANSFER_RENEW_MS);
    let ref;
    try {
      onProgress?.({ phase: 'read', label: 'Reading the workspace' });
      const archive = await exportWorkspace(oldRef, { onProgress, check });
      // The copy is remembered from the moment it exists, and forgotten once
      // it is whole, or gone (see importArchive); what is left in between is
      // a copy the next try must take down first, beside any an earlier try left.
      const forget = (made) => {
        state.partial = (state.partial || []).filter((x) => x !== made);
        rememberPartial(oldRef, state.partial);
      };
      let scheduled = null;
      ref = await importArchive(targetUrl, archive, {
        from: oldRef, fromRef: oldRef, profile, onProgress, check,
        onCreated: (made, info) => {
          state.partial = [...(state.partial || []), made];
          rememberPartial(oldRef, state.partial);
          scheduled = info?.scheduled || null;
        },
        onGone: forget,
      });
      forget(ref);
      state.scheduled = scheduled;
    } catch (e) {
      // Members can write again at once, rather than when the freeze
      // lapses; not when another session holds the freeze now, which is
      // that session's to keep.
      if (!takenOver) await api.transferCancel(oldRef).catch(() => {});
      throw takenOver || e;
    } finally {
      clearInterval(renew);
    }
    state.copy = { ref, icon: null, scheduled: state.scheduled || null };
    // The icon is not in the archive (it is a file of the workspace, not of
    // a message): carried across by hand, best effort. An admin can set it again.
    if (icon) {
      onProgress?.({ phase: 'icon', label: 'Copying the icon' });
      try {
        state.copy.icon = (await api.uploadWorkspaceIcon(ref, await api.workspaceIconBlob(oldRef))).icon || null;
      } catch {
        /* set it again from Workspace settings */
      }
    }
  }
  onProgress?.({ phase: 'close', label: 'Closing the old copy' });
  let done;
  try {
    done = await api.transferComplete(oldRef, state.copy.ref);
  } catch (e) {
    // The original refusing to close (the nomination withdrawn while the
    // copy was being made, the nominee no longer an admin there, the
    // original gone) is final: trying again would only be refused again,
    // so the copy is taken down as an import that stopped short is, rather
    // than left standing as a second workspace of that name in the nominee's
    // list. A failure to reach the original keeps the copy for the next try.
    const refused = e instanceof ApiError && e.status >= 400 && e.status < 500 && !isLost(e);
    if (refused) {
      // One that could not be taken down (the new server out of reach just
      // then) is remembered as a copy stopped short is (see state.partial):
      // the next try takes it down first. Forgotten, as it used to be, it
      // stood in the nominee's account for good, a whole workspace nobody
      // was sent to, counted among the twenty they may be in.
      const made = state.copy.ref;
      state.copy = null;
      const gone = await api.deleteWorkspace(made).then(() => true, () => false);
      if (!gone) {
        state.partial = [...new Set([...(state.partial || []), made])];
        rememberPartial(oldRef, state.partial);
      }
    }
    throw e;
  }
  return settle(done.movedTo || state.copy.ref);
}

/** How often the freeze on the old copy is renewed while the export and the import run; the worker holds it for thirty minutes. */
export const TRANSFER_RENEW_MS = 10 * 60_000;

/** The word when another session of the nominee holds the freeze (read after "Stopped:" in the dialog). */
const TAKEN_OVER = 'this workspace is already being moved by another of your sessions; let it finish, then open the workspace again';
const takeoverError = () => Object.assign(new Error(TAKEN_OVER), { code: 'transferring' });

/**
 * Pause writes on the old copy before the export starts; a 200 is required.
 * `sid` names this session's attempt: a 423 `transferring` means another
 * session of the nominee holds the freeze under a name of its own, and this
 * one stops here (no export, and that session's freeze is left alone); a
 * server built before the freeze existed says so, with what puts it right
 * (the owner opening the app brings their server up to date).
 */
async function freezeForTransfer(ref, sid) {
  try {
    await api.transferBegin(ref, sid);
  } catch (e) {
    if (isTransferring(e)) throw takeoverError();
    if (isOldServer(e)) throw new Error('the workspace’s server is out of date and cannot pause it for the move; ask its owner to open Teamchat once, which brings the server up to date, then try again');
    throw e;
  }
}

/**
 * A request asked again when nobody answered it, or its answer was lost on
 * the way back (the connection dropping, the answer outlasting the wait, the
 * worker's address answering nothing for a moment while it is redeployed):
 * so many tries, a short pause between them, and `check` asked before each
 * (a move another session took over stops here too). A refusal is answered
 * at once, as it always was. Only for requests the worker takes twice
 * without harm: a page of an import keeps the first record of each number
 * and counts a file only for the records it adds, and a file's bytes sent
 * again keep the record's count (see the import routes), so a page or a
 * file whose answer was lost, asked again, lands once; a page of an export
 * is a read, and comes back the same for the same cursor. Given up on at the
 * first such failure, as it used to be, the whole import was taken down for
 * one lost answer and run again from the start, for minutes on a large
 * workspace (for a move, under a freeze renewed for it).
 */
const RETRIES = 2;
const RETRY_PAUSE_MS = 1500;
/**
 * An answer that is the platform's and not the worker's: a gateway standing
 * in for a worker that did not answer it in time or is being redeployed
 * (502, 503, 504), a request timed out on the way (408) or held back for a
 * moment (429), each with a page of its own in place of the worker's JSON.
 * Nothing the worker said, so a request answered this way is asked again as
 * one whose answer was lost is; the worker's own refusals and its own
 * server errors (which carry its JSON, and say the work itself failed) are
 * answered at once, as before. Read as a refusal, as it used to be, one such
 * page in the middle of an export stopped it with "Request failed (502)",
 * and one in the middle of a move took the copy down, let the freeze go,
 * and began again from nothing.
 */
const isPlatformAnswer = (e) => e instanceof ApiError && /^http_\d{3}$/.test(String(e.code)) && (e.status >= 500 || e.status === 408 || e.status === 425 || e.status === 429);
const isLost = (e) => e instanceof ApiError && (e.code === 'network' || e.code === 'timeout' || (e.code === 'no_backend' && e.status > 0) || isPlatformAnswer(e));
async function retrying(fn, { check = null, pause = RETRY_PAUSE_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= RETRIES || !isLost(e)) throw e;
      await new Promise((r) => setTimeout(r, pause));
      check?.();
    }
  }
}

/** Every page, then the attachment bytes, then finish: the part of an import that may stop short. `check` may throw to stop it (see transferWorkspace); `pause` is the wait between tries of a request whose answer was lost (see retrying). */
async function replayArchive(ref, archive, { fromRef, onProgress, check = null, pause = RETRY_PAUSE_MS }) {
  let i = 0;
  // The direct messages the copy would not take (see below), by their root:
  // what they carried is not the copy's to hold.
  const refused = new Set();
  for (const page of archive.pages) {
    onProgress?.({ phase: 'messages', done: i++, total: archive.pages.length, label: page.conv });
    check?.();
    // A page is sent even when it carries no message: it names the
    // conversation's counter (`seq`), which the copy must take up where the
    // original left off. A conversation whose every message had been
    // deleted travelled as such a page, and was never sent, so the copy
    // started it again at nothing while every member's cursor for it came
    // across at the old count; what was posted there next was counted read
    // by all of them until the count was passed.
    for (let k = 0; k === 0 || k < page.messages.length; k += 400) {
      try {
        // The blocks the original closed early travel with every chunk of
        // the page (see the worker's import: idempotent, and a block may be
        // closed before its messages arrive). The page's block range travels
        // with each part too, and the last part says so (`last`): the worker
        // closes the counter's block behind the newest message it holds once
        // the whole page is in (see the import route), and must not do so on
        // a part cut short of that message.
        const closed = Array.isArray(page.closed) && page.closed.length ? { closed: page.closed } : {};
        await retrying(() => api.importPage(ref, { conv: page.conv, seq: page.seq, from: page.from, to: page.to, last: k + 400 >= page.messages.length, messages: page.messages.slice(k, k + 400), ...closed }), { check, pause });
      } catch (e) {
        // A direct message none of the copy's members are in (people from
        // connected workspaces do not travel with it) is not part of the
        // copy, and the worker says so; the archive carries it all the same,
        // being the export of everything. Nobody in the copy could read it,
        // so its pages are passed over and the import goes on. A channel
        // refused is another matter, and stops it where it is.
        const root = parentOfThread(page.conv)?.conv || page.conv;
        if (!(e instanceof ApiError && e.status === 404 && e.code === 'not_found' && root.startsWith('dm_'))) throw e;
        refused.add(root);
        break;
      }
    }
  }
  if (fromRef) {
    // The files to carry: the ones a message of the copy holds, the channels'
    // bookmarks point at, or the queue's messages will carry. A file listed
    // under a direct message the copy refused (above) alone is nobody's here:
    // copied all the same, it landed in the new owner's drive recorded as
    // held by nothing, which no deletion ever releases, and stayed for good.
    // Listed under such a page and under a channel's as well (a forward), it
    // comes across for the channel's message; the archive names it once per
    // page, so the pages that carry it are looked at before it is counted once.
    const carried = (f) => f.bookmark || f.sched || !f.conv || !refused.has(parentOfThread(f.conv)?.conv || f.conv);
    const seen = new Set();
    const files = archive.files.filter(carried).filter((f) => !seen.has(f.id) && seen.add(f.id));
    // Who shared each file, from one pass over the messages rather than one
    // per file: a large archive would otherwise spend its time here. A file
    // waiting in the queue alone (scheduled with a message not yet sent) is
    // carried by no message: it is its entry's author's, and the copy lets
    // it go with the entry only when its record says so (a message deleted
    // before its time, or refused at it, used to leave the file in the new
    // owner's drive for good, recorded as the importer's).
    const owners = new Map();
    for (const p of archive.pages) for (const m of p.messages) for (const a of m.attachments || []) if (!owners.has(a.id)) owners.set(a.id, m.user);
    for (const e of Array.isArray(archive.header?.sched) ? archive.header.sched : []) {
      for (const a of Array.isArray(e?.attachments) ? e.attachments : []) if (a?.id && !owners.has(a.id)) owners.set(a.id, e.u);
    }
    let n = 0;
    for (const f of files) {
      onProgress?.({ phase: 'files', done: n++, total: files.length, label: f.name });
      check?.();
      try {
        // The bytes are read from the old server and sent to the new one as
        // one step, asked again as a whole when either answer is lost.
        await retrying(async () => {
          const blob = await api.fileBlob(fromRef, f.id);
          await api.importFile(ref, f.id, blob, f.name, owners.get(f.id));
        }, { check, pause });
      } catch {
        /* the message keeps its attachment card; the bytes did not make it */
      }
    }
  }
  onProgress?.({ phase: 'finish', label: 'Opening the workspace' });
  check?.();
  try {
    await api.importFinish(ref);
  } catch (e) {
    // The answer lost on its way back (the connection dropping at that
    // moment, the answer outlasting the wait) after the worker had opened the
    // copy: read as a failed import, as it used to be, every page, every
    // file and the opening itself were undone the moment they had all
    // succeeded (see importArchive, which takes a copy stopped short down),
    // and the admin ran the whole import again. Asking again would not do:
    // the worker answers a second opening of a copy already open as one not
    // being imported into. The copy is read once instead: no longer being
    // imported into, it is finished; still being imported into, or out of
    // reach, it was not opened, and goes as before.
    const ws = await api.workspace(ref).then((d) => d?.workspace || null, () => null);
    if (!ws || ws.importing) throw e;
  }
}

/**
 * The dialogs' closing word on an archive's waiting messages and reminders,
 * from what the server answered when the copy was made (`scheduled`, see
 * importArchive and transferWorkspace): the copy's queue holds so much, and
 * what did not fit was left behind, the soonest due having been kept. '' when
 * nothing was, or nothing was said.
 */
export function leftBehindText(scheduled) {
  const n = Number(scheduled?.dropped) || 0;
  if (!n) return '';
  const kept = Number(scheduled?.kept) || 0;
  return `${n} scheduled ${n === 1 ? 'message or reminder' : 'messages and reminders'} could not be brought across (the copy's queue holds no more; the ${kept} due soonest ${kept === 1 ? 'was' : 'were'}). ${n === 1 ? 'It is' : 'They are'} still listed in the old copy's Later view, to schedule again.`;
}

/** Progress text for the dialogs. */
export function progressText(p) {
  if (!p) return '';
  if (p.phase === 'messages' && p.total) return `Messages: ${p.done} of ${p.total} conversations`;
  if (p.phase === 'files' && p.total) return `Files: ${p.done} of ${p.total}${p.label ? ` (${p.label})` : ''}`;
  return p.label || '';
}
