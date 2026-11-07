import { convertMiroBoard, reportTotals } from "./miro-convert.js";
import { abortableSleep } from "./miro-client.js";

// Migration planning, execution and validation logs. Board creation, deletion
// and log storage are injected by the host; this module never calls Puter.

export const BOARD_ROLES = [
  "owner",
  "facilitator",
  "editor",
  "commenter",
  "viewer",
];
// No prototype, so a role such as "constructor" maps to viewer.
const ROLE_MAP = {
  __proto__: null,
  owner: "owner",
  coowner: "facilitator",
  co_owner: "facilitator",
  editor: "editor",
  commenter: "commenter",
  viewer: "viewer",
};
// Miro organization roles that always denote people outside the organization.
const GUEST_ORG_ROLES = new Set([
  "organization_external_user",
  "organization_team_guest_user",
  "guest",
]);
export const LOG_STATUSES = ["pending", "migrated", "failed", "rolled-back"];
const EVENT_LIMIT = 20_000;
const WARNING_LIMIT = 50;
const SAVE_ATTEMPTS = 3;
const SAVE_RETRY_MS = 500;

export const mapRole = (role) =>
  ROLE_MAP[
    String(role || "")
      .toLowerCase()
      .replace(/[\s-]/g, "_")
  ] || "viewer";

export function parseDomains(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[\s,;]+/)
        .map((d) =>
          d
            .trim()
            .toLowerCase()
            .replace(/^@|^\*?\./, ""),
        )
        .filter((d) => /^[a-z\d-]+(\.[a-z\d-]+)+$/.test(d)),
    ),
  ];
}
export const emailDomain = (email) => {
  const m = String(email || "")
    .trim()
    .toLowerCase()
    .match(/^[^@\s]+@([^@\s]+)$/);
  return m ? m[1] : null;
};
// Subdomains count as the organization: hr.example.org matches example.org.
export const domainMatches = (domain, domains) =>
  !!domain && domains.some((d) => domain === d || domain.endsWith(`.${d}`));
export function userKind({ email, orgRole } = {}, domains = []) {
  if (GUEST_ORG_ROLES.has(String(orgRole || "").toLowerCase())) return "guest";
  const domain = emailDomain(email);
  if (!domain || !domains.length) return "unknown";
  return domainMatches(domain, domains) ? "internal" : "guest";
}
// Optional mapping for teams without Enterprise directory access. One user
// per line: Miro user ID, then email, separated by a comma, semicolon or tab.
export function parseEmailMap(text) {
  const map = {},
    invalid = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, n) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return;
      const [id, email] = value.split(/\s*[,;\t]\s*/);
      if (id && emailDomain(email)) map[id] = email.trim().toLowerCase();
      else if (!/email/i.test(value)) invalid.push(n + 1);
    });
  return { map, invalid };
}
export function userDirectory({ orgMembers = [], emailMap = {} } = {}) {
  const directory = new Map();
  for (const m of orgMembers)
    if (m?.id != null)
      directory.set(String(m.id), {
        email: m.email ? String(m.email).toLowerCase() : null,
        name: m.name || null,
        orgRole: m.role || null,
      });
  for (const [id, email] of Object.entries(emailMap))
    directory.set(String(id), { ...directory.get(String(id)), email });
  return directory;
}

// One inventory row per board, with the owner and member roles resolved.
export function boardEntry(
  board,
  members = [],
  { directory = new Map(), domains = [], itemCount = null, teams } = {},
) {
  const person = (id, name, email) => {
    const known = directory.get(String(id)) || {};
    const address = (email || known.email || "").toLowerCase() || null;
    return {
      id: String(id),
      name: name || known.name || "",
      email: address,
      kind: userKind({ email: address, orgRole: known.orgRole }, domains),
    };
  };
  const ownerId = board.owner?.id ?? board.createdBy?.id;
  const owner =
    ownerId != null
      ? person(ownerId, board.owner?.name || board.createdBy?.name)
      : null;
  const list = [];
  const seen = new Set();
  if (owner) {
    list.push({ ...owner, miroRole: "owner", role: "owner" });
    seen.add(owner.id);
  }
  for (const m of members) {
    if (m?.id == null || seen.has(String(m.id))) continue;
    seen.add(String(m.id));
    // The board owner field is authoritative; a second "owner" becomes a
    // facilitator so each migrated board has exactly one owner.
    const role = mapRole(m.role) === "owner" ? "facilitator" : mapRole(m.role);
    list.push({
      ...person(m.id, m.name, m.email),
      miroRole: m.role || "",
      role,
    });
  }
  const teamId = board.team?.id != null ? String(board.team.id) : null;
  const sharing = board.policy?.sharingPolicy || {};
  return {
    id: String(board.id),
    name: String(board.name || ""),
    // Boards in this app have no description, so Miro's is kept here and in
    // the migration log.
    description: String(board.description || ""),
    teamId,
    teamName: board.team?.name || (teamId && teams?.get(teamId)) || "",
    owner,
    ownerEmail: owner?.email || null,
    createdAt: board.createdAt || null,
    modifiedAt: board.modifiedAt || null,
    viewLink: board.viewLink || null,
    itemCount,
    sharing: {
      access: sharing.access || null,
      teamAccess: sharing.teamAccess || null,
      organizationAccess: sharing.organizationAccess || null,
      linkAccess: sharing.inviteToAccountAndBoardLinkAccess || null,
    },
    members: list,
    guests: list.filter((m) => m.kind === "guest").length,
    unresolved: list.filter((m) => !m.email).length,
    error: null,
  };
}

