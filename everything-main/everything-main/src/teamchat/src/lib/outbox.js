/**
 * The outbox: messages written while offline (or that failed for want of a
 * connection) wait in IndexedDB, with their attachment blobs, and go out in
 * order when the network is back. Every entry carries a client id the
 * worker echoes and deduplicates on, so a send that was in fact received
 * before the connection dropped cannot land twice when it is retried.
 *
 * The storage is injectable so the ordering and retry rules are unit tested
 * without a browser.
 */
export const makeClientId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function createOutbox({ storage, sendEntry, uploadFile, onChange, isOnline = () => true, owner = () => null }) {
  let flushing = false;
  let again = false;
  // The entry whose file is going up right now (see pass), listed with `up`
  // set: the entries go one at a time, a file at a time, and those bound for
  // a worker that answered an error wait their turn, so of everything in
  // line only this one's first file is on its way. Kept here, not in the
  // entry: a mark written to the store would outlive the upload it stood for
  // (a reload mid-upload).
  let uploading = null;

  // The device may serve more than one account in turn: an entry is stamped
  // with who wrote it and only ever listed, sent, or shown to them. One from
  // before the stamp existed is taken as the current account's. Nothing is
  // listed for anyone while who is signed in is not yet known.
  const mine = (e) => !e.uuid || (owner() && e.uuid === owner());

  /**
   * The signed-in account's entries, oldest first; null when the store
   * could not be read this once (see layeredStorage and idb.js all), which
   * is not an empty queue: read as one, every placeholder went off the
   * screen as sent or discarded elsewhere, and nothing sent the messages.
   */
  async function list() {
    const stored = await storage.all();
    if (!stored) return null;
    const all = stored.filter(mine);
    return all.sort((a, b) => a.ts - b.ts).map((e) => (e.id === uploading ? { ...e, up: true } : e));
  }
  const count = async () => (await list())?.length ?? 0;

  async function enqueue(entry) {
    const e = { id: entry.id || makeClientId(), ts: entry.ts || Date.now(), attempts: 0, ...entry };
    if (!e.uuid && owner()) e.uuid = owner();
    await storage.put(e);
    onChange?.();
    return e;
  }

  async function remove(id) {
    await storage.del(id);
    onChange?.();
  }

  /** Put an entry that was set aside back in line; it is tried again on the next flush. */
  async function retry(id) {
    const e = ((await storage.all()) || []).find((x) => x.id === id);
    if (!e) return null;
    const next = { ...e, failed: false, attempts: 0, lastError: null };
    await storage.put(next);
    onChange?.();
    return next;
  }

  /**
   * Send everything that is waiting, oldest first, one conversation's
   * entries in order. Stops at the first failure to reach anyone (the rest
   * would fail the same way) and leaves the entries for the next attempt;
   * a worker that would not answer holds back only what is bound for it;
   * sets aside an entry the worker refuses for a reason retrying will not
   * fix, until retry() puts it back in line or remove() drops it.
   */
  async function flush() {
    if (!isOnline()) return { sent: 0, left: await count() };
    if (flushing) {
      // Something was added or put back in line while a flush runs: that
      // flush goes round once more when it is done, since its list was
      // taken before this call.
      again = true;
      return { sent: 0, left: await count() };
    }
    flushing = true;
    let sent = 0;
    try {
      // The store is the device's, and every tab of the origin flushes it
      // (coming online, bootstrapping): two tabs reading the same entry in
      // the same instant both sent it, and the worker's client-id check, a
      // lookup before the write, does not catch two writes racing each
      // other, so the message landed twice. Tabs take turns through a Web
      // Lock where there is one; the next reads the queue after the first
      // has emptied it, and finds nothing left to send.
      await withLock(async () => {
        do {
          again = false;
          sent += await pass();
        } while (again);
      });
    } finally {
      flushing = false;
    }
    return { sent, left: await count() };
  }

  const withLock = (fn) => (typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request('teamchat:outbox', fn)
    : fn());

  /** One pass over the queue; returns how many went out. Sets `again` to false when the network failed. */
  async function pass() {
    let sent = 0;
    // Workers that did not answer in this pass: what else is bound for one
    // of them waits its turn (in order), while entries for the others go.
    const waiting = new Set();
    let unreached = false;
    // The store could not be read this once (see list): nothing goes out,
    // and nothing is done to what waits; the next flush reads it again.
    const listed = await list();
    if (!listed) return 0;
    for (const stored of listed) {
      if (stored.failed) continue;
      // Where the entry goes: a shared channel's is bound for its host.
      const where = stored.host || stored.ws;
      if (waiting.has(where)) continue;
      // The list is a snapshot: an entry discarded (or set aside) while an
      // earlier one was uploading must not go out when its turn comes. One
      // the store could not say still stands is not sent either.
      const held = await storage.all();
      const current = held ? held.find((x) => x.id === stored.id) : null;
      if (!current || current.failed) continue;
      // Attachment bytes go up first, and the entry is rewritten after each
      // one with the file moved to its attachments: a send that fails
      // afterwards must not upload them again, nor may the second of three
      // uploads failing (the connection dropping, a file the worker refuses)
      // upload the first again on the next pass, as a file uploaded twice
      // leaves one copy in the owner's storage that no message names and
      // nothing releases. Files uploaded before the connection dropped are
      // already attachments and stay alongside the ones uploaded now.
      let e = current;
      // Whether this pass has already counted its attempt (it does so just
      // before the send; a failure before that — an upload — has not).
      let counted = false;
      // Discarded while a file was going up: the row offers Discard for as
      // long as the message is queued, an upload included, and remove()
      // takes the entry out under this pass. Written back around the
      // upload as if nothing had happened, the entry came back from the
      // dead, its remaining files went up, and the message the member had
      // just discarded was sent and stood in the conversation. The entry is
      // read again after each upload (and once more before the send, for a
      // discard landing between the last write and it): gone, nothing more
      // is written, uploaded, or sent for it. The bytes just uploaded stay
      // in the owner's storage, named by no message (see above). Asked
      // again before a failure is written back (see the catch below): an
      // upload or a send that failed after the discard wrote the entry back
      // with its attempt counted, or set aside with its reason, and it came
      // back from the dead the same way. A store that could not be read this
      // once (null; see list) says nothing of a discard: the entry is taken
      // as standing, and the pass goes on with it as before, rather than
      // read as discarded, with the file just uploaded left named by no
      // message and still listed on the entry to go up again.
      const stands = async () => {
        const now = await storage.all();
        return now ? now.some((x) => x.id === e.id) : true;
      };
      try {
        let discarded = false;
        while (e.files?.length) {
          const [f, ...rest] = e.files;
          // Marked as the one going up while it does (see list and
          // `uploading`), and said, so the placeholder's card for this file
          // reads "Uploading…" while the cards behind it, and every other
          // entry's, say they wait.
          uploading = e.id;
          onChange?.();
          let uploaded;
          try {
            uploaded = await uploadFile(e.ws, f, e);
          } finally {
            uploading = null;
          }
          if (!(await stands())) {
            discarded = true;
            break;
          }
          e = { ...e, files: rest, attachments: [...(e.attachments || []), uploaded] };
          await storage.put(e);
          // The entry changed (a file moved from waiting to uploaded): said,
          // so the placeholder drawn from it follows (see the store's _syncQueued).
          onChange?.();
        }
        if (discarded || (e !== current && !(await stands()))) continue;
        // Counted before the send goes out, not after a failure is caught:
        // an attempt the device does not live to hear the end of — a tab
        // closed, a browser killed, a laptop shut mid-request — is still an
        // attempt, and the worker may well have taken the message. Counted
        // in the catch alone, as it used to be, such an entry came back at
        // nought attempts and went again as a first send, which is the one
        // thing a first send is allowed to take for granted it is not (see
        // the worker's postMessage and `first`).
        e = { ...e, attempts: (e.attempts || 0) + 1 };
        counted = true;
        await storage.put(e);
        await sendEntry({ ...e, attachments: e.attachments || [] });
        await storage.del(e.id);
        sent++;
        onChange?.();
      } catch (err) {
        // The sender's word that the entry is not to be kept at all (its
        // conversation is gone; see the store's _dropQueued): taken out,
        // whatever else the failure says, rather than set aside as failed
        // where nothing would ever show it again.
        if (err?.drop) {
          await storage.del(e.id);
          onChange?.();
          continue;
        }
        // A bare 404 is the address not answering (a worker being redeployed
        // or gone for the moment), as the poll treats it: not a refusal. Nor
        // is a workspace being moved to another server (423 `transferring`):
        // it takes no writes for a few minutes and then does again, so the
        // entry waits its turn like one for a worker that is erroring, and
        // the next flush tries it. One that has moved (423 `moved`) is a
        // refusal: this copy is read-only for good, and the message is not
        // this address's to take.
        // Only what the worker, or the network, answered is read this way:
        // an answer carries a status (0 for no answer at all). A failure in
        // the sending itself (an entry from an older build the code cannot
        // read, a fault) has none, and read as the device being offline it
        // was tried for good, attempt after attempt, with nothing on screen
        // to retry or discard, and everything behind it for the same worker
        // held up; it is set aside with its message, like a refusal.
        const answered = typeof err?.status === 'number' || err?.code === 'no_backend';
        // A 408 or a 425 is only ever a gateway's word (the request timed out
        // on its way, or came too early), never the worker's refusal: the
        // message waits for the next flush as it does on a 429, where read as
        // a refusal it was set aside with a Retry button for a moment that
        // had already passed. So is any page the platform answered with in
        // the worker's place (`http_NNN`, none of the worker's words; a
        // firewall's 403 page, say; see the store's isPlatformPage): the
        // worker was not asked, and the next flush asks it.
        const retryable = answered && (!err.status || err.status >= 500 || err.status === 429 || err.status === 408 || err.status === 425 || err.code === 'no_backend' || (err.status === 423 && err.code === 'transferring') || /^http_\d{3}$/.test(String(err.code || '')));
        // Discarded while the upload or the send that failed was out (see
        // stands): nothing is written back for it, neither the attempt nor
        // the reason. What the failure says of the worker (or the network)
        // still holds for the rest of the pass.
        const kept = await stands();
        if (retryable) {
          if (kept) {
            // Counted here only where the pass did not reach the send to
            // count it itself: an upload that failed is an attempt too.
            await storage.put({ ...e, ...(counted ? {} : { attempts: (e.attempts || 0) + 1 }), lastError: err?.message || String(err) });
            onChange?.();
          }
          // A worker that answered and could not take the message (erroring,
          // rate limiting, or a bare 404 while it is redeployed, as the app
          // does to the member's own worker with each new build) is one
          // worker: what else is bound for it waits, in order, and entries
          // for other workers are not held up behind it, poll after poll,
          // for as long as that one is away. So is one that never answered
          // (the request reached nobody, or timed out): read as the device
          // being offline, it stopped the pass at the first of its entries,
          // and since a flush comes only when some worker did answer (a
          // poll got through, a bootstrap landed), a workspace whose server
          // hung or was gone from the network held every other workspace's
          // messages behind it for as long as it was away. The pass goes on
          // to the others' entries; it does not go round again for this
          // (the next trigger tries), since a device that is in fact
          // offline would fail the same way each time.
          if (!err?.status && err?.code !== 'no_backend') unreached = true;
          waiting.add(where);
          continue;
        }
        // Refused for good (no longer a member, channel read-only...): keep
        // it aside with the reason rather than retrying forever.
        if (!kept) continue;
        await storage.put({ ...e, failed: true, lastError: err?.message || String(err) });
        onChange?.();
      }
    }
    if (unreached) again = false;
    return sent;
  }

  /**
   * Drop every entry of this account bound for a workspace (left, removed,
   * or deleted): nothing there would take them. Another account's entries
   * for the same workspace, on a shared device, are that account's: they
   * left nothing, and their message goes out when they are back.
   */
  async function forget(ws) {
    const gone = ((await storage.all()) || []).filter((e) => e.ws === ws && mine(e));
    for (const e of gone) await storage.del(e.id);
    if (gone.length) onChange?.();
    return gone.length;
  }

  return { list, enqueue, remove, retry, flush, forget };
}

