import { forgetRecords } from "../worker/service.js";
import { hash } from "../src/collaboration/protocol.js";
import { validateBoard } from "../src/model.js";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";
import {
  appendRun,
  sliceTextRuns,
  validateTextRuns,
} from "../src/rich-text.js";
import {
  BOARD_ROLES,
  DAY,
  ORG_ROLES,
  SECRETS,
  administers,
  emailDomain,
  fail,
  mergePolicy,
  normalizePolicy,
  publicHost,
  validEmail,
} from "../worker/org.js";
import { computeReports } from "../worker/reports.js";
import {
  bilingualBody,
  bilingualSubject,
  hookMatches,
  mail,
  sendHook,
  siem,
} from "../worker/delivery.js";

const text = (value, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function libraryDescription(input) {
  const raw = typeof input.description === "string" ? input.description : "",
    lang = canonicalLanguage(input.descriptionLang);
  try {
    if (input.descriptionLang !== undefined && !lang) throw Error();
    validateTextRuns(raw, input.descriptionRuns);
    if (
      input.descriptionRuns?.some((run) =>
        Object.keys(run.style).some((key) => key !== "lang"),
      )
    )
      throw Error();
  } catch {
    fail(400, "Invalid library description language.");
  }
  const start = raw.length - raw.trimStart().length;
  let end = start + Math.min(raw.trim().length, 500);
  if (
    /[\uD800-\uDBFF]/.test(raw[end - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(raw[end] || "")
  )
    end--;
  const description = raw.slice(start, end),
    runs = [];
  for (const run of sliceTextRuns(input.descriptionRuns, start, end)) {
    const tag = canonicalLanguage(run.style.lang);
    if (tag) appendRun(runs, run.start, run.end, { lang: tag });
  }
  return {
    description,
    ...(description && lang ? { descriptionLang: lang } : {}),
    ...(runs.length ? { descriptionRuns: runs } : {}),
  };
}
function feedbackComment(input) {
  const raw = typeof input.comment === "string" ? input.comment : "",
    lang = canonicalLanguage(input.lang);
  try {
    if (input.lang !== undefined && !lang) throw Error();
    validateTextRuns(raw, input.textRuns);
    if (
      input.textRuns?.some((run) =>
        Object.keys(run.style).some((key) => key !== "lang"),
      )
    )
      throw Error();
  } catch {
    fail(400, "Invalid feedback language.");
  }
  const start = raw.length - raw.trimStart().length;
  let end = start + Math.min(raw.trim().length, 1000);
  if (
    /[\uD800-\uDBFF]/.test(raw[end - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(raw[end] || "")
  )
    end--;
  const comment = raw.slice(start, end),
    runs = [];
  for (const run of sliceTextRuns(input.textRuns, start, end)) {
    const tag = canonicalLanguage(run.style.lang);
    if (tag) appendRun(runs, run.start, run.end, { lang: tag });
  }
  return {
    comment,
    ...(comment && lang ? { lang } : {}),
    ...(runs.length ? { textRuns: runs } : {}),
  };
}
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const id = (value) => {
  if (typeof value !== "string" || !ID.test(value))
    fail(400, "Invalid identifier.");
  return value;
};
const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const short = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const publicUser = (u) => ({
  uuid: u.uuid,
  username: u.username || null,
  email: u.email || null,
  emailVerified: !!u.emailVerified,
  role: u.role,
  status: u.status,
  license: u.license || (u.role === "guest" ? "guest" : "full"),
  teams: u.teams || [],
  created: u.created || null,
  lastActive: u.lastActive || null,
  source: u.source || null,
  externalId: u.externalId || null,
});
export const API_SCOPES = [
  "scim",
  "users:read",
  "users:write",
  "boards:read",
  "boards:write",
  "audit:read",
  "reports:read",
  "webhooks:write",
];
export const WEBHOOK_EVENTS = [
  "*",
  "board",
  "board.created",
  "board.deleted",
  "board.archived",
  "board.transfer",
  "board.visibility",
  "board.role",
  "board.guest",
  "board.comment",
  "board.content",
  "user",
  "user.joined",
  "user.role",
  "user.deactivated",
  "team",
  "scim",
  "scim.user",
  "scim.group",
  "policy",
  "apikey",
  "vote",
];

// Link a verified email to an account. SCIM may already have provisioned a
// pending record for that address; the account then inherits its role,
// teams, and status, and keeps the SCIM identifier the IdP knows.
export async function linkEmail(org, identity, email) {
  email = email.toLowerCase();
  const emailKey = "org:email:" + (await hash(email));
  const linked = await org.kv.get(emailKey);
  let user = await org.freshUser(identity.uuid);
  if (linked && linked !== identity.uuid) {
    const other = await org.freshUser(linked);
    if (other && other.status !== "pending")
      fail(409, "This email address is already linked to another account.");
    if (other) {
      // Linking never lifts a deactivation or lowers an existing role.
      const rank = ["guest", "member", "admin"];
      const role =
        user && rank.indexOf(user.role) > rank.indexOf(other.role)
          ? user.role
          : other.role;
      user = {
        ...other,
        ...(user || {}),
        uuid: identity.uuid,
        username: identity.username,
        role,
        // The license follows the role, so a guest who becomes a member
        // is no longer counted or shown as a guest.
        license: role === "guest" ? "guest" : "full",
        teams: [...new Set([...(user?.teams || []), ...(other.teams || [])])],
        status:
          user?.status === "deactivated" ||
          (other.active === false &&
            (user?.role !== "admin" || other.inactiveByOwner))
            ? "deactivated"
            : "active",
        scimId: other.scimId,
        externalId: other.externalId,
        source: "scim",
      };
      delete user.active;
      delete user.inactiveByOwner;
      await org.kv.del("org:user:" + other.uuid);
      org.forgetUser(other.uuid);
      await movePendingMemberships(org, other.uuid, identity);
      if (other.scimId)
        await org.kv.set("org:scimid:" + other.scimId, user.uuid);
      for (const teamId of user.teams) {
        const team = await org.kv.get("org:team:" + teamId);
        if (team) {
          team.members = [
            ...new Set(
              team.members.map((m) => (m === other.uuid ? user.uuid : m)),
            ),
          ];
          await org.kv.set("org:team:" + teamId, team);
        }
      }
    }
  }
  if (user) {
    const previous = user.email?.toLowerCase();
    user.email = email;
    user.emailVerified = true;
    await org.saveUser(user);
    // The address this account used before is free for its next owner.
    if (previous && previous !== email) {
      const key = "org:email:" + (await hash(previous));
      if ((await org.kv.get(key)) === user.uuid) await org.kv.del(key);
    }
  }
  return user;
}
// Record a team's membership change on the people who joined or left it.
export async function syncTeamMembers(org, teamId, before, after) {
  const prior = new Set(before),
    next = new Set(after);
  for (const uuid of new Set([...prior, ...next])) {
    if (prior.has(uuid) === next.has(uuid)) continue;
    const user = await org.freshUser(uuid);
    if (!user) continue;
    const teams = new Set(user.teams || []);
    if (next.has(uuid)) teams.add(teamId);
    else teams.delete(teamId);
    user.teams = [...teams];
    await org.saveUser(user);
  }
}
// Board access granted to a provisioned or migrated address before its owner
// signed in moves to their account once they verify that address.
async function movePendingMemberships(org, pending, identity) {
  for (const row of await org.list(`org:ub:${pending}:`)) {
    const room = row.key.split(":").at(-1);
    const record = await org.kv.get(`wb:${room}:member:${pending}`);
    if (record) {
      // Access the account already has wins when it is higher, and a board
      // manager's removal stands unless the address owns the board.
      const existing = await org.kv.get(`wb:${room}:member:${identity.uuid}`);
      const keep =
        existing &&
        (existing.role === "removed"
          ? record.role !== "owner"
          : BOARD_ROLES.indexOf(existing.role) <=
            BOARD_ROLES.indexOf(record.role));
      if (!keep)
        await org.kv.set(`wb:${room}:member:${identity.uuid}`, {
          ...record,
          uuid: identity.uuid,
          username: identity.username,
        });
      await org.kv.del(`wb:${room}:member:${pending}`);
      await org.indexMembership(pending, room, null);
      await org.indexMembership(
        identity.uuid,
        room,
        keep ? existing.role : record.role,
      );
    }
    await org.kv.del(row.key);
    forgetRecords(`wb:${room}:`);
    const meta = await org.kv.get(`wb:${room}:meta`);
    if (meta?.owner === pending) {
      await org.kv.set(
        `wb:${room}:meta`,
        { ...meta, owner: identity.uuid },
        { disableSharing: true },
      );
      await org.registerBoard(room, {
        owner: identity.uuid,
        ownerName: identity.username,
      });
    }
  }
}
// Find the account for an address, or create a pending one that becomes a
// real account when someone verifies that address.
export async function accountForEmail(org, email, { name, guest, source }) {
  email = email.toLowerCase();
  const linked = await org.kv.get("org:email:" + (await hash(email)));
  const existing = linked && (await org.user(linked));
  if (existing) return existing;
  const uuid = "pending-" + (await hash(email)).slice(0, 24);
  const user = {
    uuid,
    scimId: uuid,
    email,
    emailVerified: false,
    displayName: typeof name === "string" ? name.slice(0, 200) : undefined,
    role: guest ? "guest" : "member",
    status: "pending",
    active: true,
    created: org.now(),
    source,
    teams: [],
  };
  await org.saveUser(user);
  await org.kv.set("org:scimid:" + uuid, uuid);
  return user;
}
// Verifying an email creates an organization record, so it is open only to
// people the organization already knows: the owner, existing members and
// board guests, addresses provisioned for them, and its own domains.
async function requireVerifiable(org, identity, email) {
  if (await org.user(identity.uuid)) return;
  if ((await org.accountOwner()).uuid === identity.uuid) return;
  const linked = await org.kv.get("org:email:" + (await hash(email)));
  if (linked && (await org.user(linked))?.status === "pending") return;
  const policy = await org.policy();
  if (policy.domainCapture && policy.domains.includes(emailDomain(email)))
    return;
  fail(
    403,
    "Use an email address in your organization's domain, or ask an administrator for an invitation.",
  );
}
async function joinOrganization(org, identity, input) {
  const existing = await org.freshUser(identity.uuid);
  const invite = input.token
    ? await org.kv.get("org:invite:" + (await hash(String(input.token))))
    : null;
  // Members stay as they are, except that an administrator invitation,
  // which only the owner creates, makes a member an administrator. An
  // invitation made before the person's role last changed never undoes
  // that change.
  const outdated =
    !!existing?.roleChanged && !(invite?.created > existing.roleChanged);
  if (
    existing?.status === "active" &&
    (outdated ||
      (existing.role !== "guest" &&
        !(invite?.role === "admin" && existing.role === "member")))
  )
    return existing;
  if (existing?.status === "deactivated")
    fail(403, "Your organization account is deactivated.");
  const policy = await org.policy();
  let role = null,
    source = null;
  if (input.token) {
    // Like an API key, an invitation ends with its maker's administration.
    if (
      !invite ||
      invite.revoked ||
      invite.expires < org.now() ||
      (invite.createdBy && !(await administers(org, invite.createdBy)))
    )
      fail(403, "This organization invitation has expired or was revoked.");
    // Member and guest links can be shared with a team; an administrator
    // link makes one person an administrator.
    if (
      invite.role === "admin" &&
      invite.usedBy &&
      invite.usedBy !== identity.uuid
    )
      fail(403, "This administrator invitation was already used.");
    role = invite.role;
    source = "invite";
  } else if (
    existing?.emailVerified &&
    policy.domainCapture &&
    policy.domains.includes(emailDomain(existing.email))
  ) {
    role = "member";
    source = "domain";
  }
  if (!role)
    fail(
      403,
      "Verify an email address in your organization's domain, or ask an administrator for an invitation.",
    );
  // Two people joining with the same administrator link at once would both
  // pass the check above, so the first to claim it atomically keeps it.
  if (invite?.role === "admin" && source === "invite" && !invite.usedBy) {
    const claim = "org:inviteclaim:" + (await hash(String(input.token)));
    if ((await org.kv.incr(claim)) === 1)
      await org.kv.set(claim + ":by", identity.uuid);
    else if ((await org.kv.get(claim + ":by")) !== identity.uuid)
      fail(403, "This administrator invitation was already used.");
  }
  const user = {
    ...(existing || {}),
    uuid: identity.uuid,
    username: identity.username,
    role,
    status: "active",
    license: role === "guest" ? "guest" : "full",
    created: existing?.created || org.now(),
    source,
    teams: existing?.teams || [],
  };
  await org.saveUser(user);
  if (invite?.role === "admin" && source === "invite" && !invite.usedBy)
    await org.kv.set("org:invite:" + (await hash(String(input.token))), {
      ...invite,
      usedBy: identity.uuid,
      used: org.now(),
    });
  const promoted =
    existing?.status === "active" &&
    existing.role === "member" &&
    role === "admin";
  await org.audit(
    identity,
    promoted ? "user.role.changed" : "user.joined",
    {
      type: "user",
      id: user.uuid,
      name: user.username,
    },
    promoted ? { from: existing.role, to: role, source } : { role, source },
  );
  return user;
}
// Read one record per board, 25 at a time.
async function perBoard(org, prefix, rooms) {
  const rows = [];
  const list = [...rooms];
  for (let n = 0; n < list.length; n += 25)
    rows.push(
      ...(await Promise.all(
        list.slice(n, n + 25).map((room) => org.kv.get(prefix + room)),
      )),
    );
  return rows;
}
// Returns the boards and, when the directory was listed, its size.
async function boardRows(org, rooms, directory) {
  // When the boards are much of the directory, listing it in pages of 200
  // takes far fewer storage requests than reading each board. A person's
  // own boards are usually a small part of it.
  if (directory && rooms.size > 50) {
    const all = (await org.list("org:board:")).map((r) => r.value);
    return {
      rows: all.filter((b) => b && rooms.has(b.room)),
      total: all.length,
    };
  }
  return {
    rows: (await perBoard(org, "org:board:", rooms)).filter(Boolean),
    total: null,
  };
}
export function filterBoards(rows, filters = {}, now = Date.now()) {
  const q = text(filters.query, 200).toLowerCase();
  const after = (v) => (v ? Date.parse(v) : null);
  const createdAfter = after(filters.createdAfter),
    createdBefore = after(filters.createdBefore),
    updatedAfter = after(filters.updatedAfter),
    updatedBefore = after(filters.updatedBefore);
  let out = rows.filter((b) => {
    if (!filters.deleted && b.deleted) return false;
    if (filters.deleted && !b.deleted) return false;
    if (filters.archived === false && b.archived) return false;
    if (filters.archived === true && !b.archived) return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.team && b.team !== filters.team) return false;
    if (filters.space && b.space !== filters.space) return false;
    if (
      filters.visibility &&
      (b.visibility || "private") !== filters.visibility
    )
      return false;
    if (createdAfter && !(b.created >= createdAfter)) return false;
    if (createdBefore && !(b.created <= createdBefore)) return false;
    const updated = b.lastActivity || b.updated || b.created;
    if (updatedAfter && !(updated >= updatedAfter)) return false;
    if (updatedBefore && !(updated <= updatedBefore)) return false;
    if (filters.activity === "active" && !(updated > now - 30 * DAY))
      return false;
    if (filters.activity === "stale" && !(updated < now - 90 * DAY))
      return false;
    if (filters.activity === "unused" && b.objectCount) return false;
    if (filters.type && !(b.types?.[filters.type] > 0)) return false;
    if (filters.guests && !(b.guestCount > 0)) return false;
    if (q) {
      const hay = [b.title, b.ownerName, b.team, b.space, b.text]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
  const sort = filters.sort || "updated";
  out.sort((a, b) =>
    sort === "title"
      ? String(a.title).localeCompare(String(b.title))
      : sort === "created"
        ? b.created - a.created
        : sort === "size"
          ? (b.objectCount || 0) - (a.objectCount || 0)
          : (b.lastActivity || b.updated || b.created) -
            (a.lastActivity || a.updated || a.created),
  );
  return out;
}
async function auditQuery(org, input) {
  const limit = Math.max(1, Math.min(500, Number(input.limit) || 100));
  const now = org.now();
  const to = input.to ? Date.parse(input.to) : now;
  let from = input.from ? Date.parse(input.from) : now - 30 * DAY;
  if (!Number.isFinite(to) || !Number.isFinite(from))
    fail(400, "Invalid date range.");
  // Days before the oldest record hold nothing; skip them instead of reading
  // one empty day at a time.
  const [oldest] = await org.list("org:audit:", { values: false, limit: 1 });
  if (!oldest) return { entries: [], cursor: null };
  const first = Date.parse(
    (oldest.key ?? oldest).slice("org:audit:".length).slice(0, 10),
  );
  if (Number.isFinite(first)) from = Math.max(from, first);
  const cursor = typeof input.cursor === "string" ? input.cursor : null;
  const entries = [];
  let last = null;
  const visit = ({ value }) => {
    if (cursor && value.id >= cursor) return false;
    if (value.at > to || value.at < from) return false;
    if (input.action && !value.action.startsWith(input.action)) return false;
    if (input.category && value.category !== input.category) return false;
    if (input.actor && value.actor?.uuid !== input.actor) return false;
    if (input.board && value.board !== input.board) return false;
    entries.push(value);
    last = value.id;
    return entries.length >= limit;
  };
  const day = (at) => new Date(at).toISOString().slice(0, 10);
  // A later page starts where the previous one stopped, reading that day
  // hour by hour, instead of skipping every newer record again.
  const resume = cursor ? Date.parse(cursor.slice(0, 24)) : NaN;
  const top = Number.isFinite(resume)
    ? Math.min(to, now, resume)
    : Math.min(to, now);
  const floor = Date.parse(day(from));
  let at = Date.parse(day(top));
  if (at >= floor && Number.isFinite(resume) && resume <= Math.min(to, now)) {
    for (let hour = new Date(top).getUTCHours(); hour >= 0; hour--) {
      const part = `${day(top)}T${String(hour).padStart(2, "0")}`;
      await org.scan("org:audit:" + part, { reverse: true }, visit);
      if (entries.length >= limit) break;
    }
    at -= DAY;
  }
  for (; at >= floor && entries.length < limit; at -= DAY)
    await org.scan("org:audit:" + day(at), { reverse: true }, visit);
  return { entries, cursor: entries.length >= limit ? last : null };
}
async function listKeys(org) {
  const used = new Map(
    (await org.list("org:apikeyused:")).map(({ key, value }) => [
      key.slice("org:apikeyused:".length),
      value,
    ]),
  );
  return (await org.list("org:apikey:")).map(({ key, value }) => {
    const hash = key.slice("org:apikey:".length);
    return {
      ...value,
      lastUsed: Math.max(value.lastUsed || 0, used.get(hash) || 0) || null,
      hash,
    };
  });
}
// Authenticate a REST or SCIM request's bearer API key.
export async function apiKey(org, bearer, scope) {
  if (typeof bearer !== "string" || !/^wbk_[a-f0-9]{64}$/.test(bearer))
    fail(401, "A valid API key is required.");
  const key = "org:apikey:" + (await hash(bearer));
  const record = await org.kv.get(key);
  if (
    !record ||
    record.revoked ||
    (record.expires && record.expires < org.now())
  )
    fail(401, "This API key is invalid, expired, or revoked.");
  // A key stops working once the person who made it no longer administers
  // the organization, as when an administrator is deactivated or demoted.
  if (record.createdBy && !(await administers(org, record.createdBy)))
    fail(401, "This API key is invalid, expired, or revoked.");
  if (scope && !record.scopes.includes(scope))
    fail(403, `This API key does not have the ${scope} scope.`);
  // Use is recorded apart from the key itself, so a request that finishes
  // after the key is revoked cannot write the key back.
  const digest = key.slice("org:apikey:".length),
    used = org.instance.touched,
    last = used.get("apikey:" + digest);
  if (!last || org.now() - last > 3600_000) {
    used.set("apikey:" + digest, org.now());
    await org.kv.set("org:apikeyused:" + digest, org.now());
  }
  return {
    uuid: `apikey-${record.id}`,
    username: `API key: ${record.name}`,
    apiKey: true,
    scopes: record.scopes,
    createdBy: record.createdBy,
  };
}
async function aiRequest(org, identity, input) {
  const policy = await org.policy();
  const task = input.task;
  const feature = {
    summarize: "summaries",
    cluster: "clustering",
    handwriting: "handwriting",
    generate: "summaries",
    describe: "summaries",
  }[task];
  if (!feature) fail(400, "Unknown AI task.");
  if (!policy.ai.enabled || !policy.ai[feature])
    fail(403, "Your organization has turned off this AI feature.");
  // The organization pays for its AI, so guests, including anyone who
  // opened a public link, use their own Puter AI instead.
  const role = await org.role(identity);
  if (!role || role === "guest")
    fail(403, "AI features are available to organization members.");
  const prompt = text(input.prompt, 60_000);
  if (!prompt) fail(400, "Nothing to send to AI.");
  const options = {
    normalize: true,
    ...(policy.ai.model ? { model: policy.ai.model } : {}),
  };
  let path = null,
    response;
  try {
    if (task === "handwriting" || task === "describe") {
      const image = input.image;
      if (
        typeof image !== "string" ||
        image.length > 12_000_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
      )
        fail(400, "Choose a PNG, JPEG, or WebP photo.");
      const [, type, data] = /^data:image\/(\w+);base64,(.*)$/.exec(image);
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      path = `whiteboard/ai/${short()}.${type === "jpeg" ? "jpg" : type}`;
      await org.puter.fs.write(
        path,
        new Blob([bytes], { type: `image/${type}` }),
        {
          createMissingParents: true,
          overwrite: true,
        },
      );
      response = await org.puter.ai.chat(
        [
          {
            role: "user",
            content: [
              { type: "file", puter_path: path },
              { type: "text", text: prompt },
            ],
          },
        ],
        false,
        options,
      );
    } else response = await org.puter.ai.chat(prompt, false, options);
  } finally {
    if (path) org.puter.fs.delete(path).catch(() => {});
  }
  const content = response?.message?.content;
  const output =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c) => c.text || "").join("")
        : String(response?.text || response || "");
  await org.audit(
    identity,
    "ai.used",
    {
      type: "board",
      id:
        typeof input.room === "string" && ID.test(input.room)
          ? input.room
          : null,
    },
    {
      task,
    },
  );
  return { text: output.slice(0, 100_000) };
}
function jiraSummary(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  let end = Math.min(250, title.length);
  const previous = title.charCodeAt(end - 1), next = title.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return title.slice(0, end);
}

async function jira(org, identity, input, boards) {
  const policy = await org.policy();
  const config = policy.integrations.jira;
  if (!config.enabled || !config.site || !config.email || !config.project)
    fail(403, "Jira is not set up for your organization.");
  const secret = await org.secret("jira");
  if (!secret) fail(403, "Jira is not set up for your organization.");
  // The connection reads and creates issues with the organization's
  // credentials, so board guests from outside it cannot use it.
  const role = await org.role(identity);
  if (!role || role === "guest")
    fail(403, "Jira sync is available to organization members.");
  const room = id(input.room);
  await boards.member(room, identity, true);
  const auth = "Basic " + btoa(`${config.email}:${secret}`);
  const base = `https://${config.site}`;
  if (input.op === "org.jira.status") {
    const keys = (Array.isArray(input.keys) ? input.keys : [])
      .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k))
      .slice(0, 100);
    if (!keys.length) return { issues: [] };
    if (!/^[A-Z][A-Z0-9_]+$/.test(config.project))
      fail(403, "Jira is not set up for your organization.");
    // Board editors can read only the organization's project, not every
    // issue the integration account can see.
    const jql = `project = "${config.project}" AND key in (${keys.join(",")})`;
    // Jira answers in pages; every page is read.
    const found = [];
    let token = null;
    do {
      const query = new URLSearchParams({
        jql,
        fields: "status,assignee,duedate,summary",
        maxResults: "100",
        ...(token ? { nextPageToken: token } : {}),
      });
      const res = await org.fetcher(`${base}/rest/api/3/search/jql?${query}`, {
        headers: { Authorization: auth, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) fail(502, "Jira did not accept the request.");
      const data = await res.json();
      found.push(...(data.issues || []));
      token = data.nextPageToken || null;
    } while (token && found.length < keys.length);
    return {
      issues: found.map((i) => ({
        key: i.key,
        summary: i.fields?.summary || "",
        status: i.fields?.status?.name || "",
        category: i.fields?.status?.statusCategory?.key || "",
        assignee: i.fields?.assignee?.displayName || "",
        due: i.fields?.duedate || "",
        url: `${base}/browse/${i.key}`,
      })),
    };
  }
  const issues = (Array.isArray(input.issues) ? input.issues : []).slice(0, 50);
  if (!issues.length) fail(400, "Select items to send to Jira.");
  const created = [];
  // Each issue is created on its own, so one that fails, or a slow Jira,
  // never loses the ones already created; the rest wait for another send.
  const started = Date.now();
  for (const issue of issues) {
    if (Date.now() - started > 25_000) {
      created.push({
        item: issue.item || null,
        error: "Jira took too long. Send to Jira again to create the rest.",
      });
      continue;
    }
    // Two people sending the same task at once make one issue: the first
    // request claims it, and the other gets that issue back.
    const item =
      typeof issue.item === "string" && /^[\w-]{1,100}$/.test(issue.item)
        ? issue.item
        : null;
    const madeKey = item && `wb:${room}:jira:${item}`;
    if (madeKey) {
      let made = await org.kv.get(madeKey);
      if (!made && (await org.kv.incr(madeKey + ":claim")) !== 1)
        for (let n = 0; n < 20 && !made; n++) {
          await new Promise((r) => setTimeout(r, 250));
          made = await org.kv.get(madeKey);
        }
      else await org.kv.expire(madeKey + ":claim", 60).catch(() => {});
      if (made?.key) {
        created.push({
          item,
          key: made.key,
          url: `${base}/browse/${made.key}`,
        });
        continue;
      }
    }
    const summary = jiraSummary(issue.summary) || "Whiteboard item";
    const description = text(issue.description, 20000);
    let res;
    try {
      res = await org.fetcher(`${base}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: auth,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: config.project },
            summary,
            issuetype: { name: text(issue.type, 50) || "Task" },
            ...(description
              ? {
                  description: {
                    type: "doc",
                    version: 1,
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: description }],
                      },
                    ],
                  },
                }
              : {}),
            ...(/^\d{4}-\d{2}-\d{2}$/.test(issue.due || "")
              ? { duedate: issue.due }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      created.push({
        item: issue.item || null,
        error: "Could not reach Jira.",
      });
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      created.push({
        item: issue.item || null,
        error: "Jira did not accept the request.",
        status: res.status,
      });
    else if (typeof data.key !== "string" || !data.key)
      created.push({
        item: issue.item || null,
        error: "Jira did not accept the request.",
      });
    else {
      if (madeKey)
        await org.kv.set(
          madeKey,
          { key: data.key },
          Math.floor((org.now() + 10 * 60_000) / 1000),
        );
      created.push({
        item: issue.item || null,
        key: data.key,
        url: `${base}/browse/${data.key}`,
      });
    }
  }
  await org.audit(
    identity,
    "board.content.jira",
    { type: "board", id: room },
    {
      created: created.filter((c) => c.key).length,
    },
  );
  return { created };
}

export async function adminCall(org, boards, identity, input) {
  const op = input.op;
  const admin = () => org.requireAdmin(identity);
  // Organization directory data is for members, not guests or strangers.
  const member = async () => {
    const role = await org.role(identity);
    if (!role || role === "guest")
      fail(403, "Only organization members can do this.");
    return role;
  };
  if (op === "org.info") return org.info(identity);
  // A deactivated account keeps only what it needs to see its status and
  // verify an address; linking an address never lifts the deactivation.
  if (
    !["email.start", "email.confirm"].includes(op) &&
    !(await org.active(identity))
  )
    fail(403, "Your organization account is deactivated.");
  if (op === "org.setup") {
    const owner = await org.accountOwner();
    if (identity.uuid !== owner.uuid)
      fail(403, "Only the account owner can set up the organization.");
    let meta = await org.kv.get("org:meta");
    if (!meta) {
      const policy = mergePolicy(normalizePolicy(), {
        name: input.name,
        domains: input.domains || [],
      });
      meta = { created: org.now(), owner: owner.uuid, policy };
      // Register earlier boards first: the backfill skips boards already
      // registered, so an interrupted setup resumes where it stopped.
      await boards.backfillRegistry();
      await org.kv.set("org:meta", meta);
      org.forgetPolicy();
      await org.audit(identity, "org.created", {
        type: "organization",
        name: policy.name,
      });
    }
    return org.info(identity);
  }
  if (op === "org.join") {
    const user = await joinOrganization(org, identity, input);
    return { user: publicUser(user), info: await org.info(identity) };
  }
  if (op === "email.start") {
    const email = text(input.email, 254).toLowerCase();
    if (!validEmail(email)) fail(400, "Enter a valid email address.");
    await requireVerifiable(org, identity, email);
    const key = "org:verify:" + identity.uuid;
    const prior = await org.kv.get(key);
    const window = prior && prior.window > org.now() - 3600_000 ? prior : null;
    if (window && window.sent >= 5)
      fail(429, "Too many verification emails. Try again in an hour.");
    // Parallel requests all read the same count above, so each hour's
    // sends are also counted atomically.
    const hour = `org:verify-sent:${identity.uuid}:${Math.floor(org.now() / 3600_000)}`;
    const sends = await org.kv.incr(hour);
    if (sends === 1) await org.kv.expire(hour, 7200).catch(() => {});
    if (sends > 5)
      fail(429, "Too many verification emails. Try again in an hour.");
    const code = String(
      crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
    ).padStart(6, "0");
    await org.kv.del("org:verify-tries:" + identity.uuid);
    await org.kv.set(
      key,
      {
        email,
        code: await hash(`${identity.uuid}:${code}`),
        expires: org.now() + 15 * 60_000,
        window: window?.window || org.now(),
        sent: (window?.sent || 0) + 1,
      },
      { disableSharing: true },
    );
    try {
      await mail(
        org,
        email,
        bilingualSubject(
          "Your Whiteboard verification code",
          "Votre code de vérification Whiteboard",
        ),
        bilingualBody(
          `Your verification code is ${code}. It expires in 15 minutes.\n\nIf you did not request this, ignore this message.`,
          `Votre code de vérification est ${code}. Il expire dans 15 minutes.\n\nSi vous n’avez pas fait cette demande, ignorez ce message.`,
        ),
      );
    } catch (error) {
      fail(
        502,
        "The verification email could not be sent. Ask your administrator to check the organization's Puter plan.",
      );
    }
    await org.audit(
      identity,
      "email.verification.sent",
      { type: "user", id: identity.uuid },
      {
        domain: emailDomain(email),
      },
    );
    return { sent: true };
  }
  if (op === "email.confirm") {
    const key = "org:verify:" + identity.uuid;
    const pending = await org.kv.get(key);
    if (!pending || pending.expires < org.now())
      fail(400, "This code expired. Request a new one.");
    // Counted atomically, so parallel guesses cannot exceed the limit.
    const tries = "org:verify-tries:" + identity.uuid;
    if ((await org.kv.incr(tries)) > 5)
      fail(429, "Too many attempts. Request a new code.");
    if (
      (await hash(`${identity.uuid}:${text(input.code, 10)}`)) !== pending.code
    )
      fail(400, "That code is not correct.");
    await org.kv.del(key);
    await org.kv.del(tries);
    let user = await linkEmail(org, identity, pending.email);
    if (!user) {
      await requireVerifiable(org, identity, pending.email);
      const isOwner = (await org.accountOwner()).uuid === identity.uuid;
      user = {
        uuid: identity.uuid,
        username: identity.username,
        email: pending.email,
        emailVerified: true,
        // The owner's record only holds its email; its role is implicit.
        ...(isOwner ? {} : { role: "guest", license: "guest" }),
        status: "active",
        created: org.now(),
        source: "email",
        teams: [],
      };
      await org.saveUser(user);
    }
    await org.audit(
      identity,
      "email.verified",
      { type: "user", id: identity.uuid },
      {
        domain: emailDomain(pending.email),
      },
    );
    const policy = await org.policy();
    if (
      policy.domainCapture &&
      policy.domains.includes(emailDomain(pending.email)) &&
      (user.role === "guest" || !user.role) &&
      user.status === "active"
    )
      user = await joinOrganization(org, identity, {});
    return { user: publicUser(user), info: await org.info(identity) };
  }
  if (op === "notifications.list") {
    const rows = await org.list(`org:notif:${identity.uuid}:`, {
      reverse: true,
      limit: Math.min(200, Number(input.limit) || 50),
    });
    const items = rows.map((r) => r.value);
    return { items, unread: items.filter((n) => !n.read).length };
  }
  if (op === "notifications.read") {
    const ids = input.all ? null : new Set((input.ids || []).slice(0, 200));
    for (const { key, value } of await org.list(`org:notif:${identity.uuid}:`, {
      reverse: true,
      limit: 200,
    }))
      if (!value.read && (!ids || ids.has(value.id)))
        await org.kv.set(
          key,
          { ...value, read: true },
          Math.floor((value.at + 90 * DAY) / 1000),
        );
    return { ok: true };
  }
  if (op === "prefs.set") {
    const user = await org.freshUser(identity.uuid);
    if (!user) fail(404, "Join the organization to save preferences.");
    user.prefs = {
      ...(user.prefs || {}),
      ...("emailNotifications" in input
        ? { emailNotifications: !!input.emailNotifications }
        : {}),
    };
    await org.saveUser(user);
    return { prefs: user.prefs };
  }
  if (op === "org.boards") {
    const scope = input.scope || "mine";
    let rows,
      total = null;
    if (scope === "all") {
      await admin();
      rows = (await org.list("org:board:")).map((r) => r.value);
      total = rows.length;
    } else {
      const mine = new Map(
        (await org.list(`org:ub:${identity.uuid}:`)).map((r) => [
          r.key.split(":").at(-1),
          r.value,
        ]),
      );
      const rooms = new Set(mine.keys());
      const role = scope === "organization" && (await org.role(identity));
      if (role && role !== "guest")
        for (const row of await org.list("org:visible:", { values: false }))
          rooms.add(
            (typeof row === "string" ? row : row.key).split(":").at(-1),
          );
      const found = await boardRows(org, rooms, scope !== "mine");
      total = found.total;
      rows = found.rows.map((b) => ({
        ...b,
        role: mine.get(b.room) || null,
      }));
    }
    if (input.query && input.content) {
      // Every board's content is searched: when the boards are much of the
      // directory the index is read in pages, others read their own
      // entries, so a few boards never read every board's text.
      if (total && rows.length > 50 && rows.length * 4 >= total) {
        const index = new Map(
          (await org.list("org:idx:")).map((r) => [
            r.key.slice("org:idx:".length),
            r.value,
          ]),
        );
        for (const b of rows) b.text = index.get(b.room) || "";
      } else {
        const texts = await perBoard(
          org,
          "org:idx:",
          rows.map((b) => b.room),
        );
        rows.forEach((b, n) => (b.text = texts[n] || ""));
      }
    }
    const role = await org.role(identity);
    const insider = !!role && role !== "guest",
      administers = role === "owner" || role === "admin";
    // Only administrators see boards in the trash.
    let matched = filterBoards(
      rows,
      administers ? input : { ...input, deleted: false },
      org.now(),
    );
    // Matching a board's content tells what is on it, so a person whose
    // access ended (removed, an expired guest, or guests turned off) finds
    // only the boards they can still open. Guests see only those at all,
    // even by title. Administrators open every board. Members can still
    // join boards shared with the organization that they have not opened
    // yet.
    const canOpen = (b) =>
      boards.member(b.room, identity).then(
        () => true,
        async () =>
          insider &&
          b.visibility === "organization" &&
          !(await org.kv.get(`wb:${b.room}:member:${identity.uuid}`)),
      );
    if (!administers && ((input.query && input.content) || !insider)) {
      const open = [];
      for (let n = 0; n < matched.length; n += 25)
        open.push(
          ...(await Promise.all(matched.slice(n, n + 25).map(canOpen))),
        );
      matched = matched.filter((b, n) => open[n]);
    }
    // A page of the matching boards, with how many matched in all.
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0)),
      limit = Math.max(
        1,
        Math.min(1000, Math.floor(Number(input.limit)) || 200),
      );
    const boardsOut = matched.slice(offset, offset + limit);
    for (const b of boardsOut) {
      delete b.text;
      // Legal holds, who edited last, and a digest of the content are for
      // the board's administrators, as the board itself tells only its
      // managers.
      if (!administers)
        for (const key of ["legalHold", "lastEditor", "fingerprint", "purging"])
          delete b[key];
    }
    return { boards: boardsOut, total: matched.length, offset };
  }
  if (op === "org.boards.duplicates") {
    await admin();
    const rows = (await org.list("org:board:"))
      .map((r) => r.value)
      .filter((b) => !b.deleted);
    const groups = new Map();
    for (const b of rows) {
      const keys = [
        b.fingerprint && b.objectCount ? "content:" + b.fingerprint : null,
        "title:" +
          String(b.title || "")
            .trim()
            .toLowerCase()
            .replace(/\s*\(copy\)$/, ""),
      ].filter(Boolean);
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
    }
    return {
      groups: [...groups]
        .filter(([, list]) => list.length > 1)
        .map(([key, list]) => ({
          reason: key.startsWith("content:") ? "same content" : "same title",
          boards: list.map((b) => ({
            room: b.room,
            title: b.title,
            owner: b.owner,
            ownerName: b.ownerName,
            objectCount: b.objectCount || 0,
            lastActivity: b.lastActivity || b.created,
          })),
        }))
        .slice(0, 200),
    };
  }
  if (op === "library.list") {
    const role = await member();
    const rows = (await org.list("org:lib:")).map((r) => r.value);
    const isAdmin = role === "owner" || role === "admin";
    return {
      items: rows
        .filter(
          (i) =>
            i.status === "approved" || isAdmin || i.createdBy === identity.uuid,
        )
        // Administrators and the person who shared an item may remove it.
        .map((i) => ({
          ...i,
          canRemove: isAdmin || i.createdBy === identity.uuid,
        })),
      canPublish: isAdmin,
    };
  }
  if (op === "library.get") {
    const item = await org.kv.get("org:lib:" + id(input.id));
    const role = await member();
    if (!item) fail(404, "Library item not found.");
    if (
      item.status !== "approved" &&
      role !== "owner" &&
      role !== "admin" &&
      item.createdBy !== identity.uuid
    )
      fail(403, "This item is awaiting approval.");
    return { item, board: await (await org.puter.fs.read(item.file)).text() };
  }
  if (op === "library.submit") {
    const role = await org.role(identity);
    if (!role || role === "guest")
      fail(403, "Only organization members can share library content.");
    if (typeof input.board !== "string" || input.board.length > 12_000_000)
      fail(413, "This content is too large for the library.");
    validateBoard(JSON.parse(input.board));
    // Validate language before writing the template or creating a record.
    const description = libraryDescription(input);
    const itemId = short();
    const file = `whiteboard/library/${itemId}.json`;
    await org.puter.fs.write(file, input.board, {
      createMissingParents: true,
      overwrite: true,
    });
    const isAdmin = role === "owner" || role === "admin";
    const item = {
      id: itemId,
      name: text(input.name, 120) || "Untitled",
      ...description,
      category: text(input.category, 60) || "General",
      kind: input.kind === "component" ? "component" : "template",
      status: isAdmin ? "approved" : "pending",
      createdBy: identity.uuid,
      createdByName: identity.username,
      created: org.now(),
      file,
    };
    await org.kv.set("org:lib:" + itemId, item);
    await org.audit(
      identity,
      "library.submitted",
      { type: "library", id: itemId, name: item.name },
      {
        status: item.status,
      },
    );
    return { item };
  }
  if (op === "library.approve" || op === "library.remove") {
    const item = await org.kv.get("org:lib:" + id(input.id));
    if (!item) fail(404, "Library item not found.");
    if (op === "library.remove" && item.createdBy !== identity.uuid)
      await admin();
    if (op === "library.approve") await admin();
    if (op === "library.remove") {
      await org.kv.del("org:lib:" + item.id);
      await org.puter.fs.delete(item.file).catch(() => {});
    } else
      await org.kv.set("org:lib:" + item.id, {
        ...item,
        status: "approved",
        approvedBy: identity.uuid,
        approved: org.now(),
      });
    await org.audit(
      identity,
      op === "library.approve" ? "library.approved" : "library.removed",
      {
        type: "library",
        id: item.id,
        name: item.name,
      },
    );
    return { ok: true };
  }
  if (op === "spaces.list") {
    await member();
    return { spaces: (await org.list("org:space:")).map((r) => r.value) };
  }
  if (op === "spaces.create" || op === "spaces.delete") {
    const role = await org.role(identity);
    if (!role || role === "guest")
      fail(403, "Only organization members can manage spaces.");
    if (op === "spaces.delete") {
      await admin();
      const spaceId = id(input.id);
      const space = await org.kv.get("org:space:" + spaceId);
      await org.kv.del("org:space:" + spaceId);
      if (space)
        await org.audit(identity, "space.deleted", {
          type: "space",
          id: spaceId,
          name: space.name,
        });
      return { ok: true };
    }
    const space = {
      id: short(),
      name: text(input.name, 80) || "Untitled space",
      team: input.team ? id(input.team) : null,
      created: org.now(),
      createdBy: identity.uuid,
    };
    await org.kv.set("org:space:" + space.id, space);
    await org.audit(identity, "space.created", {
      type: "space",
      id: space.id,
      name: space.name,
    });
    return { space };
  }
  if (op === "feedback.submit") {
    const ease = Number(input.ease);
    if (!Number.isInteger(ease) || ease < 1 || ease > 5)
      fail(400, "Choose a rating from 1 to 5.");
    const role = await org.role(identity);
    if (!role) fail(403, "Only people in the organization can send feedback.");
    const at = org.now(),
      iso = new Date(at).toISOString();
    // No account identifier is stored with the rating and authored comment.
    await org.kv.set(
      `org:feedback:${iso}:${short()}`,
      {
        at,
        ease,
        role,
        ...feedbackComment(input),
        context: text(input.context, 40) || null,
      },
      Math.floor((at + 400 * DAY) / 1000),
    );
    return { ok: true };
  }
  if (op === "teams.list") {
    await member();
    return { teams: (await org.list("org:team:")).map((r) => r.value) };
  }
  if (op === "org.ai") return aiRequest(org, identity, input);
  if (op === "org.jira.create" || op === "org.jira.status")
    return jira(org, identity, input, boards);

  // Everything below is administration.
  const role = await admin();
  if (op === "org.policy.get") {
    const meta = await org.meta();
    const secrets = {};
    for (const name of ["slack", "jira", "sentinel", "siem-token"])
      secrets[name] = !!(await org.secret(name));
    return {
      policy: meta?.policy || normalizePolicy(),
      secrets,
      siem: (await org.kv.get("org:siem:status")) || null,
      owner: await org.accountOwner(),
      platform: {
        saml: false,
        scim: true,
        mfaSignal: false,
        note: "SAML single sign-on and enforced multifactor authentication are provided by the Puter account platform.",
      },
    };
  }
  if (op === "org.policy.set") {
    const meta = (await org.kv.get("org:meta")) || {
      created: org.now(),
      owner: (await org.accountOwner()).uuid,
    };
    const before = normalizePolicy(meta.policy);
    const policy = mergePolicy(before, input.policy || {});
    if (policy.ai.model !== undefined) delete policy.ai.model;
    if (typeof input.policy?.ai?.model === "string")
      policy.ai.model = text(input.policy.ai.model, 100);
    else if (before.ai.model) policy.ai.model = before.ai.model;
    if (policy.mfaRequired && !before.mfaRequired)
      fail(
        400,
        "Multifactor enforcement requires Puter platform support that is not available yet.",
      );
    const secrets =
      input.secrets && typeof input.secrets === "object" ? input.secrets : {};
    // Every secret is checked before anything is saved, so a rejected
    // request never leaves a policy change behind without an audit record.
    for (const [name, value] of Object.entries(secrets)) {
      if (!SECRETS.has(name)) fail(400, "Unknown integration secret.");
      if (
        name === "slack" &&
        typeof value === "string" &&
        value &&
        !/^https:\/\/hooks\.slack\.com\//.test(value)
      )
        fail(400, "Enter a Slack incoming webhook URL.");
    }
    // The stored bearer token only ever goes to the endpoint it was entered
    // for; moving the endpoint elsewhere needs the token again. Clearing the
    // endpoint sends the token nowhere. A value that is not text changes
    // nothing below, so it does not count as entering the token again.
    const origin = (url) => (url ? new URL(url).origin : "");
    if (
      policy.siem.url &&
      origin(policy.siem.url) !== origin(before.siem.url) &&
      typeof secrets["siem-token"] !== "string" &&
      secrets["siem-token"] !== null &&
      (await org.secret("siem-token"))
    )
      fail(400, "Enter the bearer token again for the new endpoint.");
    meta.policy = policy;
    await org.kv.set("org:meta", meta);
    org.forgetPolicy();
    for (const [name, value] of Object.entries(secrets)) {
      if (value !== null && typeof value !== "string") continue;
      await org.setSecret(name, value ? value.slice(0, 4096) : null);
    }
    const changed = Object.keys(policy).filter(
      (k) => JSON.stringify(policy[k]) !== JSON.stringify(before[k]),
    );
    await org.audit(
      identity,
      "policy.updated",
      { type: "organization", name: policy.name },
      {
        changed,
        secretsChanged: Object.keys(secrets),
      },
    );
    return { policy };
  }
  if (op === "org.users.list") {
    const rows = (await org.withActivity(await org.members())).map(publicUser);
    const owner = await org.accountOwner();
    const q = text(input.query, 100).toLowerCase();
    return {
      owner,
      users: rows.filter(
        (u) =>
          (!input.role || u.role === input.role) &&
          (!input.status || u.status === input.status) &&
          (!q ||
            [u.username, u.email]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)),
      ),
    };
  }
  if (op === "org.users.update") {
    const uuid = id(input.uuid);
    const owner = await org.accountOwner();
    if (uuid === owner.uuid)
      fail(400, "The account owner's role cannot change.");
    const user = await org.freshUser(uuid);
    if (!user) fail(404, "User not found.");
    const before = { role: user.role, status: user.status };
    if (input.role !== undefined) {
      if (!ORG_ROLES.includes(input.role) || input.role === "owner")
        fail(400, "Invalid organization role.");
      if (input.role === "admin" && role !== "owner")
        fail(403, "Only the account owner can appoint administrators.");
      if (user.role === "admin" && role !== "owner")
        fail(403, "Only the account owner can change an administrator.");
      if (user.role !== input.role) user.roleChanged = org.now();
      user.role = input.role;
      user.license = input.role === "guest" ? "guest" : "full";
    }
    if (input.status !== undefined) {
      if (!["active", "deactivated"].includes(input.status))
        fail(400, "Invalid account status.");
      if (user.status === "pending")
        fail(400, "This user has not signed in yet.");
      if (
        before.role === "admin" &&
        role !== "owner" &&
        input.status !== user.status
      )
        fail(403, "Only the account owner can change an administrator.");
      user.status = input.status;
    }
    await org.saveUser(user);
    if (before.role !== user.role)
      await org.audit(
        identity,
        "user.role.changed",
        { type: "user", id: uuid, name: user.username },
        {
          from: before.role,
          to: user.role,
        },
      );
    if (before.status !== user.status) {
      await org.audit(
        identity,
        user.status === "deactivated" ? "user.deactivated" : "user.reactivated",
        { type: "user", id: uuid, name: user.username },
      );
      if (user.status === "deactivated") await boards.revokeSessions(uuid);
    }
    return { user: publicUser(user) };
  }
  if (op === "migration.apply") {
    // Preserve a migrated board's ownership and permissions by email.
    const room = id(input.room);
    const meta = await org.kv.get(`wb:${room}:meta`);
    if (!meta) fail(404, "Board not found.");
    const members = (Array.isArray(input.members) ? input.members : []).slice(
      0,
      2000,
    );
    const applied = [],
      skipped = [],
      roles = new Map();
    let owner = null;
    for (const m of members) {
      const email = text(m.email, 254).toLowerCase();
      if (!validEmail(email)) {
        skipped.push({ email: m.email || null, reason: "missing email" });
        continue;
      }
      const user = await accountForEmail(org, email, {
        name: m.name,
        guest: !!m.guest,
        source: "migration",
      });
      const role = [
        "owner",
        "facilitator",
        "editor",
        "commenter",
        "viewer",
      ].includes(m.role)
        ? m.role
        : "viewer";
      if (role === "owner") {
        owner = user;
        continue;
      }
      await boards.setMember(room, {
        uuid: user.uuid,
        username: user.username || user.displayName || email,
        role,
        ...(m.guest ? { guest: true } : {}),
        joined: org.now(),
        source: "migration",
      });
      roles.set(user.uuid, role);
      applied.push({ email, role, pending: user.status === "pending" });
    }
    if (owner) {
      if (!(await org.kv.get(`wb:${room}:member:${owner.uuid}`)))
        await boards.setMember(room, {
          uuid: owner.uuid,
          username: owner.username || owner.displayName || owner.email,
          role: "facilitator",
        });
      await boards.transfer(room, identity, owner.uuid, { admin: true });
      applied.push({
        email: owner.email,
        role: "owner",
        pending: owner.status === "pending",
      });
      // The administrator running the migration keeps governance access
      // without appearing as a participant the source board never had; one
      // who was a member there keeps that board role.
      const self = await org.kv.get(`wb:${room}:member:${identity.uuid}`);
      if (self && self.uuid !== owner.uuid)
        await boards.setMember(room, {
          ...self,
          role: roles.get(identity.uuid) || "removed",
        });
    }
    if (input.source && typeof input.source === "object")
      await org.registerBoard(room, {
        source: "miro",
        sourceId: text(input.source.boardId, 100) || null,
        sourceLink: text(input.source.viewLink, 500) || null,
      });
    await boards.refreshCounts(room);
    await org.audit(
      identity,
      "board.migrated",
      { type: "board", id: room },
      {
        members: applied.length,
        skipped: skipped.length,
        owner: owner?.email || null,
      },
    );
    return { applied, skipped };
  }
  if (op === "org.users.transfer") {
    const from = id(input.from),
      to = id(input.to);
    // Boards go to someone who can keep them: the account owner or an active
    // member, never a guest whose access expires.
    const next = await org.freshUser(to);
    if (
      to !== (await org.accountOwner()).uuid &&
      (!next || next.status !== "active" || next.role === "guest")
    )
      fail(400, "Choose an active member of your organization.");
    const rooms = (await org.list("org:board:"))
      .map((r) => r.value)
      .filter((b) => b.owner === from && !b.deleted)
      .map((b) => b.room);
    for (const room of rooms)
      await boards.transfer(room, identity, to, { admin: true });
    return { transferred: rooms.length };
  }
  if (op === "org.invite") {
    const inviteRole = ["member", "admin", "guest"].includes(input.role)
      ? input.role
      : "member";
    if (inviteRole === "admin" && role !== "owner")
      fail(403, "Only the account owner can invite administrators.");
    const value = token();
    const days = Math.max(1, Math.min(90, Number(input.days) || 14));
    await org.kv.set("org:invite:" + (await hash(value)), {
      role: inviteRole,
      expires: org.now() + days * DAY,
      created: org.now(),
      createdBy: identity.uuid,
    });
    await org.audit(
      identity,
      "user.invited",
      { type: "organization" },
      { role: inviteRole, days },
    );
    return { token: value, expires: org.now() + days * DAY };
  }
  if (op === "org.invite.revoke") {
    for (const row of await org.list("org:invite:")) await org.kv.del(row.key);
    await org.audit(identity, "user.invites.revoked", { type: "organization" });
    return { ok: true };
  }
  if (op === "teams.create" || op === "teams.update" || op === "teams.delete") {
    const teamId = op === "teams.create" ? short() : id(input.id);
    const existing = await org.kv.get("org:team:" + teamId);
    if (op !== "teams.create" && !existing) fail(404, "Team not found.");
    const members =
      op === "teams.delete"
        ? []
        : Array.isArray(input.members)
          ? [...new Set(input.members.map(id))].slice(0, 5000)
          : existing?.members || [];
    await syncTeamMembers(org, teamId, existing?.members || [], members);
    if (op === "teams.delete") await org.kv.del("org:team:" + teamId);
    else
      await org.kv.set("org:team:" + teamId, {
        ...(existing || { id: teamId, created: org.now() }),
        name: text(input.name, 120) || existing?.name || "Untitled team",
        members,
      });
    await org.audit(
      identity,
      `team.${op.split(".")[1]}d`,
      {
        type: "team",
        id: teamId,
        name: input.name || existing?.name,
      },
      { members: members.length },
    );
    return { team: await org.kv.get("org:team:" + teamId) };
  }
  if (op === "org.audit") return auditQuery(org, input);
  if (op === "org.board.activity")
    return {
      entries: (
        await org.list(`org:bact:${id(input.room)}:`, {
          reverse: true,
          limit: 500,
        })
      ).map((r) => r.value),
    };
  if (op === "org.reports") return computeReports(org, input);
  if (op === "apikeys.list")
    return {
      keys: (await listKeys(org)).map(({ hash: _, ...k }) => k),
      scopes: API_SCOPES,
    };
  if (op === "apikeys.create") {
    const scopes = (Array.isArray(input.scopes) ? input.scopes : []).filter(
      (s) => API_SCOPES.includes(s),
    );
    if (!scopes.length) fail(400, "Choose at least one scope.");
    const days = input.days ?? null;
    if (days !== null && !(Number.isInteger(days) && days >= 1))
      fail(400, "Choose a whole number of days for the key to expire.");
    const value = "wbk_" + token();
    const record = {
      id: short(),
      name: text(input.name, 80) || "API key",
      scopes,
      created: org.now(),
      createdBy: identity.uuid,
      expires: days ? org.now() + Math.min(730, days) * DAY : null,
      prefix: value.slice(0, 12),
      lastUsed: null,
    };
    await org.kv.set("org:apikey:" + (await hash(value)), record, {
      disableSharing: true,
    });
    await org.audit(
      identity,
      "apikey.created",
      { type: "apikey", id: record.id, name: record.name },
      {
        scopes,
      },
    );
    return { key: value, record };
  }
  if (op === "apikeys.revoke") {
    const match = (await listKeys(org)).find((k) => k.id === input.id);
    if (!match) fail(404, "API key not found.");
    await org.kv.del("org:apikey:" + match.hash);
    await org.kv.del("org:apikeyused:" + match.hash);
    await org.audit(identity, "apikey.revoked", {
      type: "apikey",
      id: match.id,
      name: match.name,
    });
    return { ok: true };
  }
  if (op === "webhooks.list")
    return {
      webhooks: (await org.list("org:webhook:")).map((r) => r.value),
      events: WEBHOOK_EVENTS,
      pending: (await org.list("org:hookq:", { limit: 100 })).length,
    };
  if (op === "webhooks.create") {
    let url;
    try {
      url = new URL(input.url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw Error();
    } catch {
      fail(400, "Enter a valid HTTPS webhook URL.");
    }
    if (!publicHost(url.hostname))
      fail(400, "Webhooks must use a public internet address.");
    const events = (Array.isArray(input.events) ? input.events : ["*"]).filter(
      (e) => WEBHOOK_EVENTS.includes(e),
    );
    const hook = {
      id: short(),
      url: url.href,
      events: events.length ? events : ["*"],
      enabled: true,
      created: org.now(),
      createdBy: identity.uuid,
      // A webhook made with an API key belongs to the administrator who made
      // the key, so it outlives the key being rotated.
      ...(identity.apiKey && identity.createdBy
        ? { admin: identity.createdBy }
        : {}),
    };
    const secret = "whsec_" + token();
    // The secret is saved first, so every delivery can be signed.
    await org.kv.set("org:hooksecret:" + hook.id, secret, {
      disableSharing: true,
    });
    await org.kv.set("org:webhook:" + hook.id, hook);
    org.instance.hooks = null;
    await org.audit(
      identity,
      "webhook.created",
      { type: "webhook", id: hook.id, name: hook.url },
      {
        events: hook.events,
      },
    );
    return { webhook: hook, secret };
  }
  if (op === "webhooks.delete") {
    const hookId = id(input.id);
    await org.kv.del("org:webhook:" + hookId);
    org.instance.hooks = null;
    await org.kv.del("org:hooksecret:" + hookId);
    for (const row of await org.list(`org:hookq:${hookId}:`, {
      values: false,
    }))
      await org.kv.del(typeof row === "string" ? row : row.key);
    await org.audit(identity, "webhook.deleted", {
      type: "webhook",
      id: hookId,
    });
    return { ok: true };
  }
  if (op === "webhooks.test") {
    const hook = await org.kv.get("org:webhook:" + id(input.id));
    if (!hook) fail(404, "Webhook not found.");
    const iso = new Date(org.now()).toISOString();
    const entry = {
      id: `${iso}:test`,
      at: org.now(),
      time: iso,
      category: "admin",
      action: "webhook.test",
      actor: { uuid: identity.uuid, username: identity.username },
      target: { type: "webhook", id: hook.id },
      details: {},
    };
    try {
      await sendHook(org, hook, entry);
      return { ok: true, matches: hookMatches(hook, "board.created") };
    } catch (error) {
      fail(502, error.message || "The webhook test failed.");
    }
  }
  if (op === "org.siem.test") {
    const policy = await org.policy();
    if (policy.siem.mode === "none")
      fail(400, "Choose a SIEM destination to send a test event.");
    try {
      return await siem(org, policy, { force: true });
    } catch (error) {
      fail(502, error.message || "The SIEM test failed.");
    }
  }
  fail(400, "Unknown organization operation.");
}
