import { getState, mergeUpdates, parseUpdateMeta } from "yjs";
import {
  validateCommentChanges,
  commentExcerpt,
  validateCommentGrowth,
} from "../src/comments.js";
import {
  concealment,
  contributionKey,
  workshopSettings,
  validateWorkshopChanges,
  validateWorkshopWrites,
  workshopEvents,
} from "../src/facilitation/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { assignmentChanges } from "../src/planning/task.js";
import { capturedTaskTitle } from "../src/planning/task-title.js";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";
import { appendRun, sliceTextRuns } from "../src/rich-text.js";
import {
  ASSET,
  ID,
  ROLES,
  SESSION_TTL,
  MAX_UPDATE,
  canComment,
  canEditContent,
  canManage,
  decode,
  encode,
  hash,
  keyPair,
  sign,
} from "../src/collaboration/protocol.js";
import { DAY, OrgService } from "./org.js";

const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const id = (value) => {
  if (typeof value !== "string" || !ID.test(value))
    fail(400, "Invalid identifier.");
  return value;
};
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
// Records written up to this long before a checkpoint or cached state are
// read again, covering records that became visible late.
const LOG_OVERLAP = 120_000;
// Refreshing a cached state reads a shorter overlap.
const REFRESH_OVERLAP = 15_000;
// How long a cached board state is used without reading new records.
const FRESH = 1500;
export const DOCS = new Map();
const RECORDS = new Map();
// For changes made outside BoardService, such as account linking.
export function forgetRecords(prefix) {
  for (const key of RECORDS.keys())
    if (key.startsWith(prefix)) RECORDS.delete(key);
}
export const FILES = new Map();
FILES.bytes = 0;
// Holds a file, counting its size, and lets go of the least recently used
// ones past 48 MB.
function keepFile(path, text) {
  const old = FILES.get(path);
  if (old !== undefined) {
    FILES.delete(path);
    FILES.bytes -= old.length;
  }
  FILES.set(path, text);
  FILES.bytes += text.length;
  for (const [key, value] of FILES) {
    if (FILES.bytes <= 48_000_000 || FILES.size <= 1) break;
    FILES.delete(key);
    FILES.bytes -= value.length;
  }
}
// Identical commits in flight in this worker instance share one write.
const COMMITS = new Map();
// Who owns each Yjs client ID a board's commits have added content under.
// An owner never changes, so an instance remembers the ones it has read.
const CLIENTS = new Map();
const keepClient = (key, owner) => {
  CLIENTS.delete(key);
  if (CLIENTS.size >= 20_000) CLIENTS.delete(CLIENTS.keys().next().value);
  CLIENTS.set(key, owner);
};
// Records a person can add to the audit log by reporting exports and
// restorations, per board and minute in this instance. Every real action
// stays recorded; a flood from a crafted client is refused.
const REPORTS = new Map();
const REPORT_LIMIT = 20;
const INVITE_ROLES = ["facilitator", "editor", "commenter", "viewer"];
const INVITE_DAYS = 7;
// The largest encoded update a commit carries, as the client's session.js.
const UPDATE_LIMIT = 8_000_000;
// Everything a commenter must not change. Comments and workshop registers
// (votes, poll answers, reactions) are excluded here and checked per author
// by validateCommentChanges and validateWorkshopChanges instead.
const contentSignature = (board) =>
  JSON.stringify([
    board.title,
    board.items,
    board.tags || [],
    board.timer || null,
    board.planning || null,
  ]);

