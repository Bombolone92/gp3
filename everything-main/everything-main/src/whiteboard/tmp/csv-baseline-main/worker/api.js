import { hash } from "../src/collaboration/protocol.js";
import { adminCall, apiKey, syncTeamMembers } from "./admin.js";
import { fail, validEmail } from "./org.js";
import { computeReports } from "./reports.js";

const CORE = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const EXT = "urn:ietf:params:scim:schemas:extension:whiteboard:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_TYPE = { "Content-Type": "application/scim+json" };
const json = (body, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
// Created resources name their address in Location (RFC 7644 3.3).
const scim = (body, status = 200) =>
  json(body, status, {
    ...SCIM_TYPE,
    ...(status === 201 && body?.meta?.location
      ? { Location: body.meta.location }
      : {}),
  });
// A SCIM error with the scimType RFC 7644 section 3.12 names for it.
const refuse = (status, message, scimType) => {
  throw Object.assign(Error(message), { status, scimType });
};
const truthy = (v) =>
  v === true || (typeof v === "string" && v.toLowerCase() === "true");
const bearer = (request) =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
// Text that spreadsheets would evaluate as a formula gets an apostrophe
// prefix (OWASP CSV injection guidance).
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCSV = (rows, columns) =>
  "﻿" +
  [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
  ].join("\r\n");

// Parse the SCIM filter forms identity providers send when matching users
// and groups: `attribute eq "value"`, optionally joined with `and`.
// Clauses are read one at a time, so "and" inside a quoted value, as in
// displayName eq "Research and Development", stays part of the value.
export function parseFilter(filter) {
  if (!filter) return [];
  const clause =
    /\s*([A-Za-z.:]+(?:\s*\[\s*type\s+eq\s+"work"\s*\])?(?:\.[A-Za-z]+)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*(and\s+|$)/iy;
  const out = [];
  let m;
  clause.lastIndex = 0;
  while (clause.lastIndex < filter.length && (m = clause.exec(filter))) {
    out.push({
      attr: m[1]
        .replace(/\[\s*type\s+eq\s+"work"\s*\]/i, "")
        .replace(/\s+/g, "")
        .toLowerCase(),
      value: m[2].replace(/\\(.)/g, "$1"),
    });
    if (!m[3]) break;
  }
  if (!out.length || clause.lastIndex !== filter.length)
    refuse(400, "Unsupported SCIM filter.", "invalidFilter");
  return out;
}
// One page of a SCIM list. Missing or unreadable startIndex and count
// fall back to the first page of 100, as RFC 7644 section 3.4.2.4 allows.
function listPage(url, rows, resource) {
  const number = (name, fallback) => {
    const raw = url.searchParams.get(name);
    const value = raw === null || raw === "" ? NaN : Math.floor(Number(raw));
    return Number.isFinite(value) ? value : fallback;
  };
  const start = Math.max(1, number("startIndex", 1));
  const count = Math.max(0, Math.min(500, number("count", 100)));
  const page = rows.slice(start - 1, start - 1 + count);
  return scim({
    schemas: [LIST],
    totalResults: rows.length,
    startIndex: start,
    itemsPerPage: page.length,
    Resources: page.map(resource),
  });
}
// Patch paths may name the core schema in full (RFC 7644 section 3.10), as
// in urn:ietf:params:scim:schemas:core:2.0:User:active.
function unqualified(path, schema) {
  const text = String(path || "");
  return text.toLowerCase().startsWith(schema.toLowerCase() + ":")
    ? text.slice(schema.length + 1)
    : text;
}
function userResource(u, base) {
  const scimId = u.scimId || u.uuid;
  const email = u.email || null;
  return {
    schemas: [CORE, EXT],
    id: scimId,
    ...(u.externalId ? { externalId: u.externalId } : {}),
    userName: email || u.username || scimId,
    displayName: u.displayName || u.username || email || scimId,
    name: {
      givenName: u.givenName || "",
      familyName: u.familyName || "",
      formatted:
        [u.givenName, u.familyName].filter(Boolean).join(" ") ||
        u.displayName ||
        u.username ||
        "",
    },
    emails: email ? [{ value: email, type: "work", primary: true }] : [],
    active: u.status === "pending" ? u.active !== false : u.status === "active",
    groups: (u.teams || []).map((value) => ({ value })),
    roles: [{ value: u.role, primary: true }],
    [EXT]: {
      role: u.role,
      license: u.license || (u.role === "guest" ? "guest" : "full"),
      puterUsername: u.status === "pending" ? null : u.username || null,
      linked: u.status !== "pending",
    },
    meta: {
      resourceType: "User",
      created: new Date(u.created || 0).toISOString(),
      lastModified: new Date(u.modified || u.created || 0).toISOString(),
      location: `${base}/scim/v2/Users/${scimId}`,
    },
  };
}
function groupResource(t, base, scimIds = new Map()) {
  return {
    schemas: [GROUP],
    id: t.id,
    ...(t.externalId ? { externalId: t.externalId } : {}),
    displayName: t.name,
    members: t.members.map((uuid) => ({ value: scimIds.get(uuid) || uuid })),
    meta: {
      resourceType: "Group",
      created: new Date(t.created || 0).toISOString(),
      lastModified: new Date(t.modified || t.created || 0).toISOString(),
      location: `${base}/scim/v2/Groups/${t.id}`,
    },
  };
}
// Accounts deleted through SCIM stay deactivated in the organization, but
// the identity provider no longer sees them.
async function findUser(org, scimId) {
  const mapped = await org.kv.get("org:scimid:" + scimId);
  const user = await org.freshUser(mapped || scimId);
  return user && !user.scimDeleted ? user : null;
}
// Roles come as a list, but a single role, written as its value or as one
// role object, is read the same way, as a patch of the roles path is.
function roleFrom(body, fallback = "member") {
  const ext = body?.[EXT]?.role;
  const roles = [body?.roles ?? []]
    .flat()
    .map((r) => (r && typeof r === "object" ? r : { value: r }));
  const role = ext || roles.find((r) => r.primary)?.value || roles[0]?.value;
  return ["member", "guest"].includes(role) ? role : fallback;
}
// Apply SCIM attributes to a stored user. Admin rights are never granted from
// the identity provider; the account owner appoints administrators.
function applyAttributes(user, body) {
  if (body.externalId !== undefined)
    user.externalId = String(body.externalId || "").slice(0, 200) || null;
  if (body.displayName !== undefined)
    user.displayName = String(body.displayName || "").slice(0, 200);
  if (body.name) {
    if (body.name.givenName !== undefined)
      user.givenName = String(body.name.givenName || "").slice(0, 100);
    if (body.name.familyName !== undefined)
      user.familyName = String(body.name.familyName || "").slice(0, 100);
  }
  if (body.roles !== undefined || body[EXT]?.role !== undefined) {
    if (user.role !== "admin") {
      user.role = roleFrom(body, user.role);
      user.license = user.role === "guest" ? "guest" : "full";
    }
  }
  if (body.active !== undefined) {
    const active = truthy(body.active);
    if (user.status === "pending") user.active = active;
    else user.status = active ? "active" : "deactivated";
  }
}
const OWNER_FIXED = "The account owner stays active and keeps the owner role.";
async function scimUsers(org, boards, identity, method, id, body, url, base) {
  // The account owner can be provisioned like anyone, so providers can
  // match them, but is always active and always the owner.
  const ownerId = (await org.accountOwner()).uuid;
  const view = (u) =>
    userResource(
      u.uuid === ownerId
        ? { ...u, role: "owner", status: "active", license: "full" }
        : u,
      base,
    );
  const keepOwner = (user, status, role) => {
    if (user.uuid !== ownerId) return;
    if (user.status === "deactivated" && status !== "deactivated")
      refuse(400, OWNER_FIXED, "mutability");
    user.status = status;
    user.role = role;
  };
  // As in the admin console, only the account owner changes whether an
  // administrator is active, so only a key the owner created can.
  const ownerKey = identity.createdBy === ownerId;
  // A pending record keeps its status while SCIM turns it on and off, so
  // whether it is active counts as a change too.
  const keepAdmin = (user, status, role, active) => {
    if (
      role === "admin" &&
      !ownerKey &&
      (user.status !== status ||
        (status === "pending" &&
          (user.active !== false) !== (active !== false)))
    )
      refuse(403, "Only the account owner can change an administrator.");
    // A record provisioned inactive before its person signs in deactivates
    // an administrator it is later linked to only if the owner's key made
    // it inactive.
    if (user.status !== "pending") return;
    if (user.active !== false) delete user.inactiveByOwner;
    else if (ownerKey) user.inactiveByOwner = true;
  };
  if (method === "GET" && !id) {
    const filters = parseFilter(url.searchParams.get("filter"));
    // Providers look people up one at a time by userName or id before
    // creating them; those are read from their indexes, not by listing the
    // whole directory for each person.
    const byEmail = filters.find((f) =>
        ["username", "emails.value", "emails"].includes(f.attr),
      ),
      byId = filters.find((f) => f.attr === "id");
    let users;
    if (byEmail || byId) {
      const uuid = byEmail
        ? await org.kv.get(
            "org:email:" + (await hash(byEmail.value.toLowerCase())),
          )
        : null;
      const found = byEmail
        ? uuid && (await org.freshUser(uuid))
        : await findUser(org, byId.value);
      users = found && !found.scimDeleted ? [found] : [];
    } else {
      const ownerRecord = await org.user(ownerId);
      users = [
        ...(await org.members()),
        ...(ownerRecord ? [ownerRecord] : []),
      ].filter((u) => !u.scimDeleted);
    }
    let rows = users.filter((u) =>
      filters.every(({ attr, value }) => {
        const v = value.toLowerCase();
        if (attr === "username" || attr === "emails.value" || attr === "emails")
          return (
            (u.email || "").toLowerCase() === v ||
            (!u.email && (u.username || "").toLowerCase() === v)
          );
        if (attr === "externalid") return (u.externalId || "") === value;
        if (attr === "id") return (u.scimId || u.uuid) === value;
        if (attr === "displayname")
          return (u.displayName || u.username || "").toLowerCase() === v;
        refuse(400, "Unsupported SCIM filter attribute.", "invalidFilter");
      }),
    );
    return listPage(url, rows, view);
  }
  if (method === "POST" && !id) {
    const email = String(
      body?.userName || body?.emails?.[0]?.value || "",
    ).toLowerCase();
    if (!validEmail(email))
      refuse(400, "userName must be the user's email address.", "invalidValue");
    const emailKey = "org:email:" + (await hash(email));
    const linked = await org.kv.get(emailKey);
    let user = linked ? await org.freshUser(linked) : null;
    if (user?.scimManaged)
      refuse(409, "A user with this userName already exists.", "uniqueness");
    if (!user) {
      const pendingId = "pending-" + (await hash(email)).slice(0, 24);
      user = {
        uuid: pendingId,
        scimId: pendingId,
        email,
        emailVerified: false,
        role: roleFrom(body),
        status: "pending",
        active: true,
        created: org.now(),
        source: "scim",
        teams: [],
      };
    }
    const was = user.status,
      wasRole = user.role,
      wasActive = user.active;
    user.scimManaged = true;
    delete user.scimDeleted;
    user.scimId ||= user.uuid;
    user.modified = org.now();
    applyAttributes(user, body);
    keepOwner(user, was, wasRole);
    keepAdmin(user, was, wasRole, wasActive);
    if (was && was !== "pending" && user.role !== wasRole)
      user.roleChanged = user.modified;
    await org.saveUser(user);
    await org.kv.set("org:scimid:" + user.scimId, user.uuid);
    // Provisioning an existing account as inactive ends its sessions, as
    // deactivating it does.
    if (was === "active" && user.status === "deactivated")
      await boards.revokeSessions(user.uuid);
    await org.audit(
      identity,
      "scim.user.created",
      { type: "user", id: user.uuid, name: email },
      {
        linked: user.status !== "pending",
      },
    );
    return scim(view(user), 201);
  }
  const user = id && (await findUser(org, id));
  if (!user) fail(404, "User not found.");
  if (method === "GET") return scim(view(user));
  const before = user.status,
    role = user.role,
    active = user.active;
  if (method === "DELETE") {
    if (user.uuid === ownerId) refuse(400, OWNER_FIXED, "mutability");
    if (role === "admin" && !ownerKey)
      refuse(403, "Only the account owner can change an administrator.");
    // Groups would otherwise list a member the provider cannot read.
    for (const teamId of user.teams || []) {
      const team = await org.kv.get("org:team:" + teamId);
      if (!team?.members?.includes(user.uuid)) continue;
      team.members = team.members.filter((uuid) => uuid !== user.uuid);
      team.modified = org.now();
      await org.kv.set("org:team:" + teamId, team);
    }
    user.teams = [];
    if (user.status === "pending") {
      await org.kv.del("org:user:" + user.uuid);
      org.forgetUser(user.uuid);
      await org.kv.del("org:scimid:" + user.scimId);
      if (user.email) await org.kv.del("org:email:" + (await hash(user.email)));
    } else {
      user.status = "deactivated";
      user.modified = org.now();
      user.scimDeleted = true;
      delete user.scimManaged;
      await org.saveUser(user);
      await org.kv.del("org:scimid:" + user.scimId);
      await boards.revokeSessions(user.uuid);
    }
    await org.audit(identity, "scim.user.deleted", {
      type: "user",
      id: user.uuid,
      name: user.email,
    });
    return new Response(null, { status: 204 });
  }
  if (method === "PUT") applyAttributes(user, body || {});
  else if (method === "PATCH") {
    if (!body?.schemas?.includes(PATCH) || !Array.isArray(body.Operations))
      refuse(400, "Send a SCIM PatchOp request.", "invalidSyntax");
    for (const op of body.Operations) {
      const kind = String(op?.op || "").toLowerCase();
      if (!["add", "replace", "remove"].includes(kind))
        refuse(400, "Unsupported patch operation.", "invalidSyntax");
      const path = unqualified(op.path, CORE);
      if (!path && op.value && typeof op.value === "object")
        applyAttributes(user, op.value);
      else if (/^active$/i.test(path))
        applyAttributes(user, { active: kind === "remove" ? false : op.value });
      else if (/^name\.givenName$/i.test(path))
        applyAttributes(user, {
          name: { givenName: kind === "remove" ? "" : op.value },
        });
      else if (/^name\.familyName$/i.test(path))
        applyAttributes(user, {
          name: { familyName: kind === "remove" ? "" : op.value },
        });
      else if (/^displayName$/i.test(path))
        applyAttributes(user, {
          displayName: kind === "remove" ? "" : op.value,
        });
      else if (/^externalId$/i.test(path))
        applyAttributes(user, {
          externalId: kind === "remove" ? "" : op.value,
        });
      else if (/^roles/i.test(path) && kind === "remove") {
        // Removing the person's role, or every role, returns them to the
        // default member role; removing another role changes nothing.
        const named = /\[\s*value\s+eq\s+"([^"]*)"\s*\]/i.exec(path)?.[1];
        const removed =
          named !== undefined
            ? [named]
            : op.value === undefined
              ? null
              : [op.value].flat().map((r) => r?.value ?? r);
        if (!removed || removed.includes(user.role))
          applyAttributes(user, { roles: [{ value: "member" }] });
      } else if (/^roles/i.test(path))
        applyAttributes(user, { roles: op.value ?? [] });
      // Of the extension, only the role can change; the rest is read-only.
      else if (
        path === EXT ||
        path.toLowerCase() === `${EXT}:role`.toLowerCase()
      )
        applyAttributes(user, {
          [EXT]: {
            role:
              kind === "remove"
                ? "member"
                : path === EXT
                  ? op.value?.role
                  : op.value,
          },
        });
      /* Other attributes (the email that links the account, and ones such
         as title or phone numbers that identity providers map by default)
         are not kept; like POST and PUT, a patch ignores them rather than
         failing the operations it can apply. */
    }
  } else fail(405, "Method not allowed.");
  keepOwner(user, before, role);
  keepAdmin(user, before, role, active);
  user.modified = org.now();
  if (user.role !== role) user.roleChanged = user.modified;
  await org.saveUser(user);
  if (before === "active" && user.status === "deactivated")
    await boards.revokeSessions(user.uuid);
  await org.audit(
    identity,
    "scim.user.updated",
    { type: "user", id: user.uuid, name: user.email },
    {
      status: user.status,
      role: user.role,
    },
  );
  return scim(view(user));
}
async function scimGroups(org, identity, method, id, body, url, base) {
  // Members are looked up one by one, which suits the few a request names;
  // a response listing many reads the directory once instead.
  const accounts = new Map();
  const account = async (uuid) => {
    if (!accounts.has(uuid)) accounts.set(uuid, await org.user(uuid));
    return accounts.get(uuid);
  };
  const known = async (teams) => {
    const uuids = new Set(teams.flatMap((t) => t.members || []));
    if ([...uuids].filter((u) => !accounts.has(u)).length > 200)
      for (const { value } of await org.list("org:user:"))
        if (value?.uuid) accounts.set(value.uuid, value);
    const ids = new Map();
    for (const uuid of uuids) {
      const u = await account(uuid);
      ids.set(uuid, u?.scimId || uuid);
    }
    return ids;
  };
  // Accounts deleted through SCIM cannot join groups again.
  const uuidFor = async (value) => {
    const uuid =
      (await org.kv.get("org:scimid:" + value)) ||
      ((await account(value)) ? value : null);
    return uuid && !(await account(uuid))?.scimDeleted ? uuid : null;
  };
  const save = async (team, members) => {
    await syncTeamMembers(org, team.id, team.members || [], members);
    team.members = members;
    team.modified = org.now();
    await org.kv.set("org:team:" + team.id, team);
  };
  const resolve = async (list = []) =>
    (await Promise.all(list.map((m) => uuidFor(String(m.value || ""))))).filter(
      Boolean,
    );
  // Providers leave out members when they only need a group's identity,
  // as Entra does for each group it checks.
  const excluded = (url.searchParams.get("excludedAttributes") || "")
    .split(",")
    .some((a) => a.trim().toLowerCase() === "members");
  const shown = (t, ids) => {
    const r = groupResource(t, base, ids);
    if (excluded) delete r.members;
    return r;
  };
  if (method === "GET" && !id) {
    const filters = parseFilter(url.searchParams.get("filter"));
    // Providers check membership with members.value, as Entra does.
    const memberOf = new Map();
    for (const { attr, value } of filters)
      if (attr === "members.value") memberOf.set(value, await uuidFor(value));
    const teams = (await org.list("org:team:"))
      .map((r) => r.value)
      .filter((t) =>
        filters.every(({ attr, value }) =>
          attr === "displayname"
            ? t.name.toLowerCase() === value.toLowerCase()
            : attr === "externalid"
              ? t.externalId === value
              : attr === "id"
                ? t.id === value
                : attr === "members.value"
                  ? t.members.includes(memberOf.get(value))
                  : refuse(
                      400,
                      "Unsupported SCIM filter attribute.",
                      "invalidFilter",
                    ),
        ),
      );
    const ids = excluded ? new Map() : await known(teams);
    return listPage(url, teams, (t) => shown(t, ids));
  }
  if (method === "POST" && !id) {
    const name = String(body?.displayName || "")
      .trim()
      .slice(0, 120);
    if (!name) refuse(400, "displayName is required.", "invalidValue");
    const team = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      name,
      externalId: body.externalId
        ? String(body.externalId).slice(0, 200)
        : null,
      created: org.now(),
      members: [],
    };
    await save(team, await resolve(body.members));
    await org.audit(identity, "scim.group.created", {
      type: "team",
      id: team.id,
      name,
    });
    return scim(groupResource(team, base, await known([team])), 201);
  }
  const team = id && (await org.kv.get("org:team:" + id));
  if (!team) fail(404, "Group not found.");
  if (method === "GET")
    return scim(shown(team, excluded ? new Map() : await known([team])));
  if (method === "DELETE") {
    await save(team, []);
    await org.kv.del("org:team:" + team.id);
    await org.audit(identity, "scim.group.deleted", {
      type: "team",
      id: team.id,
      name: team.name,
    });
    return new Response(null, { status: 204 });
  }
  let members = [...team.members];
  const externalId = (value) => String(value || "").slice(0, 200) || null;
  if (method === "PUT") {
    team.name = String(body?.displayName || team.name).slice(0, 120);
    if (body?.externalId !== undefined)
      team.externalId = externalId(body.externalId);
    members = await resolve(body?.members);
  } else if (method === "PATCH") {
    if (!Array.isArray(body?.Operations))
      refuse(400, "Send a SCIM PatchOp request.", "invalidSyntax");
    // One attribute change; `given` says a path named it, so an unknown
    // one is refused rather than ignored.
    const apply = async (kind, path, value, given) => {
      const filtered = /^members\[value eq "([^"]+)"\]$/i.exec(path);
      if (/^displayName$/i.test(path)) {
        if (kind !== "remove")
          team.name = String(value || team.name).slice(0, 120);
      } else if (/^externalId$/i.test(path))
        team.externalId = kind === "remove" ? null : externalId(value);
      else if (filtered && kind === "remove") {
        const uuid = await uuidFor(filtered[1]);
        members = members.filter((m) => m !== uuid);
      } else if (/^members$/i.test(path)) {
        const named = Array.isArray(value) ? value : value ? [value] : [];
        const list = await resolve(named);
        if (kind === "add") members = [...new Set([...members, ...list])];
        else if (kind === "replace") members = list;
        // Only a removal that names no one empties the group; naming only
        // people the worker does not know, such as a deleted account,
        // removes nobody.
        else if (kind === "remove")
          members = named.length
            ? members.filter((m) => !list.includes(m))
            : [];
      } else if (given)
        refuse(400, `Unsupported patch path: ${path}`, "invalidPath");
    };
    for (const op of body.Operations) {
      if (!op || typeof op !== "object")
        refuse(400, "Unsupported patch operation.", "invalidSyntax");
      const kind = String(op.op || "").toLowerCase();
      const path = unqualified(op.path, GROUP);
      if (path) await apply(kind, path, op.value, true);
      // Without a path, each attribute of the value is changed in turn.
      else if (op.value && typeof op.value === "object")
        for (const [key, value] of Object.entries(op.value))
          await apply(kind, unqualified(key, GROUP), value, false);
      else
        refuse(
          400,
          "A patch without a path needs an object value.",
          "invalidValue",
        );
    }
  } else fail(405, "Method not allowed.");
  await save(team, [...new Set(members)]);
  await org.audit(
    identity,
    "scim.group.updated",
    { type: "team", id: team.id, name: team.name },
    {
      members: team.members.length,
    },
  );
  return scim(groupResource(team, base, await known([team])));
}
const SERVICE_CONFIG = (base) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  documentationUri: `${base}/v1/openapi.json`,
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 500 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: "oauthbearertoken",
      name: "API key",
      description:
        "An organization API key with the scim scope, sent as a bearer token.",
      primary: true,
    },
  ],
});
const RESOURCE_TYPES = [
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "User",
    name: "User",
    endpoint: "/Users",
    schema: CORE,
    schemaExtensions: [{ schema: EXT, required: false }],
  },
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "Group",
    name: "Group",
    endpoint: "/Groups",
    schema: GROUP,
  },
];
// Attribute definitions as RFC 7643 section 7 describes them.
const attribute = (name, type, extra = {}) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: "readWrite",
  returned: "default",
  uniqueness: "none",
  ...extra,
});
const readOnly = { mutability: "readOnly" };
const SCHEMA_DEFINITIONS = [
  {
    id: CORE,
    name: "User",
    description: "A person in the organization.",
    attributes: [
      attribute("userName", "string", {
        required: true,
        uniqueness: "server",
        description: "The person's work email address.",
      }),
      attribute("name", "complex", {
        subAttributes: [
          attribute("givenName", "string"),
          attribute("familyName", "string"),
          attribute("formatted", "string", readOnly),
        ],
      }),
      attribute("displayName", "string"),
      attribute("emails", "complex", {
        multiValued: true,
        subAttributes: [
          attribute("value", "string"),
          attribute("type", "string", { canonicalValues: ["work"] }),
          attribute("primary", "boolean"),
        ],
      }),
      attribute("active", "boolean"),
      attribute("externalId", "string", { caseExact: true }),
      attribute("roles", "complex", {
        multiValued: true,
        subAttributes: [
          attribute("value", "string", {
            canonicalValues: ["member", "guest"],
          }),
          attribute("primary", "boolean"),
        ],
      }),
      attribute("groups", "complex", {
        multiValued: true,
        ...readOnly,
        subAttributes: [attribute("value", "string", readOnly)],
      }),
    ],
  },
  {
    id: GROUP,
    name: "Group",
    description: "A team in the organization.",
    attributes: [
      attribute("displayName", "string", { required: true }),
      attribute("members", "complex", {
        multiValued: true,
        subAttributes: [attribute("value", "string")],
      }),
      attribute("externalId", "string", { caseExact: true }),
    ],
  },
  {
    id: EXT,
    name: "WhiteboardUser",
    description: "Whiteboard access for a person.",
    attributes: [
      attribute("role", "string", { canonicalValues: ["member", "guest"] }),
      attribute("license", "string", readOnly),
      attribute("puterUsername", "string", readOnly),
      attribute("linked", "boolean", readOnly),
    ],
  },
];
const SCHEMAS = (base) =>
  SCHEMA_DEFINITIONS.map((schema) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
    ...schema,
    meta: {
      resourceType: "Schema",
      location: `${base}/scim/v2/Schemas/${schema.id}`,
    },
  }));