/** In-memory storage with the same shape as the IndexedDB store; for tests and as a fallback. */
export function memoryStorage() {
  const map = new Map();
  return {
    all: async () => [...map.values()].map((v) => ({ ...v })),
    put: async (v) => { map.set(v.id, { ...v }); },
    del: async (id) => { map.delete(id); },
  };
}

/**
 * Durable storage with this tab's memory behind it: an entry the durable
 * store would not take (no IndexedDB, an open that failed or was blocked, a
 * full quota; `put` answers null then) is kept in memory, so a message
 * written offline is at least sent from this tab rather than reported as
 * queued and silently dropped.
 */
export function layeredStorage(durable) {
  const mem = memoryStorage();
  return {
    all: async () => {
      const durably = await durable.all();
      // The durable store could not be read this once (null; see idb.js
      // all): what it holds is not known, and the answer says so rather
      // than listing this tab's memory alone as the whole queue. Unless
      // this tab holds something of its own: an entry is kept here only
      // because the durable store would not take it, and where it will not
      // take reads either (a browser that keeps no site data for the page,
      // or opens no database in a private window, refuses every open),
      // "unknown" would stand for good, and the message written here, a
      // picture attached or a line sent offline, sat as "Queued. Sending
      // shortly." for the life of the tab, listed by nothing and sent by
      // nothing, with the Retry and Discard under it answering the same.
      // What this tab knows of goes out; the durable store's own entries,
      // if any, come back into the list with its next read that succeeds.
      const held = await mem.all();
      if (durably === null) return held.length ? held : null;
      const kept = durably || [];
      const ids = new Set(kept.map((e) => e.id));
      return kept.concat(held.filter((e) => !ids.has(e.id)));
    },
    put: async (v) => {
      if ((await durable.put(v)) === null) await mem.put(v);
      else await mem.del(v.id);
    },
    del: async (id) => {
      await durable.del(id);
      await mem.del(id);
    },
  };
}