// Loads every board visible to the token with its members and item count.
// A failure on one board is recorded on its row instead of stopping the load.
export async function loadInventory(
  client,
  {
    orgId = "",
    domains = [],
    emailMap = {},
    signal,
    onProgress,
    concurrency = 4,
    counts = true,
    now = Date.now,
  } = {},
) {
  const boards = await client.listBoards({
    signal,
    onPage: (p) => onProgress?.({ stage: "boards", ...p }),
  });
  let orgMembers = { available: false, data: [] },
    teams = { available: false, data: [] };
  if (orgId) {
    onProgress?.({ stage: "organization" });
    orgMembers = await client.listOrgMembers(orgId, { signal });
    teams = await client.listOrgTeams(orgId, { signal });
  }
  const directory = userDirectory({ orgMembers: orgMembers.data, emailMap });
  const teamNames = new Map(teams.data.map((t) => [String(t.id), t.name]));
  const entries = new Array(boards.length);
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < boards.length) {
      const n = next++,
        b = boards[n];
      const context = { directory, domains, teams: teamNames };
      try {
        const members = await client.listMembers(b.id, { signal });
        // A count that cannot be read never costs the board its members.
        let itemCount = null;
        if (counts)
          try {
            itemCount = await client.countItems(b.id, { signal });
          } catch (error) {
            if (signal?.aborted) throw error;
          }
        entries[n] = boardEntry(b, members, { ...context, itemCount });
      } catch (error) {
        if (signal?.aborted) throw error;
        entries[n] = boardEntry(b, [], context);
        entries[n].error = error.message;
      }
      onProgress?.({ stage: "members", loaded: ++done, total: boards.length });
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, boards.length)) },
      worker,
    ),
  );
  return {
    version: 1,
    loadedAt: new Date(now()).toISOString(),
    orgId: orgId || null,
    org: { members: orgMembers.available, teams: teams.available },
    teams: teams.data.map((t) => ({ id: String(t.id), name: t.name || "" })),
    domains,
    boards: entries,
  };
}
export function summarizeInventory(inventory) {
  const people = new Map();
  for (const b of inventory.boards)
    for (const m of b.members) people.set(m.id, m);
  const all = [...people.values()];
  return {
    boards: inventory.boards.length,
    teams: new Set(inventory.boards.map((b) => b.teamId).filter(Boolean)).size,
    owners: new Set(inventory.boards.map((b) => b.owner?.id).filter(Boolean))
      .size,
    users: all.length,
    guests: all.filter((m) => m.kind === "guest").length,
    unresolved: all.filter((m) => !m.email).length,
    items: inventory.boards.reduce((n, b) => n + (b.itemCount || 0), 0),
    errors: inventory.boards.filter((b) => b.error).length,
  };
}

// Splits boards into phases by team, by owner, or by count. Each group is
// divided into batches of at most `size` boards so phases stay reviewable.
export function planPhases(boards, { by = "team", size = 50 } = {}) {
  size = Math.max(1, Math.min(1000, Math.floor(Number(size)) || 50));
  const groups = new Map();
  const sorted = [...boards].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  for (const b of sorted) {
    const [key, label] =
      by === "owner"
        ? [
            b.ownerEmail || b.owner?.id || "",
            b.ownerEmail || b.owner?.name || "",
          ]
        : by === "count"
          ? ["", ""]
          : [b.teamId || b.teamName || "", b.teamName || ""];
    if (!groups.has(key)) groups.set(key, { key, label, boards: [] });
    groups.get(key).boards.push(b.id);
  }
  const phases = [];
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (a.key === "") - (b.key === "") ||
      (a.label === "") - (b.label === "") ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
  for (const group of ordered) {
    const parts = Math.ceil(group.boards.length / size);
    for (let part = 0; part < parts; part++)
      phases.push({
        id: `phase-${phases.length + 1}`,
        index: phases.length + 1,
        by,
        key: group.key,
        label: group.label,
        part: part + 1,
        parts,
        boardIds: group.boards.slice(part * size, (part + 1) * size),
      });
  }
  return phases;
}