export async function restRoute(org, boards, request, method, path, body) {
  const url = new URL(request.url);
  const base = url.origin;
  const parts = path.split("/").filter(Boolean);
  if (url.pathname.startsWith("/scim/v2")) {
    const identity = await apiKey(org, bearer(request), "scim");
    const [resource, id] = parts;
    if (resource === "ServiceProviderConfig") return scim(SERVICE_CONFIG(base));
    if (resource === "ResourceTypes") {
      if (id) {
        const type = RESOURCE_TYPES.find((r) => r.id === id);
        if (!type) fail(404, "Unknown SCIM resource type.");
        return scim(type);
      }
      return scim({
        schemas: [LIST],
        totalResults: RESOURCE_TYPES.length,
        startIndex: 1,
        itemsPerPage: RESOURCE_TYPES.length,
        Resources: RESOURCE_TYPES,
      });
    }
    if (resource === "Schemas") {
      const schemas = SCHEMAS(base);
      if (id) {
        const schema = schemas.find((s) => s.id === id);
        if (!schema) fail(404, "Unknown SCIM schema.");
        return scim(schema);
      }
      return scim({
        schemas: [LIST],
        totalResults: schemas.length,
        startIndex: 1,
        itemsPerPage: schemas.length,
        Resources: schemas,
      });
    }
    if (resource === "Users")
      return scimUsers(org, boards, identity, method, id, body, url, base);
    if (resource === "Groups")
      return scimGroups(org, identity, method, id, body, url, base);
    fail(404, "Unknown SCIM resource.");
  }
  if (method === "GET" && path === "openapi.json") return json(openAPI(base));
  // Changes made through the API record their own actions; reads of
  // organization data are recorded here, once per request.
  let recorded = false;
  const need = async (scope) => {
    const identity = await apiKey(org, bearer(request), scope);
    if (method === "GET" && !recorded) {
      recorded = true;
      await org.audit(
        identity,
        "api.read",
        { type: "api", name: url.pathname.slice(0, 200) },
        { scope },
      );
    }
    return identity;
  };
  const call = (identity, input) => adminCall(org, boards, identity, input);
  const q = Object.fromEntries(url.searchParams);
  const [resource, id, sub] = parts;
  if (resource === "audit" && method === "GET") {
    const identity = await need("audit:read");
    const result = await call(identity, {
      ...q,
      op: "org.audit",
      limit: q.limit ? Number(q.limit) : 500,
    });
    if (q.format === "ndjson")
      return new Response(
        result.entries.map((e) => JSON.stringify(e)).join("\n"),
        {
          headers: {
            "Content-Type": "application/x-ndjson",
            ...(result.cursor ? { "X-Next-Cursor": result.cursor } : {}),
          },
        },
      );
    return json(result);
  }
  if (resource === "users") {
    if (method === "GET") {
      const identity = await need("users:read");
      const { users, owner } = await call(identity, {
        op: "org.users.list",
        query: q.query,
        role: q.role,
        status: q.status,
      });
      if (id) {
        const user = users.find((u) => u.uuid === id);
        if (!user) fail(404, "User not found.");
        return json({ user });
      }
      if (q.format === "csv")
        return new Response(
          toCSV(users, [
            "uuid",
            "username",
            "email",
            "role",
            "status",
            "license",
            "created",
            "lastActive",
            "source",
          ]),
          {
            headers: { "Content-Type": "text/csv; charset=utf-8" },
          },
        );
      return json({ owner, users });
    }
    if (method === "PATCH" && id) {
      const identity = await need("users:write");
      return json(
        await call(identity, {
          op: "org.users.update",
          uuid: id,
          role: body?.role,
          status: body?.status,
        }),
      );
    }
  }
  if (resource === "teams") {
    if (method === "GET")
      return json(await call(await need("users:read"), { op: "teams.list" }));
    const identity = await need("users:write");
    if (method === "POST")
      return json(
        await call(identity, {
          op: "teams.create",
          name: body?.name,
          members: body?.members || [],
        }),
        201,
      );
    if (method === "PATCH" && id)
      return json(
        await call(identity, {
          op: "teams.update",
          id,
          name: body?.name,
          members: body?.members,
        }),
      );
    if (method === "DELETE" && id)
      return json(await call(identity, { op: "teams.delete", id }));
  }
  if (resource === "boards") {
    if (method === "GET" && id === "duplicates")
      return json(
        await call(await need("boards:read"), { op: "org.boards.duplicates" }),
      );
    if (method === "GET" && !id) {
      const identity = await need("boards:read");
      const filters = {
        ...q,
        archived: q.archived === undefined ? undefined : q.archived === "true",
        deleted: q.deleted === "true",
        guests: q.guests === "true",
      };
      return json(
        await call(identity, { ...filters, op: "org.boards", scope: "all" }),
      );
    }
    if (method === "GET" && id && sub === "activity")
      return json(
        await call(await need("audit:read"), {
          op: "org.board.activity",
          room: id,
        }),
      );
    if (method === "GET" && id) {
      await need("boards:read");
      const board = await org.kv.get("org:board:" + id);
      if (!board) fail(404, "Board not found.");
      return json({ board, members: await boards.members(id) });
    }
    if (method === "PATCH" && id) {
      const identity = await need("boards:write");
      // The changes that can be refused go first, so a refused request
      // leaves the board as it was.
      if (
        body?.visibility !== undefined &&
        !["private", "organization", "link"].includes(body.visibility)
      )
        fail(400, "Invalid visibility.");
      const [meta, policy] = await Promise.all([
        org.kv.get(`wb:${id}:meta`),
        org.policy(),
      ]);
      if (!meta) fail(404, "Board not found.");
      if (
        body?.visibility === "link" &&
        meta.visibility !== "link" &&
        (!policy.publicLinks || policy.externalSharing !== "anyone")
      )
        fail(403, "Your organization does not allow public board links.");
      const held =
        body?.legalHold !== undefined
          ? !!body.legalHold
          : !!(
              meta.legalHold || (await org.kv.get("org:board:" + id))?.legalHold
            );
      if (body?.deleted === true && (held || policy.retention.legalHold))
        fail(409, "This board is under a legal hold and cannot be deleted.");
      if (body?.owner)
        await boards.transfer(id, identity, body.owner, { admin: true });
      if (body?.visibility)
        await boards.call(identity, {
          op: "settings",
          room: id,
          visibility: body.visibility,
        });
      // Restoring from the trash also unarchives, so it goes before an
      // archive asked for in the same request, and only for a deleted board.
      if (body?.deleted === false && meta.deleted)
        await boards.call(identity, { op: "restore", room: id });
      for (const [key, op] of [
        ["archived", body?.archived ? "archive" : "unarchive"],
        ["legalHold", "hold"],
      ])
        if (body?.[key] !== undefined)
          await boards.call(identity, { op, room: id, enabled: !!body[key] });
      if (body?.deleted === true)
        await boards.call(identity, { op: "delete", room: id });
      return json({ board: await org.kv.get("org:board:" + id) });
    }
  }
  if (resource === "reports" && method === "GET") {
    await need("reports:read");
    const report = await computeReports(org, {
      days: q.days,
      allInactive: id === "users.csv",
    });
    if (id === "users.csv")
      return new Response(
        toCSV(report.users.inactive, [
          "uuid",
          "username",
          "email",
          "lastActive",
        ]),
        { headers: { "Content-Type": "text/csv; charset=utf-8" } },
      );
    if (id === "boards.csv") {
      const rows = (await org.list("org:board:")).map((r) => r.value);
      return new Response(
        toCSV(rows, [
          "room",
          "title",
          "owner",
          "ownerName",
          "created",
          "lastActivity",
          "objectCount",
          "visibility",
          "memberCount",
          "guestCount",
          "peakParticipants",
          "archived",
          "deleted",
        ]),
        { headers: { "Content-Type": "text/csv; charset=utf-8" } },
      );
    }
    return json(report);
  }
  if (resource === "webhooks") {
    const identity = await need("webhooks:write");
    if (method === "GET")
      return json(await call(identity, { op: "webhooks.list" }));
    // Deliveries carry full audit events, so subscribing needs audit access.
    if (method === "POST") {
      await need("audit:read");
      return json(
        await call(identity, {
          op: "webhooks.create",
          url: body?.url,
          events: body?.events,
        }),
        201,
      );
    }
    if (method === "DELETE" && id)
      return json(await call(identity, { op: "webhooks.delete", id }));
  }
  fail(404, "Unknown API endpoint.");
}
// A compact OpenAPI 3.1 description so CDS can automate against the API.
// Declares what every operation shares: parameters named in its path,
// request bodies, and the success status each answers with.
function completePaths(paths) {
  for (const [path, operations] of Object.entries(paths)) {
    const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.length)
      operations.parameters = names.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    const scimPath = path.startsWith("/scim/");
    for (const [method, operation] of Object.entries(operations)) {
      if (method === "parameters") continue;
      // For code generators, such as getV1UsersUuid.
      operation.operationId =
        method +
        path.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) =>
          c ? c.toUpperCase() : "",
        );
      if (["post", "put", "patch"].includes(method))
        operation.requestBody = {
          required: true,
          content: {
            [scimPath ? "application/scim+json" : "application/json"]: {
              schema: { type: "object" },
            },
          },
        };
      const created = method === "post",
        removed = method === "delete" && scimPath;
      if (created || removed) {
        const { 200: _, ...rest } = operation.responses;
        operation.responses = created
          ? { 201: { description: "Created" }, ...rest }
          : { 204: { description: "Deleted" }, ...rest };
      }
    }
  }
  return paths;
}
export function openAPI(base) {
  const secured = (scope, summary, extra = {}) => ({
    summary,
    security: [{ apiKey: [scope] }],
    responses: {
      200: { description: "OK" },
      401: { description: "Missing or invalid API key" },
      403: { description: "Missing scope" },
    },
    ...extra,
  });
  const query = (...names) => ({
    parameters: names.map((name) => ({
      name,
      in: "query",
      schema: { type: "string" },
    })),
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Whiteboard organization API",
      version: "1.0.0",
      description:
        "Administrative REST API and SCIM 2.0 provisioning for a Whiteboard organization. Create API keys in Organization settings, then send them as bearer tokens. SCIM base URL: " +
        `${base}/scim/v2`,
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Organization API key (wbk_...)",
        },
      },
    },
    paths: completePaths({
      "/v1/audit": {
        get: secured(
          "audit:read",
          "Audit log events, newest first. Use format=ndjson for SIEM ingestion and cursor for paging.",
          query(
            "from",
            "to",
            "action",
            "category",
            "actor",
            "board",
            "limit",
            "cursor",
            "format",
          ),
        ),
      },
      "/v1/users": {
        get: secured(
          "users:read",
          "Organization users. format=csv exports a spreadsheet.",
          query("role", "status", "query", "format"),
        ),
      },
      "/v1/users/{uuid}": {
        get: secured("users:read", "One user"),
        patch: secured(
          "users:write",
          "Change role (member, guest) or status (active, deactivated)",
        ),
      },
      "/v1/teams": {
        get: secured("users:read", "Teams"),
        post: secured("users:write", "Create a team"),
      },
      "/v1/teams/{id}": {
        patch: secured("users:write", "Rename or change members"),
        delete: secured("users:write", "Delete a team"),
      },
      "/v1/boards": {
        get: secured(
          "boards:read",
          "Board directory with filters",
          query(
            "query",
            "owner",
            "team",
            "space",
            "visibility",
            "createdAfter",
            "createdBefore",
            "updatedAfter",
            "updatedBefore",
            "activity",
            "type",
            "archived",
            "deleted",
            "guests",
            "sort",
            "limit",
            "offset",
          ),
        ),
      },
      "/v1/boards/duplicates": {
        get: secured("boards:read", "Boards that look duplicated"),
      },
      "/v1/boards/{room}": {
        get: secured("boards:read", "Board metadata and members"),
        patch: secured(
          "boards:write",
          "Transfer ownership, archive, restore, delete, legal hold, or visibility",
        ),
      },
      "/v1/boards/{room}/activity": {
        get: secured("audit:read", "Board-level activity log"),
      },
      "/v1/reports": {
        get: secured(
          "reports:read",
          "Adoption, usage, sharing, and session reports",
          query("days"),
        ),
      },
      "/v1/reports/users.csv": {
        get: secured("reports:read", "Inactive users as CSV"),
      },
      "/v1/reports/boards.csv": {
        get: secured("reports:read", "All boards as CSV"),
      },
      "/v1/webhooks": {
        get: secured("webhooks:write", "Webhook subscriptions"),
        post: {
          ...secured(
            "webhooks:write",
            "Subscribe an HTTPS endpoint to events; deliveries carry X-Whiteboard-Signature (HMAC SHA-256). Also requires audit:read.",
          ),
          security: [{ apiKey: ["webhooks:write", "audit:read"] }],
        },
      },
      "/v1/webhooks/{id}": {
        delete: secured("webhooks:write", "Remove a webhook"),
      },
      "/scim/v2/Users": {
        get: secured(
          "scim",
          "SCIM users (filter userName, externalId, emails.value)",
        ),
        post: secured("scim", "Provision a user by email"),
      },
      "/scim/v2/Users/{id}": {
        get: secured("scim", "SCIM user"),
        put: secured("scim", "Replace"),
        patch: secured("scim", "PatchOp, including active=false to deactivate"),
        delete: secured("scim", "Deprovision"),
      },
      "/scim/v2/Groups": {
        get: secured("scim", "SCIM groups (teams)"),
        post: secured("scim", "Create a group"),
      },
      "/scim/v2/Groups/{id}": {
        get: secured("scim", "SCIM group"),
        put: secured("scim", "Replace"),
        patch: secured("scim", "Add or remove members"),
        delete: secured("scim", "Delete"),
      },
    }),
  };
}