export function appUid(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(new TextDecoder().decode(decode(part)));
    if (p.app_uid) return p.app_uid;
    if (p.au?.includes("-")) return p.au;
    const b = decode(p.au.replace(/_/g, "/"));
    if (b.length !== 16) return null;
    const h = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
    return `app-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return null;
  }
}
// Summaries for the organization's board directory and search.
export function boardSummary(board) {
  const types = {};
  const words = [],
    all = [];
  let length = 0,
    total = 0;
  // Search finds only what participants can see: not what the workshop
  // hides, stages, or keeps private.
  const c = concealment(board, "", false),
    concealed = new Set([...c.hidden, ...c.frames, ...c.notes]);
  for (const i of board.items) {
    types[i.type] = (types[i.type] || 0) + 1;
    const value = [i.text, i.fileName, ...(i.cells?.flat() || [])]
      .filter(Boolean)
      .join(" ");
    // Everything, hidden or not, tells boards with the same content apart.
    if (value && total < 8000) {
      all.push(value.slice(0, 8000 - total));
      total += value.length + 1;
    }
    if (concealed.has(i.id)) continue;
    if (value && length < 8000) {
      words.push(value.slice(0, 8000 - length));
      length += value.length + 1;
    }
  }
  return {
    title: board.title,
    objectCount: board.items.length,
    types,
    text: words.join("\n"),
    content: all.join("\n"),
  };
}
// Group the edit log into versions: consecutive edits by the same people
// within a few minutes form one version, newest first.
export function historyVersions(records, gap = 5 * 60_000, limit = 300) {
  const versions = [];
  let current = null;
  for (const r of records) {
    if (!current || r.at - current.until > gap) {
      current = { start: r.at, until: r.at, edits: 0, authors: [] };
      versions.push(current);
    }
    current.until = r.at;
    current.edits++;
    const name = r.username || "Participant";
    if (!current.authors.includes(name) && current.authors.length < 10)
      current.authors.push(name);
  }
  return versions
    .reverse()
    .slice(0, limit)
    .map((v) => ({ ...v, at: v.until }));
}
const mentionPattern = /(^|[\s(])@([A-Za-z0-9_.-]{2,64})/g;
// Punctuation ending a sentence, as in "Thanks @alice.", is not part of the
// name.
export function mentions(text) {
  return [...String(text || "").matchAll(mentionPattern)]
    .map((m) => m[2].replace(/[.-]+$/, "").toLowerCase())
    .filter((name) => name.length >= 2);
}

export class BoardService {
  constructor(puter, { now = Date.now, fetcher = fetch, org, request } = {}) {
    this.puter = puter;
    this.kv = puter.kv;
    this.now = now;
    this.fetcher = fetcher;
    this.org = org || new OrgService(puter, { now, fetcher, request });
  }
  // Rows come in key order. Given `stop`, listing ends before the first row
  // it accepts.
  async list(prefix, values = true, stop = null) {
    let cursor,
      rows = [];
    do {
      const page = await this.kv.list({
        pattern: prefix,
        returnValues: values,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const items = Array.isArray(page) ? page : page.items;
      const end = stop ? items.findIndex(stop) : -1;
      if (end >= 0) {
        rows.push(...items.slice(0, end));
        break;
      }
      rows.push(...items);
      cursor = page.cursor;
    } while (cursor);
    return rows;
  }
  async readFile(path) {
    return (await this.puter.fs.read(path)).text();
  }
  async writeFile(path, value) {
    await this.puter.fs.write(path, value, {
      overwrite: true,
      dedupeName: false,
      createMissingParents: true,
    });
  }
  // Snapshots, checkpoints, and large updates are immutable files, so each
  // worker instance keeps recently used ones in memory instead of rereading.
  async cachedFile(path) {
    const hit = FILES.get(path);
    if (hit !== undefined) {
      FILES.delete(path);
      FILES.set(path, hit);
      return hit;
    }
    const text = await this.readFile(path);
    keepFile(path, text);
    return text;
  }
  async applyRecord(doc, value) {
    doc.apply(
      decode(value.update || (await this.cachedFile(value.path))),
      "stored",
    );
  }
  // Edit records written since a moment, read by day so a load reads only
  // recent history. Every record also stays in the log for version history.
  // Given `until`, as for an earlier version, reading ends at its first
  // later record.
  async logSince(room, since, until = Infinity) {
    const prefix = `wb:${room}:log:`;
    const now = Math.min(this.now(), until);
    const span = now - since;
    const later = until < Infinity ? (r) => r.value?.at > until : null;
    if (!since || span > 7 * DAY) {
      const rows = await this.list(prefix, true, later);
      return since ? rows.filter((r) => r.value.at >= since) : rows;
    }
    // The narrowest ISO time prefix that keeps the number of listings small.
    const [size, step] =
      span <= 10 * 60_000
        ? [16, 60_000]
        : span <= 2 * DAY
          ? [13, 3_600_000]
          : [10, DAY];
    const rows = [];
    let previous = null;
    for (let at = since; ; at += step) {
      const part = new Date(Math.min(at, now)).toISOString().slice(0, size);
      if (part !== previous)
        for (const row of await this.list(prefix + part, true, later))
          if (row.value.at >= since) rows.push(row);
      previous = part;
      if (at >= now) break;
    }
    return rows;
  }
  // Every record up to a moment, legacy and current, for reconstruction.
  // Edit record keys start with their time, so the log is read only until
  // the first later edit rather than to its end.
  async allRecords(room, until = Infinity) {
    return [
      ...(await this.list(`wb:${room}:op:`)),
      ...(await this.list(`wb:${room}:log:`, true, (r) => r.value?.at > until)),
    ]
      .map((r) => r.value)
      .filter((v) => v && Number.isFinite(v.at))
      .sort((a, b) => a.at - b.at);
  }
  // Reconstruct the shared document as it stood at a moment in time. The edit
  // log is retained, so every earlier state can be rebuilt.
  // A moment after the latest checkpoint starts from it and reads only the
  // records since, like a normal load. An earlier moment starts from the
  // newest checkpoint saved by then, and only a board with none replays
  // its log from the start.
  async loadAt(room, at) {
    const meta = await this.kv.get(`wb:${room}:meta`);
    if (!meta) fail(404, "Board not found.");
    const latest = await this.kv.get(`wb:${room}:cp`);
    const checkpoint =
      latest && latest.at <= at
        ? latest
        : latest &&
          (
            await this.list(`wb:${room}:cps:`, true, (r) => r.value?.saved > at)
          ).at(-1)?.value;
    const doc = new SharedDocument(
      decode(
        await this.cachedFile(checkpoint ? checkpoint.path : meta.snapshot),
      ),
    );
    const records = (
      checkpoint
        ? (await this.logSince(room, checkpoint.at - LOG_OVERLAP, at)).map(
            (r) => r.value,
          )
        : await this.allRecords(room, at)
    ).filter((v) => v.at <= at);
    for (const value of records) await this.applyRecord(doc, value);
    return { doc, meta, count: records.length };
  }
  // The current document: the latest checkpoint plus the edits recorded
  // shortly before it and since. Applying an edit twice is harmless, so the
  // overlap covers records that became visible late.
  // Each worker instance keeps a recent state of busy boards and only reads
  // the records written since. Within a second and a half the cached state
  // is used as is; collaborators still receive each other's edits
  // immediately through peers, and the next load picks them up.
  async load(room, known) {
    const meta = known || (await this.kv.get(`wb:${room}:meta`));
    if (!meta) fail(404, "Board not found.");
    const started = this.now();
    const cached = DOCS.get(room);
    if (cached && cached.snapshot === meta.snapshot) {
      DOCS.delete(room);
      DOCS.set(room, cached);
      if (started - cached.at < FRESH)
        return { doc: new SharedDocument(cached.state), meta, rows: 0 };
    }
    const entry =
      cached && cached.snapshot === meta.snapshot
        ? cached
        : { snapshot: meta.snapshot, seen: new Set(), checkpoint: undefined };
    let doc, since;
    const base = entry.state;
    if (entry.state) {
      doc = new SharedDocument(entry.state);
      since = entry.at - REFRESH_OVERLAP;
    } else {
      entry.checkpoint = await this.kv.get(`wb:${room}:cp`);
      doc = new SharedDocument(
        decode(await this.cachedFile(entry.checkpoint?.path || meta.snapshot)),
      );
      // Boards from before checkpoints stored every edit under op: keys; the
      // first checkpoint covers them, so they are only read until then.
      if (!entry.checkpoint)
        for (const { key, value } of await this.list(`wb:${room}:op:`)) {
          await this.applyRecord(doc, value);
          entry.seen.add(key);
        }
      since = entry.checkpoint ? entry.checkpoint.at - LOG_OVERLAP : 0;
    }
    let applied = 0;
    const covered = entry.checkpoint?.at || 0;
    for (const { key, value } of await this.logSince(room, since)) {
      await this.applyRecord(doc, value);
      applied++;
      if (value.at > covered && entry.seen.size < 100_000) entry.seen.add(key);
    }
    // Edits this instance committed while the log was being read, which the
    // listing may have missed, are kept rather than replaced.
    const latest = DOCS.get(room);
    entry.state =
      latest?.state &&
      latest.state !== base &&
      latest.snapshot === entry.snapshot
        ? mergeUpdates([latest.state, doc.update()])
        : doc.update();
    entry.at = started;
    DOCS.set(room, entry);
    for (const [key, value] of DOCS) {
      if (DOCS.size <= 20) break;
      DOCS.delete(key);
      if (value === entry) DOCS.set(key, value);
    }
    // A checkpoint over a week old makes each load read the whole log, so
    // a quiet board's checkpoint is renewed too.
    if (
      entry.seen.size >= 256 ||
      (entry.seen.size && (!entry.checkpoint || started - covered > DAY)) ||
      (entry.checkpoint && started - covered > 6 * DAY)
    )
      await this.checkpoint(room, doc, started)
        .then((checkpoint) => {
          entry.checkpoint = checkpoint;
          entry.seen.clear();
        })
        .catch(() => {});
    return { doc, meta, rows: applied };
  }
  // A committed edit extends this instance's cached state without a reload.
  // Merging keeps concurrent commits in the same instance from dropping
  // each other's edits.
  remember(room, update) {
    const entry = DOCS.get(room);
    if (entry?.state) entry.state = mergeUpdates([entry.state, update]);
  }
  async checkpoint(room, doc, at) {
    const snapshot = encode(doc.update());
    const path = `whiteboard/shared/${room}/checkpoints/${await hash(snapshot)}.txt`;
    await this.writeFile(path, snapshot);
    keepFile(path, snapshot);
    const checkpoint = { path, at };
    // Every checkpoint is also kept in a list by the time it was saved, so
    // an earlier version starts from the one before it. It holds no edit
    // recorded after that time, and its file stays with the board.
    const saved = this.now();
    await this.kv.set(`wb:${room}:cps:${new Date(saved).toISOString()}`, {
      ...checkpoint,
      saved,
    });
    await this.kv.set(`wb:${room}:cp`, checkpoint);
    return checkpoint;
  }
  // Resolve a caller's effective board role. Organization administrators can
  // govern every board on their worker even without a membership record.
  async member(room, user, write = false) {
    // One request can check access more than once; read the records once.
    const key = `${room}|${id(user.uuid)}`;
    this.access ??= new Map();
    if (!this.access.has(key))
      this.access.set(
        key,
        Promise.all([
          this.record(`wb:${room}:meta`),
          this.record(`wb:${room}:member:${user.uuid}`),
          this.org.role(user),
          this.org.active(user),
        ]),
      );
    let meta, member, orgRole, active;
    try {
      [meta, member, orgRole, active] = await this.access.get(key);
    } catch (error) {
      this.access.delete(key);
      throw error;
    }
    if (!active) fail(403, "Your organization account is deactivated.");
    const admin = orgRole === "owner" || orgRole === "admin";
    if (meta?.deleted && !admin) fail(404, "Board not found.");
    let effective = member;
    // An administrator who was already on the board with a lesser role,
    // such as a viewer promoted later, governs it like any other board.
    if (admin && member?.role !== "owner")
      effective = {
        uuid: user.uuid,
        username: user.username,
        role: "owner",
        orgAdmin: true,
      };
    if (!meta || !effective || effective.role === "removed")
      fail(403, "You no longer have access to this board.");
    // Guests are judged by their current organization role, so a guest who
    // has since joined the organization keeps access and a member demoted
    // to guest is treated as one.
    const outsider = (!orgRole || orgRole === "guest") && !admin;
    if (outsider) {
      const ends = await this.guestEnds(effective, user, orgRole);
      if (ends !== null && ends < this.now())
        fail(403, "Your guest access to this board has expired.");
    }
    // Restricting boards to members, turning off sharing outside the
    // organization, or turning off guest access also ends access for guests
    // who joined before.
    if (outsider) {
      const policy = await this.org.accessPolicy();
      if (policy.restrictToOrganization || policy.externalSharing === "none")
        fail(
          403,
          "Your organization only allows its own members on this board.",
        );
      if (policy.guestAccess === false)
        fail(403, "Your organization does not allow guest access.");
    }
    if (write) {
      if (
        write === "comment"
          ? !canComment(effective.role)
          : !canEditContent(effective.role)
      )
        fail(403, "This board is read-only.");
      if (meta.archived && !admin)
        fail(403, "This board is archived and read-only.");
    }
    // Archived boards are read-only for everyone but administrators; clients
    // learn this with the role they are given.
    return { meta, member: effective, archived: !!meta.archived && !admin };
  }
  // When a guest's access to a board ends, or null if it does not: the
  // expiry set when they joined, or for someone who became a guest without
  // one (a member made a guest, or a guest a migration added), the
  // organization's guest expiry from when they joined or became a guest.
  async guestEnds(record, user, orgRole) {
    if (orgRole && orgRole !== "guest") return null;
    if (record.expires) return record.expires;
    if (orgRole !== "guest" && !record.guest) return null;
    const policy = await this.org.accessPolicy();
    if (!policy.guestExpiryDays) return null;
    const account = await this.org.user(user.uuid);
    const start = Math.max(record.joined || 0, account?.roleChanged || 0);
    return start ? start + policy.guestExpiryDays * DAY : null;
  }
  // Board metadata and membership are read on every request, so each worker
  // instance reuses them for two seconds. Its own changes apply at once;
  // changes made on another instance (such as removing someone) apply within
  // two seconds.
  async record(key) {
    const hit = RECORDS.get(key);
    if (hit && this.now() - hit.at < 2000 && this.now() >= hit.at)
      return structuredClone(hit.value);
    const value = await this.kv.get(key);
    if (RECORDS.size > 5000) RECORDS.clear();
    RECORDS.set(key, { value, at: this.now() });
    return structuredClone(value);
  }
  forget(key) {
    RECORDS.delete(key);
    this.access?.clear();
  }
  // Every commit signals, so the last change in a burst always reaches
  // subscribers; deliveries coalesce over 250 ms anyway.
  async notify(room) {
    try {
      await this.kv.set(`wb:${room}:ev:signal`, { nonce: crypto.randomUUID() });
    } catch {
      /* The edit is already durable; reconciliation also runs without events. */
    }
  }
  async events(room, user) {
    const uid = appUid(this.puter.authToken);
    if (!uid) return null;
    // Only the worker's own account can watch its app KV directly.
    if (user.uuid === (await this.org.accountOwner()).uuid)
      return { app: uid, key: `wb:${room}:ev:signal`, owner: user.uuid };
    const cache = `wb:${room}:handle:${user.uuid}`;
    let handle = await this.kv.get(cache);
    if (!handle) {
      try {
        const res = await this.fetcher(
          `${this.puter.APIOrigin}/events/kv-handles`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.puter.authToken}`,
            },
            body: JSON.stringify({
              granteeUid: user.uuid,
              prefix: `wb:${room}:ev:`,
            }),
            signal: AbortSignal.timeout(3000),
          },
        );
        const data = await res.json();
        if (res.ok && data.handle) {
          handle = data.handle;
          await this.kv.set(cache, handle);
          // Indexed by person, so ending their access ends it everywhere,
          // including on boards an administrator watches without joining.
          await this.kv.set(`org:uh:${user.uuid}:${room}`, true);
        }
      } catch {
        /* Peer delivery and periodic synchronization remain available. */
      }
    }
    return handle ? { handle, key: "signal" } : null;
  }
  // Ends a person's presence, so they check in again with their new role,
  // and unless they keep access, their live board events.
  async dropHandle(room, target, { events = true } = {}) {
    for (const row of await this.list(`wb:${room}:presence:`))
      if (row.value.user === target) await this.kv.del(row.key);
    if (!events) return;
    const handle = await this.kv.get(`wb:${room}:handle:${target}`);
    if (handle) {
      const res = await this.fetcher(
        `${this.puter.APIOrigin}/events/kv-handles/${encodeURIComponent(handle)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.puter.authToken}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok || res.status === 404) {
        await this.kv.del(`wb:${room}:handle:${target}`);
        await this.kv.del(`org:uh:${target}:${room}`);
      }
    }
  }
  // A deactivated account loses live sessions on every board at once.
  async revokeSessions(uuid) {
    const rooms = new Set();
    for (const prefix of [`org:ub:${uuid}:`, `org:uh:${uuid}:`])
      for (const row of await this.org.list(prefix, { values: false }))
        rooms.add((typeof row === "string" ? row : row.key).split(":").at(-1));
    for (const room of rooms) {
      await this.dropHandle(room, uuid).catch(() => {});
      await this.notify(room);
    }
  }
  async members(room) {
    return (await this.list(`wb:${room}:member:`)).map((r) => r.value);
  }
  async refreshCounts(room) {
    const members = (await this.members(room)).filter(
      (m) => m.role !== "removed",
    );
    await this.org.registerBoard(room, {
      memberCount: members.length,
      guestCount: members.filter((m) => m.guest).length,
    });
  }
  async setMember(room, record) {
    this.forget(`wb:${room}:member:${record.uuid}`);
    await this.kv.set(`wb:${room}:member:${record.uuid}`, record);
    await this.org.indexMembership(record.uuid, room, record.role);
  }
  // Create any records the organization layer needs for boards that existed
  // before it: the registry, ownership, and the per-user membership index.
  async backfillRegistry() {
    for (const row of await this.list("wb:", false)) {
      const key = typeof row === "string" ? row : row.key;
      const match = /^wb:([^:]+):meta$/.exec(key);
      if (!match) continue;
      const room = match[1];
      if (await this.kv.get("org:board:" + room)) continue;
      const meta = await this.kv.get(key);
      const members = await this.members(room);
      for (const m of members)
        await this.org.indexMembership(m.uuid, room, m.role);
      let summary = { title: "Untitled board", objectCount: 0, types: {} };
      try {
        const { doc } = await this.load(room);
        try {
          summary = boardSummary(doc.snapshot());
        } finally {
          doc.destroy();
        }
      } catch {
        /* Keep an entry even if the board cannot be read right now. */
      }
      const ownerName = members.find((m) => m.uuid === meta.owner)?.username;
      const { text, content, ...rest } = summary;
      await this.kv.set("org:idx:" + room, text || "");
      await this.org.registerBoard(room, {
        ...rest,
        owner: meta.owner,
        ownerName: ownerName || null,
        created: meta.created,
        updated: meta.created,
        visibility: meta.visibility || "private",
        memberCount: members.filter((m) => m.role !== "removed").length,
        guestCount: members.filter((m) => m.guest).length,
      });
    }
  }
  async transfer(room, actor, target, { admin = false } = {}) {
    id(target);
    const meta = await this.kv.get(`wb:${room}:meta`);
    if (!meta) fail(404, "Board not found.");
    if (!admin) {
      const { member } = await this.member(room, actor);
      if (
        member.role !== "owner" ||
        (member.uuid !== meta.owner && !member.orgAdmin)
      )
        fail(
          403,
          "Only the board owner or an administrator can transfer ownership.",
        );
    }
    if (meta.owner === target) return { ok: true };
    const [previous, next, orgUser] = await Promise.all([
      this.kv.get(`wb:${room}:member:${meta.owner}`),
      this.kv.get(`wb:${room}:member:${target}`),
      this.org.user(target),
    ]);
    const owner = await this.org.accountOwner();
    const username =
      next?.username ||
      orgUser?.username ||
      (target === owner.uuid ? owner.username : null);
    if (!next && !orgUser && target !== owner.uuid)
      fail(404, "Choose someone in your organization.");
    // Boards go to someone who keeps access: never a deactivated account or
    // a guest, whose access to boards can end.
    // Once the organization is set up, that means someone it knows: a
    // member who joined the board before it existed has no record, and a
    // policy keeping boards to members would lock them out of their own.
    const configured = !!(await this.kv.get("org:meta"));
    if (
      target !== owner.uuid &&
      (orgUser?.status === "deactivated" ||
        orgUser?.role === "guest" ||
        (!orgUser && (next?.guest || configured)))
    )
      fail(400, "Choose an active member of your organization.");
    if (previous)
      await this.setMember(room, { ...previous, role: "facilitator" });
    // An owner's access never expires, whatever they had as a guest.
    const { expires: _, ...kept } = next || {};
    await this.setMember(room, {
      uuid: target,
      username: username || target,
      ...kept,
      role: "owner",
      guest: false,
    });
    this.forget(`wb:${room}:meta`);
    await this.kv.set(
      `wb:${room}:meta`,
      { ...((await this.kv.get(`wb:${room}:meta`)) || meta), owner: target },
      { disableSharing: true },
    );
    await this.org.registerBoard(room, { owner: target, ownerName: username });
    // The new owner may have joined the board, or stopped being a guest.
    await this.refreshCounts(room);
    await this.org.audit(
      actor,
      "board.transfer",
      { type: "board", id: room },
      {
        from: meta.owner,
        to: target,
      },
    );
    // The board's Slack channel belongs to whoever managed it before, so its
    // mentions stop going there; the new owner can connect their own.
    if (await this.kv.get("org:boardslack:" + room)) {
      await this.kv.del("org:boardslack:" + room);
      await this.org.audit(
        actor,
        "board.share.slack",
        { type: "board", id: room },
        { connected: false },
      );
    }
    await this.notify(room);
    return { ok: true };
  }
  async call(user, input) {
    if (!user?.uuid) fail(401, "Sign in with Puter to continue.");
    if (!input || bytes(input) > 17_000_000)
      fail(413, "Collaboration request is too large.");
    this.access = new Map();
    // People refused access, such as a deactivated account still polling,
    // do not count as active.
    let refused = false;
    try {
      return await this.dispatch(user, input);
    } catch (error) {
      refused = [401, 403, 404].includes(error.status);
      // Someone whose access ended, as a guest whose invitation lapsed,
      // stops receiving the board's live events too.
      if (
        [403, 404].includes(error.status) &&
        typeof input.room === "string" &&
        ID.test(input.room)
      )
        try {
          // Only when access itself ended: a refused operation, such as a
          // save arriving just after a demotion, leaves it.
          if (
            (await this.kv.get(`wb:${input.room}:handle:${user.uuid}`)) &&
            (await this.member(input.room, user).then(
              () => false,
              () => true,
            ))
          )
            await this.dropHandle(input.room, user.uuid);
        } catch {
          /* The refusal stands either way. */
        }
      throw error;
    } finally {
      if (!refused) await this.org.touch(user);
      await this.org.flush();
      await this.org.scheduledWork().catch(() => {});
    }
  }
  async dispatch(user, input) {
    const room = id(input.room),
      prefix = `wb:${room}:`;
    if (input.op === "create") {
      const accountOwner = await this.org.accountOwner();
      if (user.uuid !== accountOwner.uuid && !(await this.org.canCreate(user)))
        fail(403, "Only the server owner can create boards.");
      let meta = await this.kv.get(prefix + "meta");
      let created = false;
      // The directory and the audit record keep the same short label, never
      // whatever the request carried.
      const source =
        typeof input.source === "string" ? input.source.slice(0, 40) : null;
      if (!meta) {
        const doc = new SharedDocument(decode(input.update));
        let summary;
        try {
          summary = boardSummary(doc.validate());
        } finally {
          doc.destroy();
        }
        if ((await this.kv.incr(prefix + "creation")) !== 1)
          fail(
            409,
            "This board is already being created. Please retry sharing.",
          );
        // The claim is released below, and also lapses on its own, so a
        // worker stopped mid-creation never blocks sharing this board.
        await this.kv.expire(prefix + "creation", 120).catch(() => {});
        try {
          // An earlier attempt may have finished since the first read.
          meta = await this.kv.get(prefix + "meta");
          if (!meta) {
            const policy = await this.org.policy();
            const keys = await keyPair();
            const snapshot = `whiteboard/shared/${room}/initial-${await hash(input.update)}.txt`;
            await this.writeFile(snapshot, input.update);
            meta = {
              owner: user.uuid,
              snapshot,
              keys,
              created: this.now(),
              visibility:
                (await this.kv.get("org:meta")) && policy.defaultVisibility
                  ? policy.defaultVisibility
                  : "private",
              orgRole: "editor",
            };
            this.forget(prefix + "meta");
            await this.kv.set(prefix + "meta", meta, { disableSharing: true });
            created = true;
            const { text, content, ...rest } = summary;
            await this.kv.set("org:idx:" + room, text);
            await this.org.registerBoard(room, {
              ...rest,
              owner: user.uuid,
              ownerName: user.username || null,
              created: meta.created,
              updated: meta.created,
              lastActivity: meta.created,
              visibility: meta.visibility,
              team:
                typeof input.team === "string"
                  ? input.team.slice(0, 100)
                  : null,
              space:
                typeof input.space === "string"
                  ? input.space.slice(0, 100)
                  : null,
              source,
              memberCount: 1,
              guestCount: 0,
            });
          }
        } finally {
          await this.kv.del(prefix + "creation");
        }
      }
      if (meta.owner !== user.uuid)
        fail(403, "Only the board owner can finish creating this board.");
      // Repair a partial creation without replacing its snapshot or signing keys.
      if (!(await this.kv.get(prefix + "member:" + user.uuid)))
        await this.setMember(room, {
          uuid: user.uuid,
          username: user.username,
          role: "owner",
        });
      if (created)
        await this.org.audit(
          user,
          "board.created",
          {
            type: "board",
            id: room,
            name: (await this.kv.get("org:board:" + room))?.title,
          },
          { source },
        );
      return { room };
    }
    if (input.op === "join") await this.admit(room, user, input);
    const { meta, member, archived } = await this.member(room, user);
    if (input.op === "join") {
      return {
        room,
        member,
        archived,
        serverTime: this.now(),
        publicKey: meta.keys.publicKey,
        events:
          user.uuid === (await this.org.accountOwner()).uuid
            ? await this.events(room, user)
            : null,
        owner: meta.owner,
        app: appUid(this.puter.authToken),
        // Participants learn only whether the board is archived; who may
        // open it and whether it is under a legal hold are for its managers.
        settings: canManage(member.role)
          ? this.settings(meta)
          : { archived: !!meta.archived },
      };
    }
    if (input.op === "events") return { events: await this.events(room, user) };
    if (
      input.op === "invite" ||
      input.op === "role" ||
      input.op === "revoke-invite"
    ) {
      if (!canManage(member.role))
        fail(403, "Only the board owner can manage access.");
      const policy = await this.org.policy();
      if (input.op === "invite") {
        const role = INVITE_ROLES.includes(input.role) ? input.role : "editor";
        if (role === "facilitator" && member.role !== "owner")
          fail(403, "Only the board owner can invite facilitators.");
        const guest = input.guest === true;
        if (guest && (!policy.guestAccess || policy.externalSharing === "none"))
          fail(403, "Your organization does not allow guest access.");
        if (guest && policy.restrictToOrganization)
          fail(
            403,
            "Your organization only allows its own members on this board.",
          );
        const value = crypto.randomUUID() + crypto.randomUUID();
        await this.kv.set(prefix + "invite:" + (await hash(value)), {
          role,
          guest,
          created: this.now(),
          expires: this.now() + INVITE_DAYS * DAY,
          createdBy: user.uuid,
        });
        await this.org.audit(
          user,
          "board.invite.created",
          { type: "board", id: room },
          {
            role,
            guest,
          },
        );
        return { token: value };
      }
      if (input.op === "revoke-invite") {
        // Facilitators manage the roles below theirs; only the owner's own
        // revocation also ends facilitator invitations.
        for (const row of await this.list(prefix + "invite:"))
          if (member.role === "owner" || row.value?.role !== "facilitator")
            await this.kv.del(row.key);
        await this.org.audit(user, "board.invite.revoked", {
          type: "board",
          id: room,
        });
      } else {
        const target = id(input.uuid);
        if (
          target === meta.owner ||
          ![...INVITE_ROLES, "removed"].includes(input.role)
        )
          fail(400, "Invalid role change.");
        const record = await this.kv.get(prefix + "member:" + target);
        if (!record) fail(404, "Member not found.");
        // The board's details can be a moment old after a transfer made
        // elsewhere; the membership read just now names the owner too.
        if (record.role === "owner") fail(400, "Invalid role change.");
        if (
          member.role !== "owner" &&
          (record.role === "facilitator" || input.role === "facilitator")
        )
          fail(403, "Only the board owner can change facilitators.");
        await this.setMember(room, { ...record, role: input.role });
        // The role is already saved; a failed handle cleanup must not skip
        // the audit record or report the change as failed.
        await this.dropHandle(room, target, {
          events: input.role === "removed",
        }).catch(() => {});
        await this.refreshCounts(room);
        await this.org.audit(
          user,
          "board.role.changed",
          {
            type: "board",
            id: room,
            name: record.username,
          },
          { member: target, from: record.role, to: input.role },
        );
      }
      await this.notify(room);
      return { ok: true };
    }
    if (input.op === "settings.get") {
      if (!canManage(member.role))
        fail(
          403,
          "Only the board owner or a facilitator can change board settings.",
        );
      const [record, slack, integrations] = await Promise.all([
        this.kv.get("org:board:" + room),
        this.kv.get("org:boardslack:" + room),
        this.managesIntegrations(meta, user),
      ]);
      return {
        settings: {
          ...this.settings(meta),
          space: record?.space || null,
          team: record?.team || null,
          slack: !!slack,
          integrations,
        },
      };
    }
    if (input.op === "settings") {
      if (!canManage(member.role))
        fail(
          403,
          "Only the board owner or a facilitator can change board settings.",
        );
      return this.updateSettings(room, user, meta, input);
    }
    if (input.op === "transfer")
      return this.transfer(room, user, id(input.uuid));
    if (
      ["archive", "unarchive", "restore", "delete", "hold"].includes(input.op)
    )
      return this.govern(room, user, meta, member, input);
    if (input.op === "members") {
      // Members who can no longer open the board, as when their account is
      // deactivated or their guest access has ended, are marked, so no one
      // is offered them to assign or mention.
      const now = this.now();
      const members = await Promise.all(
        (await this.members(room)).map(async (m) =>
          m.role !== "removed" &&
          ((m.expires && m.expires < now) ||
            (await this.org.user(m.uuid))?.status === "deactivated")
            ? { ...m, inactive: true }
            : m,
        ),
      );
      return { members };
    }
    if (input.op === "presence") {
      const session = id(input.session),
        coordinate = /^[A-Za-z0-9_-]{43}$/;
      if (
        input.publicKey?.kty !== "EC" ||
        input.publicKey?.crv !== "P-256" ||
        input.publicKey?.d ||
        !coordinate.test(input.publicKey?.x) ||
        !coordinate.test(input.publicKey?.y)
      )
        fail(400, "Invalid peer key.");
      // One listing gives both the roster and this session's previous ticket.
      const rows = await this.list(prefix + "presence:");
      const old = rows.find(
        (r) => r.key === prefix + "presence:" + session,
      )?.value;
      // Someone else took this ID after the session lapsed. That is no loss
      // of access: the caller starts a new session.
      if (old && old.user !== user.uuid)
        fail(409, "Session belongs to another participant.");
      if (old)
        await this.org.recordTime(this.now() - (old.expires - SESSION_TTL));
      // Charge limits before writing so one account cannot fill the roster.
      const others = rows
        .map((r) => r.value)
        .filter((p) => p.expires > this.now() && p.session !== session);
      if (
        !old &&
        (others.length >= 512 ||
          others.filter((p) => p.user === user.uuid).length >= 16)
      )
        fail(429, "This board has reached its participant limit.");
      const ticket = {
        room,
        session,
        user: user.uuid,
        username: String(user.username || "Participant").slice(0, 80),
        role: member.role,
        ...(member.guest ? { guest: true } : {}),
        // Only the public coordinates are signed and redistributed.
        publicKey: {
          kty: "EC",
          crv: "P-256",
          x: input.publicKey.x,
          y: input.publicKey.y,
        },
        expires: this.now() + SESSION_TTL,
        invite:
          typeof input.invite === "string" ? input.invite.slice(0, 100) : null,
      };
      await this.kv.set(
        prefix + "presence:" + session,
        ticket,
        Math.floor(ticket.expires / 1000),
      );
      if (!old || old.invite !== ticket.invite) await this.notify(room);
      const roster = [...others, ticket].sort((a, b) =>
        a.session < b.session ? -1 : a.session > b.session ? 1 : 0,
      );
      await this.org.recordPeak(room, new Set(roster.map((p) => p.user)).size);
      return {
        ticket,
        signature: await sign(meta.keys.privateKey, ticket),
        roster,
        role: member.role,
        archived,
      };
    }
    if (input.op === "leave") {
      const key = prefix + "presence:" + id(input.session),
        entry = await this.kv.get(key);
      if (entry?.user === user.uuid) await this.kv.del(key);
      // Leaving within a minute of editing writes what the minute held back.
      const activity = this.org.instance.activity.get(room);
      if (activity?.editor?.uuid === user.uuid) {
        const { doc } = await this.load(room, meta);
        try {
          await this.writeActivity(
            room,
            activity.editor,
            doc.snapshot(),
            activity,
          ).catch(() => {});
        } finally {
          doc.destroy();
        }
      }
      return { ok: true };
    }
    if (input.op === "history.list") {
      // Edit records hold the edits themselves, but their keys name the time
      // and author, so only keys are read; names come from the members.
      const names = new Map(
        (await this.list(`${prefix}member:`)).map((r) => [
          r.value.uuid,
          r.value.username,
        ]),
      );
      const before = Number(input.before);
      const record = (row) => {
        const parts = (typeof row === "string" ? row : row.key)
          .slice(`${prefix}log:`.length)
          .split(":");
        const author = parts.at(-2);
        return {
          at: Date.parse(parts.slice(0, -2).join(":")),
          author,
          username: names.get(author) || "",
        };
      };
      // Keys are read newest first, a page at a time, until the versions
      // this page shows, and the one after them for `more`, are complete:
      // a version ends where no edit follows within the gap. Older edits
      // are not read, however long the board's history.
      const legacy = (await this.list(`${prefix}op:`)).map((r) => ({
        at: r.value.at,
        author: r.value.author,
        username: r.value.username,
      }));
      const logged = [];
      let cursor,
        complete = 0,
        newest = null,
        last = null;
      do {
        const page = await this.kv.list({
          pattern: `${prefix}log:`,
          returnValues: false,
          limit: 200,
          reverse: true,
          ...(cursor ? { cursor } : {}),
        });
        for (const row of Array.isArray(page) ? page : page.items) {
          const r = record(row);
          if (!Number.isFinite(r.at)) continue;
          // A gap closes the version holding the newer edits.
          if (last !== null && last - r.at > 5 * 60_000) {
            if (!Number.isFinite(before) || newest < before) complete++;
            newest = r.at;
          } else newest ??= r.at;
          last = r.at;
          logged.push(r);
        }
        cursor = page.cursor;
      } while (cursor && (legacy.length || complete <= 300));
      // Administrators can edit without a membership; their names come from
      // their organization records.
      for (const author of new Set(logged.map((r) => r.author)))
        if (!names.has(author)) {
          const account = await this.org.user(author).catch(() => null);
          names.set(author, account?.username || "");
          if (
            !names.get(author) &&
            author === (await this.org.accountOwner()).uuid
          )
            names.set(author, (await this.org.accountOwner()).username || "");
        }
      for (const r of logged) r.username = names.get(r.author) || "";
      const records = [...legacy, ...logged]
        .filter((v) => Number.isFinite(v.at))
        .sort((a, b) => a.at - b.at);
      // Newest first, a page at a time: `before` asks for the versions
      // older than the last one shown.
      const older = historyVersions(records, undefined, Infinity).filter(
        (v) => !Number.isFinite(before) || v.at < before,
      );
      return {
        created: meta.created,
        versions: older.slice(0, 300),
        more: older.length > 300,
      };
    }
    if (input.op === "history.state") {
      const at = Number(input.at);
      if (!Number.isFinite(at)) fail(400, "Choose a version.");
      const { doc, count } = await this.loadAt(room, at);
      try {
        return { at, edits: count, update: encode(doc.update()) };
      } finally {
        doc.destroy();
      }
    }
    if (input.op === "history.restored" || input.op === "export") {
      const key = `${room}|${user.uuid}`,
        minute = Math.floor(this.now() / 60000),
        seen = REPORTS.get(key);
      const count = seen?.minute === minute ? seen.count + 1 : 1;
      if (count > REPORT_LIMIT)
        fail(429, "Too many requests. Try again in a minute.");
      REPORTS.delete(key);
      REPORTS.set(key, { minute, count });
      if (REPORTS.size > 5000) REPORTS.delete(REPORTS.keys().next().value);
    }
    if (input.op === "history.restored") {
      await this.member(room, user, true);
      await this.org.audit(
        user,
        "board.content.restored",
        { type: "board", id: room },
        {
          version: Number(input.at) || null,
          scope: ["board", "objects", "frame", "deleted"].includes(input.scope)
            ? input.scope
            : "board",
          objects: Number.isInteger(input.objects) ? input.objects : null,
        },
      );
      return { ok: true };
    }
    if (input.op === "export") {
      const format = String(input.format || "").slice(0, 20);
      await this.org.audit(
        user,
        "board.export",
        { type: "board", id: room },
        {
          format,
          scope: String(input.scope || "").slice(0, 20),
        },
      );
      return { ok: true };
    }
    if (input.op === "asset.put" || input.op === "asset.get") {
      if (!/^[a-f0-9]{64}$/.test(input.asset)) fail(400, "Invalid asset.");
      const path = `whiteboard/shared/${room}/assets/${input.asset}.txt`;
      // Assets are content-addressed, so cached copies never go stale.
      if (input.op === "asset.get")
        return { data: await this.cachedFile(path) };
      await this.member(room, user, true);
      if (
        typeof input.data !== "string" ||
        // The same limit the board itself sets for attachments.
        input.data.length > 15 * 1024 * 1024 ||
        !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,[A-Za-z0-9+/=]*$/.test(
          input.data,
        ) ||
        (await hash(input.data)) !== input.asset
      )
        fail(400, "Invalid shared asset.");
      await this.writeFile(path, input.data);
      return { ok: true };
    }
    if (input.op === "sync" || input.op === "commit") {
      if (input.op === "commit") await this.member(room, user, "comment");
      const { doc } = await this.load(room, meta);
      try {
        let receipt;
        if (input.op === "commit") {
          // Too large to accept is final, so the client can drop the edit
          // instead of retrying it forever.
          if (
            typeof input.update === "string" &&
            input.update.length > UPDATE_LIMIT
          )
            fail(413, "This change is too large to save.");
          const update = decode(input.update, UPDATE_LIMIT),
            digest = await hash(update);
          if (input.id !== digest) fail(400, "Update checksum does not match.");
          const before = doc.snapshot(),
            counts = doc.commentCounts();
          const store = doc.doc.store,
            pending = !!(store.pendingDs || store.pendingStructs);
          const claims = await this.clientClaims(prefix, store, update, user);
          const written = doc.applyTracked(update);
          // An update can carry edits or deletions that wait for clocks this
          // state has not seen. They are invisible to every check below and
          // would apply later, for example erasing another person's future
          // edits, so they are refused. A client ahead of this instance
          // retries once the edits it builds on arrive.
          if (!pending && (store.pendingDs || store.pendingStructs))
            fail(
              409,
              "This change depends on edits that have not arrived yet.",
            );
          let after;
          try {
            doc.validate();
            after = doc.snapshot();
            validateCommentChanges(
              before.comments,
              after.comments,
              user,
              this.now(),
            );
            validateCommentGrowth(counts, doc.commentCounts());
            validateWorkshopWrites(
              written.workshop,
              member.role,
              user,
              after.workshop,
            );
            validateWorkshopChanges(
              before,
              after,
              user,
              member.role,
              this.now(),
              written,
            );
            // Rewriting someone else's comment with its own words changes
            // nothing visible but would win over the author's own edit.
            for (const [thread, ids] of written.messages)
              for (const id of ids) {
                const author = doc.comments
                  .get(thread)
                  ?.get("messages")
                  ?.get(id)
                  ?.get?.("authorId");
                if (author !== undefined && author !== user.uuid)
                  throw Error("Only the author can edit this comment.");
              }
          } catch (error) {
            // Concurrent edits can cross board limits; retrying this batch
            // only succeeds after the shared state changes.
            fail(422, error.message || "This change was rejected.");
          }
          // Rewriting content with its current values changes nothing
          // visible but still wins over editors' concurrent changes.
          if (
            !canEditContent(member.role) &&
            ([...written.roots].some(
              (root) => root !== "comments" && root !== "workshop",
            ) ||
              contentSignature(before) !== contentSignature(after))
          )
            fail(
              422,
              "Commenters can add comments but cannot change board content.",
            );
          // Assets already on the board were checked when they were added;
          // only newly referenced ones must be uploaded first.
          const assets = (board) =>
            new Set(
              board.items.flatMap((item) =>
                ["src", "data"]
                  .map((key) => ASSET.exec(item[key] || "")?.[1])
                  .filter(Boolean),
              ),
            );
          const known = assets(before);
          for (const asset of assets(after))
            if (!known.has(asset))
              await this.puter.fs.stat(
                `whiteboard/shared/${room}/assets/${asset}.txt`,
              );
          await this.claim(claims, user);
          const record = {
            id: digest,
            author: user.uuid,
            username: user.username,
            at: this.now(),
          };
          const flight = `${room}|${user.uuid}|${digest}`;
          let fresh = false;
          if (!COMMITS.has(flight)) {
            fresh = true;
            if (COMMITS.size > 5000)
              COMMITS.delete(COMMITS.keys().next().value);
            COMMITS.set(
              flight,
              (async () => {
                if (input.update.length <= MAX_UPDATE)
                  record.update = input.update;
                else {
                  record.path = `whiteboard/shared/${room}/updates/${digest}.txt`;
                  await this.writeFile(record.path, input.update);
                }
                // The record's time is when it becomes visible, not when the
                // commit arrived: a slow file write must not leave it older
                // than the window other instances read again when they
                // refresh, or they would never apply it.
                record.at = this.now();
                await this.kv.set(
                  `${prefix}log:${new Date(record.at).toISOString()}:${user.uuid}:${digest}`,
                  record,
                );
              })().catch((error) => {
                COMMITS.delete(flight);
                throw error;
              }),
            );
          }
          await COMMITS.get(flight);
          receipt = { id: digest, author: user.uuid, room };
          this.remember(room, update);
          await this.notify(room);
          if (fresh) await this.recordActivity(room, user, before, after);
        } else {
          // Activity counted within a minute of the last write is written
          // once the minute has passed.
          const entry = this.org.instance.activity.get(room);
          if (entry?.editor && this.now() - entry.at >= 60_000)
            await this.writeActivity(
              room,
              entry.editor,
              doc.snapshot(),
              entry,
            ).catch(() => {});
        }
        return {
          serverTime: this.now(),
          update: encode(
            doc.update(input.vector ? decode(input.vector) : undefined),
          ),
          receipt,
          receiptProof: receipt
            ? await sign(meta.keys.privateKey, receipt)
            : undefined,
          role: member.role,
          archived,
        };
      } finally {
        doc.destroy();
      }
    }
    fail(400, "Unknown collaboration operation.");
  }
  // A browser only ever uploads its own edits, made under its own Yjs client
  // IDs. Content added under someone else's ID, even content nobody can see,
  // would occupy the positions their next edits take, so every copy of the
  // board would drop those edits. The first person whose accepted commit adds
  // content under an ID owns it; content under another person's ID is
  // refused. Returns the IDs this commit would claim.
  async clientClaims(prefix, store, update, user) {
    let to;
    try {
      ({ to } = parseUpdateMeta(update));
    } catch {
      fail(400, "Invalid collaboration update.");
    }
    const claims = [];
    for (const [client, clock] of to) {
      if (clock <= getState(store, client)) continue;
      const key = `${prefix}client:${client}`;
      const owner = CLIENTS.get(key) ?? (await this.kv.get(key));
      if (!owner) claims.push(key);
      else {
        keepClient(key, owner);
        if (owner !== user.uuid)
          fail(422, "This change continues another participant's edits.");
      }
    }
    return claims;
  }
  async claim(claims, user) {
    for (const key of claims) {
      await this.kv.set(key, user.uuid);
      keepClient(key, user.uuid);
    }
  }
  async managesIntegrations(meta, user) {
    if (meta.owner === user.uuid) return true;
    const role = await this.org.role(user);
    return role === "owner" || role === "admin";
  }
  settings(meta) {
    return {
      visibility: meta.visibility || "private",
      orgRole: meta.orgRole || "editor",
      linkRole: meta.linkRole || "viewer",
      archived: !!meta.archived,
      legalHold: !!meta.legalHold,
    };
  }
  // New membership: an invitation, organization-wide visibility, or a public
  // link, each subject to the organization's external sharing policy.
  async admit(room, user, input) {
    // A deactivated account joins nothing, so no membership, audit record,
    // or guest count is left behind for a later reactivation.
    if (!(await this.org.active(user)))
      fail(403, "Your organization account is deactivated.");
    const prefix = `wb:${room}:`;
    const prior = await this.kv.get(prefix + "member:" + user.uuid);
    // Administrators govern every board, even one they were removed from,
    // as the Miro migration does for the administrator who ran it.
    if (prior?.role === "removed") {
      const orgRole = await this.org.role(user);
      if (orgRole !== "owner" && orgRole !== "admin")
        fail(403, "Your board access was removed.");
      return;
    }
    // Invitation validity controls new membership, not an existing member's
    // access. A guest whose access expired can be let back in by a newer
    // invitation, which starts their guest access again.
    let lapsed = false;
    if (prior && input.token) {
      const ends = await this.guestEnds(prior, user, await this.org.role(user));
      lapsed = ends !== null && ends < this.now();
    }
    if (prior && !lapsed) return;
    const [meta, orgRole, policy, configured] = await Promise.all([
      this.kv.get(prefix + "meta"),
      this.org.role(user),
      this.org.policy(),
      this.kv.get("org:meta"),
    ]);
    if (!meta) fail(404, "Board not found.");
    if (orgRole === "owner" || orgRole === "admin") return;
    // A deleted board admits no one, so joining it records nothing.
    if (meta.deleted) fail(404, "Board not found.");
    const insider = !!orgRole && orgRole !== "guest";
    let role = null,
      guest = false;
    if (input.token) {
      const invite = await this.kv.get(
        prefix + "invite:" + (await hash(input.token)),
      );
      if (!invite || invite.revoked || invite.expires < this.now())
        fail(403, "This invitation has expired or was revoked.");
      // An invitation stops working once the person who made it could no
      // longer grant its role, as when a facilitator is removed or an owner
      // who invited facilitators hands the board to someone else.
      if (invite.createdBy) {
        const issuer = await this.member(room, {
          uuid: invite.createdBy,
        }).catch(() => null);
        const role = issuer?.member.role;
        if (
          !canManage(role) ||
          (invite.role === "facilitator" && role !== "owner")
        )
          fail(403, "This invitation has expired or was revoked.");
      }
      // An invitation from before the guest joined cannot renew them.
      const created = invite.created ?? invite.expires - INVITE_DAYS * DAY;
      if (lapsed && !(created > (prior.joined || 0)))
        fail(403, "Your guest access to this board has expired.");
      role = invite.role;
      guest = configured
        ? !insider || invite.guest === true
        : invite.guest === true;
    } else if (meta.visibility === "organization" && insider) {
      role = meta.orgRole || "editor";
    } else if (meta.visibility === "link") {
      role = meta.linkRole || "viewer";
      guest = !!configured && !insider;
      // Public links stop admitting outsiders once the organization turns
      // them off, like setting a board's visibility to a public link.
      if (guest && (!policy.publicLinks || policy.externalSharing !== "anyone"))
        fail(403, "Your organization does not allow public board links.");
    }
    if (!role) return;
    if (guest && configured) {
      if (policy.externalSharing === "none" || policy.restrictToOrganization)
        fail(
          403,
          "Your organization only allows its own members on this board.",
        );
      if (!policy.guestAccess)
        fail(403, "Your organization does not allow guest access.");
    }
    const record = {
      uuid: user.uuid,
      username: user.username,
      role,
      ...(guest ? { guest: true } : {}),
      ...(guest && configured && policy.guestExpiryDays
        ? { expires: this.now() + policy.guestExpiryDays * DAY }
        : {}),
      joined: this.now(),
    };
    await this.setMember(room, record);
    if (guest && configured && !(await this.org.user(user.uuid)))
      await this.org.saveUser({
        uuid: user.uuid,
        username: user.username,
        role: "guest",
        status: "active",
        license: "guest",
        created: this.now(),
        source: "board",
        teams: [],
      });
    await this.refreshCounts(room);
    await this.org.audit(
      user,
      guest ? "board.guest.joined" : "board.joined",
      { type: "board", id: room },
      { role, via: input.token ? "invitation" : meta.visibility },
    );
  }
  async updateSettings(room, user, meta, input) {
    const policy = await this.org.policy();
    const configured = !!(await this.kv.get("org:meta"));
    if (input.slack !== undefined) {
      // Mentions go to this channel, so only the owner or an administrator
      // chooses it; a facilitator's own channel would outlast their access.
      if (!(await this.managesIntegrations(meta, user)))
        fail(
          403,
          "Only the board owner or an administrator can connect Slack.",
        );
      if (
        input.slack &&
        !/^https:\/\/hooks\.slack\.com\//.test(String(input.slack))
      )
        fail(400, "Enter a Slack incoming webhook URL.");
    }
    const changes = {};
    if (input.visibility !== undefined) {
      if (!["private", "organization", "link"].includes(input.visibility))
        fail(400, "Invalid visibility.");
      // Only turning a public link on is refused; a board that kept one
      // from before the policy changed can still save its other settings.
      if (
        input.visibility === "link" &&
        meta.visibility !== "link" &&
        configured &&
        (!policy.publicLinks || policy.externalSharing !== "anyone")
      )
        fail(403, "Your organization does not allow public board links.");
      changes.visibility = input.visibility;
    }
    for (const key of ["orgRole", "linkRole"])
      if (input[key] !== undefined) {
        if (!["editor", "commenter", "viewer"].includes(input[key]))
          fail(400, "Invalid default role.");
        changes[key] = input[key];
      }
    // Every field is checked before anything is saved, so a refused
    // request never changes the board's visibility on its own.
    const filed = {};
    for (const key of ["team", "space"])
      if (input[key] !== undefined)
        filed[key] = input[key] ? id(input[key]) : null;
    // Spaces and teams are the organization's; only its members file boards
    // into them, and only into ones that exist.
    if (Object.keys(filed).length) {
      const role = await this.org.role(user);
      if (!role || role === "guest")
        fail(403, "Only organization members can file boards into spaces.");
      for (const [key, value] of Object.entries(filed))
        if (value && !(await this.kv.get(`org:${key}:${value}`)))
          fail(400, "Choose a space or team that exists.");
    }
    // Only the requested fields change, on the latest copy, so a hold,
    // archive, or transfer made meanwhile is kept.
    const next = {
      ...((await this.kv.get(`wb:${room}:meta`)) || meta),
      ...changes,
    };
    this.forget(`wb:${room}:meta`);
    await this.kv.set(`wb:${room}:meta`, next, { disableSharing: true });
    const patch = { visibility: next.visibility || "private", ...filed };
    const record = await this.org.registerBoard(room, patch);
    if (input.slack !== undefined) {
      const had = !!(await this.kv.get("org:boardslack:" + room));
      // Who connected it is kept, so the channel stops hearing about the
      // board once they no longer manage it.
      if (input.slack)
        await this.kv.set(
          "org:boardslack:" + room,
          { url: String(input.slack).slice(0, 2048), by: user.uuid },
          {
            disableSharing: true,
          },
        );
      else await this.kv.del("org:boardslack:" + room);
      if (had || input.slack)
        await this.org.audit(
          user,
          "board.share.slack",
          { type: "board", id: room },
          { connected: !!input.slack },
        );
    }
    if ((meta.visibility || "private") !== (next.visibility || "private"))
      await this.org.audit(
        user,
        next.visibility === "link"
          ? "board.visibility.link"
          : "board.visibility.changed",
        { type: "board", id: room },
        { from: meta.visibility || "private", to: next.visibility },
      );
    await this.notify(room);
    return {
      settings: {
        ...this.settings(next),
        space: record.space || null,
        team: record.team || null,
      },
    };
  }
  async govern(room, user, meta, member, input) {
    const orgRole = await this.org.role(user);
    const admin = orgRole === "owner" || orgRole === "admin";
    if (input.op === "hold" && !admin)
      fail(403, "Only organization administrators can place legal holds.");
    if (!admin && !(member.role === "owner" && meta.owner === user.uuid))
      fail(403, "Only the board owner or an administrator can do this.");
    // Retention has begun removing its records, so it could only come back
    // with part of it missing.
    if ((await this.kv.get("org:board:" + room))?.purging)
      fail(409, "This board is being permanently deleted.");
    if (
      input.op === "delete" &&
      (meta.legalHold ||
        (await this.kv.get("org:board:" + room))?.legalHold ||
        (await this.org.policy()).retention.legalHold)
    )
      fail(409, "This board is under a legal hold and cannot be deleted.");
    // The change applies to the latest copy, so another request's change,
    // such as a legal hold, is kept. A board purged since this request read
    // it is not written back.
    const latest = await this.kv.get(`wb:${room}:meta`);
    if (!latest) fail(404, "Board not found.");
    // Deleting a board already in the trash keeps the time it went there,
    // so repeating the request cannot put off its permanent deletion.
    if (input.op === "delete" && latest.deleted)
      return { settings: this.settings(latest) };
    const next = { ...latest };
    if (input.op === "archive") next.archived = this.now();
    if (input.op === "unarchive") delete next.archived;
    if (input.op === "restore") {
      delete next.archived;
      delete next.deleted;
    }
    if (input.op === "delete") {
      if (next.legalHold)
        fail(409, "This board is under a legal hold and cannot be deleted.");
      next.deleted = this.now();
    }
    if (input.op === "hold") next.legalHold = input.enabled !== false;
    this.forget(`wb:${room}:meta`);
    await this.kv.set(`wb:${room}:meta`, next, { disableSharing: true });
    await this.org.registerBoard(room, {
      archived: next.archived || null,
      deleted: next.deleted || null,
      legalHold: !!next.legalHold,
    });
    await this.org.audit(
      user,
      {
        archive: "board.archived",
        unarchive: "board.unarchived",
        restore: "board.restored",
        delete: "board.deleted",
        hold: next.legalHold ? "board.hold.placed" : "board.hold.released",
      }[input.op],
      { type: "board", id: room },
    );
    await this.notify(room);
    return { settings: this.settings(next) };
  }
  async recordActivity(room, user, before, after) {
    try {
      const old = new Map(before.items.map((i) => [i.id, JSON.stringify(i)]));
      const now = new Set(after.items.map((i) => i.id));
      let added = 0,
        changed = 0;
      for (const i of after.items)
        if (!old.has(i.id)) added++;
        else if (old.get(i.id) !== JSON.stringify(i)) changed++;
      const removed = before.items.filter((i) => !now.has(i.id)).length;
      // Directory, search index, and content audit records are written at
      // most once a minute per board and worker instance; counts in between
      // are added up. Busy workshops would otherwise spend the worker's
      // storage quota on bookkeeping.
      const activity = this.org.instance.activity;
      const entry = activity.get(room) || {
        at: 0,
        added: 0,
        changed: 0,
        removed: 0,
        editors: new Set(),
      };
      entry.added += added;
      entry.changed += changed;
      entry.removed += removed;
      if (added || changed || removed) entry.editors.add(user.uuid);
      if (activity.size > 1000) activity.clear();
      activity.set(room, entry);
      if (this.now() - entry.at >= 60_000 || before.title !== after.title)
        await this.writeActivity(room, user, after, entry);
      // Otherwise the next synchronization after the minute writes it, so
      // removed content does not stay findable when the board goes quiet,
      // and revealed content becomes findable.
      else if (
        added ||
        changed ||
        removed ||
        JSON.stringify(before.workshop?.settings) !==
          JSON.stringify(after.workshop?.settings)
      )
        entry.editor = user;
      await this.commentNotifications(room, user, before, after);
      await this.taskAssignments(room, user, before, after);
      for (const { action, details } of workshopEvents(
        before.workshop,
        after.workshop,
      ))
        await this.org.audit(
          user,
          action,
          { type: "board", id: room, name: after.title },
          details,
        );
    } catch {
      /* Activity records never block an acknowledged edit. */
    }
  }
  // The directory entry, search index, and content audit record of a board,
  // with the edits counted since they were last written.
  async writeActivity(room, user, board, entry) {
    entry.at = this.now();
    entry.editor = null;
    const { text, content, ...summary } = boardSummary(board);
    const fingerprint = (await hash(content)).slice(0, 24);
    await this.org.registerBoard(room, {
      ...summary,
      fingerprint,
      updated: this.now(),
      lastActivity: this.now(),
      lastEditor: user.uuid,
    });
    await this.kv.set("org:idx:" + room, text);
    if (entry.added || entry.changed || entry.removed)
      await this.org.audit(
        user,
        "board.content.updated",
        { type: "board", id: room, name: board.title },
        {
          added: entry.added,
          changed: entry.changed,
          removed: entry.removed,
          editors: [...entry.editors].slice(0, 50),
        },
      );
    entry.added = entry.changed = entry.removed = 0;
    entry.editors.clear();
  }
  // Notifications carry the board's title and content, so only people who
  // could open the board now receive them: not guests whose access lapsed
  // or that the organization's policy no longer admits.
  async canOpen(room, person) {
    return this.member(room, {
      uuid: person.uuid,
      username: person.username,
    }).then(
      () => true,
      () => false,
    );
  }
  // A task newly assigned to a board member notifies that member. Free-text
  // assignees on personal boards have no account and are not notified.
  async taskAssignments(room, user, before, after) {
    const changes = assignmentChanges(before, after);
    if (!changes.length) return;
    const members = new Map(
      (await this.members(room))
        .filter((m) => m.role !== "removed")
        .map((m) => [m.uuid, m]),
    );
    // A task the workshop hides from its assignee, such as one in a frame
    // not yet revealed, is not named or counted to them.
    const concealed = new Map();
    const unseen = (member, id) => {
      if (!after.workshop) return false;
      if (!concealed.has(member.uuid)) {
        const c = concealment(after, member.uuid, canManage(member.role));
        concealed.set(
          member.uuid,
          new Set([...c.hidden, ...c.frames, ...c.notes]),
        );
      }
      return concealed.get(member.uuid).has(id);
    };
    // Notes added while the workshop takes anonymous input, or recorded as
    // anonymous, do not name who wrote them in the notification either.
    const earlier = new Set(before.items.map((i) => i.id)),
      anonymous = !!workshopSettings(after).anonymous;
    const unnamed = (id) =>
      !!after.workshop?.[contributionKey(id)]?.anonymous ||
      (anonymous && !earlier.has(id));
    // Each person hears about an edit once, naming its first task and how
    // many more it gave them, so pasting many assigned tasks floods no one.
    const first = new Map(),
      rest = { count: 0, assignees: new Set() },
      probes = new Map();
    let budget = 200;
    for (const [index, { item, assignee }] of changes.entries()) {
      const member = members.get(assignee.id);
      if (!member) continue;
      // Past the first hundred, one edit's assignments still reach their
      // people in their grouped notification and are audited together.
      // Each person's first few are checked against, and recorded as,
      // earlier announcements, so tasks that come back all at once, as
      // after restoring a version, are not announced again; the others
      // count only toward a notification already due.
      if (index >= 100) {
        rest.count++;
        rest.assignees.add(member.uuid);
        if (unseen(member, item.id)) continue;
        const entry = first.get(member.uuid),
          probed = probes.get(member.uuid) || 0;
        if (probed < 10 && budget > 0) {
          probes.set(member.uuid, probed + 1);
          const told = `wb:${room}:assigned:${item.id}`;
          budget--;
          if (!entry && member.uuid !== user.uuid) {
            budget--;
            if ((await this.kv.get(told)) === member.uuid) continue;
          }
          await this.kv.set(
            told,
            member.uuid,
            Math.floor((this.now() + 30 * DAY) / 1000),
          );
        } else if (!entry) continue;
        if (member.uuid === user.uuid) continue;
        if (entry) entry.more++;
        else first.set(member.uuid, { item, more: 0 });
        if (unnamed(item.id)) first.get(member.uuid).anonymous = true;
        continue;
      }
      // A task that comes back with the same assignee, as after undoing
      // its deletion, restoring a version, or cutting and pasting it, was
      // already announced; repeating that must not flood their inbox.
      const told = `wb:${room}:assigned:${item.id}`;
      // Someone who assigns a task to themselves hears nothing, and nor
      // when someone else later brings that task back.
      if (member.uuid === user.uuid)
        await this.kv.set(
          told,
          member.uuid,
          Math.floor((this.now() + 30 * DAY) / 1000),
        );
      else if (
        !unseen(member, item.id) &&
        (await this.kv.get(told)) !== member.uuid
      ) {
        await this.kv.set(
          told,
          member.uuid,
          Math.floor((this.now() + 30 * DAY) / 1000),
        );
        const entry = first.get(member.uuid);
        if (entry) entry.more++;
        else first.set(member.uuid, { item, more: 0 });
        if (unnamed(item.id)) first.get(member.uuid).anonymous = true;
      }
      await this.org.audit(
        user,
        "board.content.task_assigned",
        { type: "board", id: room, name: after.title },
        { item: item.id, assignee: member.uuid },
      );
    }
    if (rest.count)
      await this.org.audit(
        user,
        "board.content.task_assigned",
        { type: "board", id: room, name: after.title },
        {
          count: rest.count,
          assignees: [...rest.assignees].slice(0, 20),
        },
      );
    for (const [uuid, { item, more, anonymous: hide }] of first) {
      if (!(await this.canOpen(room, members.get(uuid)))) continue;
      const captured = capturedTaskTitle(item),
        title = captured.title;
      const others = more ? ` and ${more} more` : "";
      const who = hide ? "A participant" : user.username;
      await this.org.notify(uuid, {
        type: "assignment",
        board: room,
        boardTitle: after.title,
        item: item.id,
        ...(hide
          ? { anonymous: true }
          : { actor: { uuid: user.uuid, username: user.username } }),
        subject: `${who} assigned you ${more ? "tasks" : "a task"} on ${after.title}`,
        text: `${who}: ${title}${item.task.due ? ` (due ${item.task.due})` : ""}${others}`,
        // The app words notifications in each person's language.
        ...captured,
        ...(item.task.due ? { due: item.task.due } : {}),
        ...(more ? { more } : {}),
      });
    }
  }
  // Mentions and replies become notifications for the people involved.
  async commentNotifications(room, user, before, after) {
    const known = new Set(
      (before.comments || []).flatMap((t) => t.messages.map((m) => m.id)),
    );
    const added = [];
    for (const thread of after.comments || [])
      for (const message of thread.messages)
        if (!known.has(message.id) && !message.deleted)
          added.push({ thread, message });
    if (!added.length) return;
    const members = (await this.members(room)).filter(
      (m) => m.role !== "removed",
    );
    const byName = new Map(
      members.map((m) => [String(m.username || "").toLowerCase(), m]),
    );
    const memberIds = new Set(members.map((m) => m.uuid));
    // One edit can hold many messages, as when threads are pasted. Only the
    // first few notify anyone or are audited one by one, each person hears
    // about the edit once, and the board's channel gets one post, so no edit
    // can flood anyone. The rest are audited together in one record.
    const notified = new Set();
    const target = { type: "board", id: room, name: after.title };
    const rest = { count: 0, threads: new Set(), mentions: 0 };
    let posted = false;
    for (const [index, { thread, message }] of added.entries()) {
      const recipients = new Map();
      for (const name of mentions(message.text)) {
        const m = byName.get(name);
        if (m && m.uuid !== user.uuid) recipients.set(m.uuid, "mention");
      }
      for (const prior of thread.messages)
        if (
          prior.id !== message.id &&
          prior.authorId !== user.uuid &&
          memberIds.has(prior.authorId) &&
          !recipients.has(prior.authorId)
        )
          recipients.set(prior.authorId, "reply");
      const excerpt = commentExcerpt(message.text, 280);
      const lang = canonicalLanguage(message.lang),
        runs = [];
      // The notification owns a snapshot, including only the captured text's
      // language ranges. Later edits/deletion must not change its declaration.
      for (const run of sliceTextRuns(message.textRuns, 0, excerpt.length)) {
        const tag = canonicalLanguage(run.style.lang);
        if (tag) appendRun(runs, run.start, run.end, { lang: tag });
      }
      for (const [uuid, type] of recipients) {
        if (index >= 20 || notified.has(uuid)) continue;
        notified.add(uuid);
        const person = members.find((m) => m.uuid === uuid);
        if (!(await this.canOpen(room, person))) continue;
        const channel = type === "mention" && !posted;
        posted ||= channel;
        await this.org.notify(uuid, {
          type,
          board: room,
          boardTitle: after.title,
          thread: thread.id,
          item: thread.anchorId || null,
          actor: { uuid: user.uuid, username: user.username },
          subject:
            type === "mention"
              ? `${user.username} mentioned you on ${after.title}`
              : `${user.username} replied on ${after.title}`,
          text: `${user.username}: ${excerpt}`,
          excerpt,
          ...(lang ? { excerptLang: lang } : {}),
          ...(runs.length ? { excerptRuns: runs } : {}),
          channel,
        });
      }
      const mentioned = [...recipients.values()].filter(
        (t) => t === "mention",
      ).length;
      if (index < 20)
        await this.org.audit(user, "board.comment.created", target, {
          thread: thread.id,
          mentions: mentioned,
        });
      else {
        rest.count++;
        rest.threads.add(thread.id);
        rest.mentions += mentioned;
      }
    }
    if (rest.count)
      await this.org.audit(user, "board.comment.created", target, {
        count: rest.count,
        threads: [...rest.threads].slice(0, 20),
        mentions: rest.mentions,
      });
  }
}
export { ROLES };