const iso = (now) => new Date(now()).toISOString();
export function createLog(now = Date.now) {
  const at = iso(now);
  return {
    version: 1,
    kind: "miro-migration-log",
    createdAt: at,
    updatedAt: at,
    entries: [],
    events: [],
  };
}
export function parseLog(value) {
  let log = value;
  try {
    if (typeof value === "string") log = JSON.parse(value);
  } catch {
    log = null;
  }
  if (
    !log ||
    log.kind !== "miro-migration-log" ||
    log.version !== 1 ||
    !Array.isArray(log.entries)
  )
    throw Error("The migration log could not be read.");
  const entries = log.entries.filter(
    (e) =>
      e && typeof e.miroBoardId === "string" && LOG_STATUSES.includes(e.status),
  );
  return {
    ...log,
    entries: entries.map((e) => ({
      ...e,
      previousBoardIds: Array.isArray(e.previousBoardIds)
        ? e.previousBoardIds.filter((id) => typeof id === "string")
        : [],
      partBoardIds: Array.isArray(e.partBoardIds)
        ? e.partBoardIds.filter((id) => typeof id === "string")
        : [],
    })),
    events: Array.isArray(log.events) ? log.events : [],
  };
}
export const logEntry = (log, miroBoardId) =>
  log.entries.find((e) => e.miroBoardId === String(miroBoardId));
function event(log, miroBoardId, action, detail, now) {
  log.events.push({ at: iso(now), miroBoardId, action, ...detail });
  if (log.events.length > EVENT_LIMIT)
    log.events.splice(0, log.events.length - EVENT_LIMIT);
}
// Adds pending rows for planned boards; existing rows keep their status.
export function ensureEntries(log, boards, phaseOf = () => "") {
  for (const b of boards) {
    const entry = logEntry(log, b.id);
    if (entry) {
      entry.name = b.name;
      if (b.description) entry.description = b.description;
      if (entry.status === "pending") entry.phase = phaseOf(b.id);
      continue;
    }
    log.entries.push({
      miroBoardId: b.id,
      name: b.name,
      phase: phaseOf(b.id),
      status: "pending",
      createdBoardId: null,
      // The other boards a board too large for one was migrated as.
      partBoardIds: [],
      previousBoardIds: [],
      ownerEmail: b.ownerEmail || null,
      team: b.teamName || "",
      members: b.members?.length || 0,
      guests: b.guests || 0,
      counts: null,
      warnings: [],
      error: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      asTemplate: false,
      viewLink: b.viewLink || null,
      description: b.description || "",
    });
  }
  return log;
}
export function updateEntry(log, board, patch, now = Date.now, action = "") {
  ensureEntries(log, [board]);
  const entry = logEntry(log, board.id);
  Object.assign(entry, patch);
  log.updatedAt = iso(now);
  if (action)
    event(
      log,
      entry.miroBoardId,
      action,
      {
        status: entry.status,
        ...(entry.createdBoardId ? { boardId: entry.createdBoardId } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      },
      now,
    );
  return entry;
}
export const shouldSkip = (log, miroBoardId, { force = false } = {}) =>
  !force && logEntry(log, miroBoardId)?.status === "migrated";
export function summarizeLog(log, boardIds) {
  const wanted = boardIds && new Set(boardIds.map(String));
  const summary = Object.fromEntries(LOG_STATUSES.map((s) => [s, 0]));
  for (const e of log.entries)
    if (!wanted || wanted.has(e.miroBoardId)) summary[e.status]++;
  return summary;
}
// Created boards to delete for a rollback, including copies left by forced
// re-migrations. Only migrated rows qualify.
function rollbackGroups(log, { boardIds, phase } = {}) {
  const wanted = boardIds && new Set(boardIds.map(String));
  return log.entries
    .filter(
      (e) =>
        e.status === "migrated" &&
        (!wanted || wanted.has(e.miroBoardId)) &&
        (phase == null || e.phase === phase),
    )
    .map((e) => ({
      entry: e,
      ids: [
        e.createdBoardId,
        ...(e.partBoardIds || []),
        ...(e.previousBoardIds || []),
      ].filter(Boolean),
    }))
    .filter((g) => g.ids.length);
}
export const rollbackTargets = (log, filter) =>
  rollbackGroups(log, filter).flatMap((g) => g.ids);

const warningsOf = (report) =>
  [
    ...report.errors,
    ...(report.notices || []),
    ...report.skipped,
    ...report.warnings,
  ]
    .slice(0, WARNING_LIMIT)
    .map((w) => w.message);

// Migrates boards one at a time. Each result is written to the log and the
// log is saved before the next board, so an interruption leaves an accurate
// record for rollback. Already migrated boards are skipped unless forced.
export async function runMigration({
  client,
  boards,
  log,
  createBoard,
  deleteBoard,
  saveLog = async () => {},
  sleep = abortableSleep,
  convert = convertMiroBoard,
  convertOptions = {},
  signal,
  onProgress,
  force = false,
  dryRun = false,
  asTemplate = false,
  phaseOf = () => "",
  fallbackOwnerEmail = "",
  users = {},
  now = Date.now,
}) {
  const results = [];
  // A failed save is tried again after a short wait, even while the run is
  // being stopped, since a board just created is tracked only by the log.
  const save = async () => {
    const json = JSON.stringify(log);
    for (let attempt = 1; ; attempt++) {
      try {
        return await saveLog(json);
      } catch {
        if (attempt === SAVE_ATTEMPTS)
          throw Object.assign(
            Error(
              "The migration log could not be saved. The run was stopped so no board is left untracked.",
            ),
            { fatal: true },
          );
        await sleep(SAVE_RETRY_MS * attempt);
      }
    }
  };
  if (!dryRun) ensureEntries(log, boards, phaseOf);
  for (const [index, b] of boards.entries()) {
    if (signal?.aborted) return { results, cancelled: true };
    const base = { miroBoardId: b.id, name: b.name };
    if (!dryRun && shouldSkip(log, b.id, { force })) {
      results.push({ ...base, status: "skipped" });
      onProgress?.({
        index: index + 1,
        total: boards.length,
        board: b,
        done: true,
      });
      continue;
    }
    onProgress?.({
      index: index + 1,
      total: boards.length,
      board: b,
      stage: "fetch",
    });
    const previous = logEntry(log, b.id);
    const startedAt = iso(now);
    let report = null;
    try {
      // Without its members, the board would be shared with its owner only
      // and everyone else would quietly lose access.
      if (b.error)
        throw Error(
          "The board's members could not be read from Miro. Load the boards again, then migrate it.",
        );
      const content = await client.fetchBoardContent(b.id, {
        signal,
        onProgress: (p) =>
          onProgress?.({
            index: index + 1,
            total: boards.length,
            board: b,
            ...p,
          }),
      });
      onProgress?.({
        index: index + 1,
        total: boards.length,
        board: b,
        stage: "convert",
      });
      const converted = await convert(content, {
        fetchImage: (url, o) => client.downloadImage(url, o),
        fetchFile: (url, o) => client.downloadResource(url, o),
        users,
        signal,
        ...convertOptions,
      });
      report = converted.report;
      if (dryRun) {
        results.push({
          ...base,
          status: converted.board ? "dry-run" : "failed",
          report,
          error: report.errors[0]?.message || null,
        });
        continue;
      }
      if (!converted.board)
        throw Object.assign(
          Error(report.errors[0]?.message || "Conversion failed."),
          {
            report,
          },
        );
      const ownerEmail = b.ownerEmail || fallbackOwnerEmail || null;
      const extra = [];
      if (!b.ownerEmail)
        extra.push(
          ownerEmail
            ? `Owner email unresolved; ownership assigned to ${ownerEmail}.`
            : "Owner email unresolved; assign an owner after migration.",
        );
      onProgress?.({
        index: index + 1,
        total: boards.length,
        board: b,
        stage: "save",
      });
      // A board too large for one is migrated as several, each with the
      // same owner and members. Should one fail, those already made are
      // removed, so nothing is left that the log does not know.
      const createdIds = [];
      try {
        for (const part of converted.boards || [converted.board]) {
          const created = await createBoard(part, {
            ownerEmail,
            members: b.members.map((m) => ({
              email: m.email,
              name: m.name,
              role: m.role,
              guest: m.kind === "guest",
              miroUserId: m.id,
              miroRole: m.miroRole,
            })),
            source: {
              provider: "miro",
              boardId: b.id,
              viewLink: b.viewLink,
              teamId: b.teamId,
              teamName: b.teamName,
              ownerId: b.owner?.id || null,
              sharing: b.sharing,
              modifiedAt: b.modifiedAt,
            },
            asTemplate,
            signal,
          });
          if (!created?.id) throw Error("The board could not be created.");
          extra.push(...(created.warnings || []));
          createdIds.push(String(created.id));
        }
      } catch (error) {
        const left = [];
        for (const id of createdIds)
          try {
            if (!deleteBoard) throw Error("no delete");
            await deleteBoard(id);
          } catch {
            left.push(id);
          }
        if (left.length)
          throw Object.assign(
            Error(
              `${error.message} Boards already created from it could not be removed: ${left.join(", ")}.`,
            ),
            { report },
          );
        throw error;
      }
      const [createdBoardId, ...partBoardIds] = createdIds;
      const before = { ...previous };
      const earlier =
        previous?.status === "migrated" && previous.createdBoardId
          ? [
              previous.createdBoardId,
              ...(previous.partBoardIds || []),
              ...(previous.previousBoardIds || []),
            ]
          : previous?.previousBoardIds || [];
      updateEntry(
        log,
        b,
        {
          status: "migrated",
          createdBoardId,
          partBoardIds,
          previousBoardIds: earlier,
          ownerEmail,
          counts: reportTotals(report),
          warnings: [...extra, ...warningsOf(report)].slice(0, WARNING_LIMIT),
          error: null,
          attempts: (previous?.attempts || 0) + 1,
          startedAt,
          finishedAt: iso(now),
          asTemplate,
          phase: phaseOf(b.id) || previous?.phase || "",
        },
        now,
        "migrated",
      );
      try {
        await save();
      } catch (error) {
        // The saved log does not know this board, so rollback could not find
        // it and migrating again would copy it twice. It is removed, or named
        // for the administrator when it cannot be.
        let removed = false;
        try {
          for (const id of createdIds) await deleteBoard?.(id);
          removed = !!deleteBoard;
        } catch {
          // Named below instead.
        }
        if (removed) {
          updateEntry(
            log,
            b,
            { ...before, error: error.message },
            now,
            "failed",
          );
          results.push({
            ...base,
            status: "failed",
            report,
            error: error.message,
          });
          throw error;
        }
        results.push({
          ...base,
          status: "migrated",
          createdBoardId,
          partBoardIds,
          report,
          warnings: extra,
        });
        throw Object.assign(
          Error(
            `The migration log could not be saved, so the run was stopped. The board copied from ${b.name} (${createdIds.join(", ")}) is not in the saved log; download the report to keep a record of it.`,
          ),
          { fatal: true },
        );
      }
      results.push({
        ...base,
        status: "migrated",
        createdBoardId,
        report,
        warnings: extra,
      });
    } catch (error) {
      if (error.fatal)
        return { results, cancelled: false, fatal: error.message };
      if (signal?.aborted) return { results, cancelled: true };
      if (dryRun) {
        results.push({
          ...base,
          status: "failed",
          report,
          error: error.message,
        });
        continue;
      }
      // A failed "Migrate again" leaves the earlier copy migrated, so it is
      // still tracked and can be rolled back; only the error is recorded.
      updateEntry(
        log,
        b,
        previous?.status === "migrated"
          ? {
              error: error.message,
              attempts: (previous.attempts || 0) + 1,
            }
          : {
              status: "failed",
              counts: report ? reportTotals(report) : null,
              warnings: report ? warningsOf(report) : [],
              error: error.message,
              attempts: (previous?.attempts || 0) + 1,
              startedAt,
              finishedAt: iso(now),
              phase: phaseOf(b.id) || previous?.phase || "",
            },
        now,
        "failed",
      );
      results.push({ ...base, status: "failed", report, error: error.message });
      try {
        await save();
      } catch (fatal) {
        return { results, cancelled: false, fatal: fatal.message };
      }
    }
  }
  return { results, cancelled: false };
}

// Deletes the boards created for the chosen Miro boards and marks them
// rolled back. A failed deletion leaves the row migrated so it can be retried.
export async function rollbackBoards({
  log,
  deleteBoard,
  saveLog = async () => {},
  boardIds,
  phase,
  signal,
  onProgress,
  now = Date.now,
}) {
  const groups = rollbackGroups(log, { boardIds, phase });
  const results = [];
  for (const [index, { entry, ids }] of groups.entries()) {
    if (signal?.aborted) return { results, cancelled: true };
    onProgress?.({ index: index + 1, total: groups.length, entry });
    const deleted = [];
    try {
      for (const id of ids) {
        await deleteBoard(id);
        deleted.push(id);
      }
      updateEntry(
        log,
        { id: entry.miroBoardId, name: entry.name },
        {
          status: "rolled-back",
          partBoardIds: [],
          previousBoardIds: [],
          error: null,
        },
        now,
        "rolled-back",
      );
      results.push({
        miroBoardId: entry.miroBoardId,
        name: entry.name,
        status: "rolled-back",
        deleted,
      });
    } catch (error) {
      // Keep only the boards that still exist so a retry does not repeat work.
      const remaining = ids.filter((id) => !deleted.includes(id));
      updateEntry(
        log,
        { id: entry.miroBoardId, name: entry.name },
        {
          createdBoardId: remaining[0] || null,
          partBoardIds: [],
          previousBoardIds: remaining.slice(1),
          error: `Rollback failed: ${error.message}`,
        },
        now,
        "rollback-failed",
      );
      results.push({
        miroBoardId: entry.miroBoardId,
        name: entry.name,
        status: "failed",
        deleted,
        error: error.message,
      });
    }
    try {
      await saveLog(JSON.stringify(log));
    } catch {
      return {
        results,
        cancelled: false,
        fatal:
          "The migration log could not be saved. The rollback was stopped so no board is left untracked.",
      };
    }
  }
  return { results, cancelled: false };
}

// RFC 4180 cells. Leading formula characters are neutralized so a report
// opened in a spreadsheet cannot run formulas from board names.
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // Semicolons split cells where Excel uses them as the list separator.
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function toCSV(columns, rows) {
  return `\ufeff${[
    columns.map(([name]) => csvCell(name)).join(","),
    ...rows.map((row) => columns.map(([, get]) => csvCell(get(row))).join(",")),
  ].join("\r\n")}\r\n`;
}
const LOG_COLUMNS = [
  ["miro_board_id", (e) => e.miroBoardId],
  ["board_name", (e) => e.name],
  ["phase", (e) => e.phase],
  ["status", (e) => e.status],
  ["created_board_id", (e) => e.createdBoardId],
  ["owner_email", (e) => e.ownerEmail],
  ["team", (e) => e.team],
  ["members", (e) => e.members],
  ["guests", (e) => e.guests],
  ["source_objects", (e) => e.counts?.source],
  ["converted_objects", (e) => e.counts?.converted],
  ["skipped_objects", (e) => e.counts?.skipped],
  ["warning_count", (e) => e.counts?.warnings],
  ["warnings", (e) => (e.warnings || []).join(" | ")],
  ["error", (e) => e.error],
  ["attempts", (e) => e.attempts],
  ["started_at", (e) => e.startedAt],
  ["finished_at", (e) => e.finishedAt],
  ["template", (e) => (e.asTemplate ? "yes" : "no")],
  ["miro_link", (e) => e.viewLink],
  ["miro_description", (e) => e.description],
  // Last, so the columns before keep their places in existing reports.
  ["part_board_ids", (e) => (e.partBoardIds || []).join(" ")],
];
export const logToCSV = (log) => toCSV(LOG_COLUMNS, log.entries);
export const logToJSON = (log) => JSON.stringify(log, null, 2);
const INVENTORY_COLUMNS = [
  ["miro_board_id", (b) => b.id],
  ["board_name", (b) => b.name],
  ["team", (b) => b.teamName],
  ["owner_name", (b) => b.owner?.name],
  ["owner_email", (b) => b.ownerEmail],
  ["members", (b) => b.members.length],
  ["guests", (b) => b.guests],
  ["unresolved_emails", (b) => b.unresolved],
  ["items", (b) => b.itemCount],
  ["modified_at", (b) => b.modifiedAt],
  ["sharing", (b) => b.sharing?.access],
  ["description", (b) => b.description],
  [
    "member_roles",
    (b) =>
      b.members
        .map(
          (m) =>
            `${m.email || m.name || m.id}:${m.role}${m.kind === "guest" ? ":guest" : ""}`,
        )
        .join(" | "),
  ],
  ["error", (b) => b.error],
];
export const inventoryToCSV = (inventory) =>
  toCSV(INVENTORY_COLUMNS, inventory.boards);
