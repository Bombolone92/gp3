import { hash } from "../src/collaboration/protocol.js";
import { deliver } from "./delivery.js";
import { purge } from "./retention.js";
import { sendScheduledReport } from "./reports.js";

// Every deployed worker is one organization. The account that deployed it is
// the organization's account owner; everything below lives in that account's
// app KV (small records) or files (anything large). Secrets never leave the
// worker: clients only learn whether an integration is configured.
export const ORG_ROLES = ["owner", "admin", "member", "guest"];
export const BOARD_ROLES = [
  "owner",
  "facilitator",
  "editor",
  "commenter",
  "viewer",
];
export const CONTENT_ROLES = new Set(["owner", "facilitator", "editor"]);
export const MANAGER_ROLES = new Set(["owner", "facilitator"]);
export const DAY = 86400_000;
export const DEFAULT_POLICY = {
  name: "",
  domains: [],
  domainCapture: false,
  restrictToOrganization: false,
  externalSharing: "guests",
  guestAccess: true,
  guestExpiryDays: 30,
  publicLinks: false,
  membersCanCreate: true,
  defaultVisibility: "private",
  mfaRequired: false,
  ai: { enabled: true, summaries: true, handwriting: true, clustering: true },
  integrations: {
    slack: { enabled: false },
    jira: { enabled: false, site: "", email: "", project: "" },
    google: { enabled: true },
    webhooks: { enabled: false },
    embeds: { enabled: true },
    miro: { enabled: true },
  },
  retention: { auditDays: 365, deletedBoardDays: 30, legalHold: false },
  siem: {
    mode: "none",
    categories: ["admin", "security", "access", "sharing"],
    sentinel: {
      tenantId: "",
      clientId: "",
      endpoint: "",
      dcrId: "",
      stream: "",
    },
    url: "",
  },
  alerts: {
    publicSharing: true,
    guestAccess: true,
    permissionChanges: true,
    policyChanges: true,
    emails: [],
    slack: false,
  },
  reports: { schedule: "none", emails: [] },
};
export const SECRETS = new Set([
  "slack",
  "jira",
  "sentinel",
  "siem-url",
  "siem-token",
]);
// State kept per worker instance (and per account, for tests): the account
// owner, recently read user records, and batched usage statistics.
const INSTANCES = new WeakMap();
const USER_TTL = 10_000;
export const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const text = (value, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const bool = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
export const validEmail = (value) =>
  typeof value === "string" && value.length <= 254 && EMAIL.test(value);
export const emailDomain = (value) =>
  validEmail(value) ? value.split("@")[1].toLowerCase() : "";
const httpsURL = (value) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error();
    return url.href.slice(0, 2048);
  } catch {
    fail(400, "Enter a valid HTTPS address.");
  }
};
const day = (at) => new Date(at).toISOString().slice(0, 10);
const rand = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

// Merge an untrusted policy patch onto the current policy field by field.
// Unknown keys are dropped, so clients cannot store arbitrary data here.
export function mergePolicy(current, patch = {}) {
  const p = structuredClone(current);
  if ("name" in patch) p.name = text(patch.name, 120);
  if (Array.isArray(patch.domains)) {
    const domains = patch.domains
      .map((d) => text(d, 253).toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    if (domains.some((d) => !DOMAIN.test(d)) || domains.length > 50)
      fail(400, "Enter valid email domains, such as example.ca.");
    p.domains = [...new Set(domains)];
  }
  for (const key of [
    "domainCapture",
    "restrictToOrganization",
    "guestAccess",
    "publicLinks",
    "membersCanCreate",
    "mfaRequired",
  ])
    if (key in patch) p[key] = bool(patch[key], p[key]);
  if (["none", "guests", "anyone"].includes(patch.externalSharing))
    p.externalSharing = patch.externalSharing;
  if (["private", "organization"].includes(patch.defaultVisibility))
    p.defaultVisibility = patch.defaultVisibility;
  if (Number.isInteger(patch.guestExpiryDays))
    p.guestExpiryDays = Math.max(0, Math.min(365, patch.guestExpiryDays));
  if (patch.ai && typeof patch.ai === "object")
    for (const key of ["enabled", "summaries", "handwriting", "clustering"])
      if (key in patch.ai) p.ai[key] = bool(patch.ai[key], p.ai[key]);
  if (patch.integrations && typeof patch.integrations === "object")
    for (const [name, value] of Object.entries(patch.integrations)) {
      if (
        !Object.hasOwn(p.integrations, name) ||
        !value ||
        typeof value !== "object"
      )
        continue;
      if ("enabled" in value)
        p.integrations[name].enabled = bool(
          value.enabled,
          p.integrations[name].enabled,
        );
      if (name === "jira") {
        if ("site" in value) {
          const site = text(value.site, 253).toLowerCase();
          if (site && !/^[a-z0-9-]+\.atlassian\.net$/.test(site))
            fail(
              400,
              "Enter your Jira Cloud site, such as team.atlassian.net.",
            );
          p.integrations.jira.site = site;
        }
        if ("email" in value) {
          if (value.email && !validEmail(value.email))
            fail(400, "Enter a valid email address.");
          p.integrations.jira.email = text(value.email, 254);
        }
        if ("project" in value) {
          const project = text(value.project, 20).toUpperCase();
          if (project && !/^[A-Z][A-Z0-9_]+$/.test(project))
            fail(400, "Enter a Jira project key, such as CDS.");
          p.integrations.jira.project = project;
        }
      }
    }
  if (patch.retention && typeof patch.retention === "object") {
    const r = patch.retention;
    if (Number.isInteger(r.auditDays))
      p.retention.auditDays = Math.max(30, Math.min(3650, r.auditDays));
    if (Number.isInteger(r.deletedBoardDays))
      p.retention.deletedBoardDays = Math.max(
        1,
        Math.min(3650, r.deletedBoardDays),
      );
    if ("legalHold" in r)
      p.retention.legalHold = bool(r.legalHold, p.retention.legalHold);
  }
  if (patch.siem && typeof patch.siem === "object") {
    const s = patch.siem;
    if (["none", "sentinel", "https"].includes(s.mode)) p.siem.mode = s.mode;
    if (Array.isArray(s.categories))
      p.siem.categories = s.categories.filter((c) =>
        ["admin", "security", "access", "sharing", "content", "api"].includes(
          c,
        ),
      );
    if (s.sentinel && typeof s.sentinel === "object") {
      const z = s.sentinel,
        guid = /^[0-9a-f-]{36}$/i;
      if ("tenantId" in z) {
        if (z.tenantId && !guid.test(z.tenantId))
          fail(400, "Enter the Microsoft Entra tenant ID.");
        p.siem.sentinel.tenantId = text(z.tenantId, 36);
      }
      if ("clientId" in z) {
        if (z.clientId && !guid.test(z.clientId))
          fail(400, "Enter the application (client) ID.");
        p.siem.sentinel.clientId = text(z.clientId, 36);
      }
      if ("endpoint" in z) {
        const endpoint = httpsURL(text(z.endpoint, 2048));
        const url = endpoint && new URL(endpoint);
        // The Entra token is only ever sent to an Azure ingestion host.
        if (
          url &&
          (!/\.ingest\.monitor\.azure\.(com|us|cn)$/.test(url.hostname) ||
            url.port ||
            url.pathname !== "/" ||
            url.search ||
            url.hash)
        )
          fail(400, "Enter the data collection endpoint logs ingestion URL.");
        p.siem.sentinel.endpoint = url ? url.origin : "";
      }
      if ("dcrId" in z) {
        if (z.dcrId && !/^dcr-[0-9a-f]{32}$/i.test(z.dcrId))
          fail(400, "Enter the data collection rule immutable ID.");
        p.siem.sentinel.dcrId = text(z.dcrId, 36);
      }
      if ("stream" in z) {
        if (z.stream && !/^Custom-[A-Za-z0-9_]{1,100}$/.test(z.stream))
          fail(400, "Enter the stream name, such as Custom-WhiteboardAudit.");
        p.siem.sentinel.stream = text(z.stream, 107);
      }
    }
    if ("url" in s) {
      const url = httpsURL(text(s.url, 2048));
      if (url && !publicHost(new URL(url).hostname))
        fail(400, "The SIEM endpoint must use a public internet address.");
      p.siem.url = url;
    }
  }
  if (patch.alerts && typeof patch.alerts === "object") {
    const a = patch.alerts;
    for (const key of [
      "publicSharing",
      "guestAccess",
      "permissionChanges",
      "policyChanges",
      "slack",
    ])
      if (key in a) p.alerts[key] = bool(a[key], p.alerts[key]);
    if (Array.isArray(a.emails)) {
      if (a.emails.length > 10 || a.emails.some((e) => !validEmail(e)))
        fail(400, "Enter up to ten valid alert email addresses.");
      p.alerts.emails = a.emails.map((e) => e.toLowerCase());
    }
  }
  if (patch.reports && typeof patch.reports === "object") {
    const r = patch.reports;
    if (["none", "weekly", "monthly"].includes(r.schedule))
      p.reports.schedule = r.schedule;
    if (Array.isArray(r.emails)) {
      if (r.emails.length > 10 || r.emails.some((e) => !validEmail(e)))
        fail(400, "Enter up to ten valid report email addresses.");
      p.reports.emails = r.emails.map((e) => e.toLowerCase());
    }
  }
  return p;
}
// Fill in fields added after a policy was first saved.
export function normalizePolicy(stored) {
  const p = structuredClone(DEFAULT_POLICY);
  if (!stored) return p;
  for (const [key, value] of Object.entries(stored))
    if (key in p)
      p[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? deepFill(p[key], value)
          : value;
  return p;
}
function deepFill(base, value) {
  const out = structuredClone(base);
  for (const [key, v] of Object.entries(value))
    out[key] =
      v && typeof v === "object" && !Array.isArray(v) && base[key]
        ? deepFill(base[key], v)
        : v;
  return out;
}
const AUDIT_CATEGORY = {
  "org.": "admin",
  "policy.": "admin",
  "user.": "admin",
  "team.": "admin",
  "space.": "admin",
  // People and groups an identity provider changes are administration,
  // like the same changes made in the console.
  "scim.user.": "admin",
  "scim.group.": "admin",
  "apikey.": "security",
  "auth.": "security",
  "email.": "security",
  "board.access": "access",
  "board.joined": "access",
  "board.guest": "access",
  "board.role": "access",
  "board.invite": "sharing",
  "board.visibility": "sharing",
  "board.share": "sharing",
  "board.transfer": "admin",
  "board.content": "content",
  "board.comment": "content",
  "board.export": "content",
  "vote.": "content",
  "poll.": "content",
  "workshop.": "content",
  "api.": "api",
  "scim.": "api",
};
export function auditCategory(action) {
  for (const [prefix, category] of Object.entries(AUDIT_CATEGORY))
    if (action.startsWith(prefix)) return category;
  return "admin";
}

// Whether a person still administers the organization, as keys,
// invitations, and webhooks they made require.
export const administers = async (org, uuid) =>
  ["owner", "admin"].includes(await org.role({ uuid }));
// Webhooks go to services on the public internet: local names and private,
// loopback, or link-local addresses written as the host are refused. A
// worker cannot resolve names, so a public name that points at a private
// address is not caught here.
export function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    // Global unicast IPv6 only (2000::/3), without the documentation range
    // or the 6to4 and Teredo ranges, which carry an IPv4 address that can
    // be a private one.
    const ip = host.slice(1, -1);
    return (
      /^[23][0-9a-f]{0,3}:/.test(ip) &&
      !/^2001:0{0,3}db8:/.test(ip) &&
      !/^2002:/.test(ip) &&
      !/^2001:(0{0,4}):/.test(ip)
    );
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    host.includes(".") &&
    !/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host)
  );
}
export class OrgService {
  constructor(puter, { now = Date.now, fetcher = fetch, request } = {}) {
    this.puter = puter;
    this.kv = puter.kv;
    this.now = now;
    this.fetcher = fetcher;
    this.request = request;
    this.pending = [];
    this.caches = OrgService.caches ??= {
      touched: new Map(),
      purged: 0,
      reported: 0,
    };
    if (!INSTANCES.has(puter))
      INSTANCES.set(puter, {
        owner: null,
        touched: new Map(),
        users: new Map(),
        time: { seconds: 0, since: 0 },
        activity: new Map(),
        hooks: null,
        siem: 0,
      });
    this.instance = INSTANCES.get(puter);
    this.siemInterval = 10_000;
  }
  async list(
    prefix,
    { values = true, limit = Infinity, reverse = false } = {},
  ) {
    let cursor,
      rows = [];
    do {
      const page = await this.kv.list({
        pattern: prefix,
        returnValues: values,
        limit: Math.min(200, limit - rows.length),
        ...(reverse ? { reverse: true } : {}),
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...(Array.isArray(page) ? page : page.items));
      cursor = page.cursor;
    } while (cursor && rows.length < limit);
    return rows;
  }
  // Visits rows page by page, stopping once `visit` returns true.
  async scan(prefix, { values = true, reverse = false } = {}, visit) {
    let cursor;
    do {
      const page = await this.kv.list({
        pattern: prefix,
        returnValues: values,
        limit: 200,
        ...(reverse ? { reverse: true } : {}),
        ...(cursor ? { cursor } : {}),
      });
      for (const row of Array.isArray(page) ? page : page.items)
        if (visit(row)) return;
      cursor = page.cursor;
    } while (cursor);
  }
  async accountOwner() {
    const instance = this.instance;
    instance.owner ??= this.puter.auth.getUser().then(
      (u) => ({ uuid: u.uuid, username: u.username }),
      (error) => {
        instance.owner = null;
        throw error;
      },
    );
    return instance.owner;
  }
  async policy() {
    return normalizePolicy((await this.kv.get("org:meta"))?.policy);
  }
  // Board access checks run on every request, so they reuse the policy for
  // two seconds per worker instance, as board records do. Changes saved on
  // this instance apply at once; others within two seconds.
  async accessPolicy() {
    const hit = this.instance.accessPolicy,
      now = this.now();
    if (hit && now - hit.at < 2000 && now >= hit.at) return hit.value;
    const value = await this.policy();
    this.instance.accessPolicy = { value, at: now };
    return value;
  }
  forgetPolicy() {
    this.instance.accessPolicy = null;
  }
  async meta() {
    const meta = await this.kv.get("org:meta");
    return meta ? { ...meta, policy: normalizePolicy(meta.policy) } : null;
  }
  async secret(name) {
    return (await this.kv.get("org:secret:" + name)) || null;
  }
  async setSecret(name, value) {
    if (!SECRETS.has(name)) fail(400, "Unknown integration secret.");
    if (value == null || value === "") await this.kv.del("org:secret:" + name);
    else
      await this.kv.set("org:secret:" + name, value, { disableSharing: true });
  }
  // User records change rarely; a short per-instance cache keeps access
  // checks from reading the same record several times a second. Status
  // changes made on another instance apply within ten seconds.
  async user(uuid) {
    const cached = this.instance.users.get(uuid);
    if (cached && this.now() - cached.at < USER_TTL)
      return cached.value && structuredClone(cached.value);
    const value = (await this.kv.get("org:user:" + uuid)) || null;
    if (this.instance.users.size > 2000) this.instance.users.clear();
    this.instance.users.set(uuid, { value, at: this.now() });
    return value && structuredClone(value);
  }
  forgetUser(uuid) {
    this.instance.users.delete(uuid);
  }
  // A record about to be changed and saved is read again, so a change made
  // on another instance, such as a deactivation, is never written over with
  // this instance's cached copy.
  async freshUser(uuid) {
    this.forgetUser(uuid);
    return this.user(uuid);
  }
  // The organization role of an authenticated identity, or null for someone
  // with no relationship to this organization yet.
  async role(identity) {
    // Administrator API keys act as administrators, never as the owner.
    if (identity.apiKey) return "admin";
    const owner = await this.accountOwner();
    if (identity.uuid === owner.uuid) return "owner";
    const user = await this.user(identity.uuid);
    if (!user || user.status !== "active") return null;
    return user.role;
  }
  async active(identity) {
    if (identity.apiKey) return true;
    const owner = await this.accountOwner();
    if (identity.uuid === owner.uuid) return true;
    const user = await this.user(identity.uuid);
    return !user || user.status === "active";
  }
  async requireAdmin(identity) {
    const role = await this.role(identity);
    if (role !== "owner" && role !== "admin")
      fail(403, "Only organization administrators can do this.");
    return role;
  }
  // Active administrators, read once a minute per instance rather than
  // listing every person for each alert. Saving anyone here reads it again.
  async adminIds() {
    const hit = this.instance.adminIds;
    if (hit && this.now() - hit.at < 60_000 && this.now() >= hit.at)
      return hit.list;
    const list = (await this.list("org:user:"))
      .map((r) => r.value)
      .filter((u) => u.role === "admin" && u.status === "active")
      .map((u) => u.uuid);
    this.instance.adminIds = { list, at: this.now() };
    return list;
  }
  async saveUser(user) {
    this.instance.adminIds = null;
    this.instance.users.set(user.uuid, {
      value: structuredClone(user),
      at: this.now(),
    });
    await this.kv.set("org:user:" + user.uuid, user);
    if (user.email)
      await this.kv.set("org:email:" + (await hash(user.email)), user.uuid);
  }
  // Record activity at most once per hour per user per worker instance.
  async touch(identity) {
    if (identity.apiKey) return;
    const now = this.now(),
      key = identity.uuid,
      last = this.instance.touched.get(key);
    if (last && now - last < 3600_000 && day(last) === day(now)) return;
    if (this.instance.touched.size > 5000) this.instance.touched.clear();
    this.instance.touched.set(key, now);
    try {
      const daily = `org:dayuser:${day(now)}:${key}`;
      const first = await this.kv.incr(daily);
      if (first === 1) {
        await this.kv.incr(`org:daycount:${day(now)}`);
        // Only the day's count is kept; each person's mark for it is not.
        await this.kv.expire(daily, 2 * 86400).catch(() => {});
      }
      const user = await this.user(key);
      if (key === (await this.accountOwner()).uuid)
        // The account owner is not a member; keep its activity apart.
        await this.kv.set("org:owner:lastActive", now);
      else if (user) {
        // Activity has its own key: writing back this instance's cached copy
        // of the record could undo a role or status change made elsewhere.
        await this.kv.set("org:seen:" + key, now);
        if (identity.username && user.username !== identity.username) {
          const fresh = await this.kv.get("org:user:" + key);
          if (fresh)
            await this.saveUser({ ...fresh, username: identity.username });
        }
      }
    } catch {
      /* Usage statistics never block collaboration. */
    }
  }
  // Member records. The account owner may have one too, holding only its
  // verified email and preferences; it is never listed as a member.
  async members() {
    const owner = (await this.accountOwner()).uuid;
    return (await this.list("org:user:"))
      .map((r) => r.value)
      .filter((u) => u.uuid !== owner);
  }
  // User records with their latest recorded activity.
  async withActivity(users) {
    const seen = new Map(
      (await this.list("org:seen:")).map((r) => [
        r.key.slice("org:seen:".length),
        Number(r.value) || 0,
      ]),
    );
    return users.map((u) =>
      (seen.get(u.uuid) || 0) > (u.lastActive || 0)
        ? { ...u, lastActive: seen.get(u.uuid) }
        : u,
    );
  }
  async audit(actor, action, target = {}, details = {}) {
    const at = this.now(),
      iso = new Date(at).toISOString(),
      entry = {
        id: `${iso}:${rand()}`,
        at,
        time: iso,
        category: auditCategory(action),
        action,
        actor: actor
          ? { uuid: actor.uuid || null, username: actor.username || null }
          : { uuid: null, username: "system" },
        target: {
          type: target.type || null,
          id: target.id || null,
          name:
            typeof target.name === "string" ? target.name.slice(0, 200) : null,
        },
        board: target.board || (target.type === "board" ? target.id : null),
        details,
        ip:
          this.request?.headers.get("cf-connecting-ip") ||
          this.request?.headers.get("x-forwarded-for")?.split(",")[0] ||
          null,
        userAgent:
          this.request?.headers.get("user-agent")?.slice(0, 300) || null,
      };
    try {
      await this.kv.set("org:audit:" + entry.id, entry);
      if (entry.board)
        await this.kv.set(`org:bact:${entry.board}:${entry.id}`, {
          id: entry.id,
          at,
          action,
          actor: entry.actor,
          details,
        });
      this.pending.push(entry);
    } catch {
      /* Auditing failures are retried through the next write. */
    }
    return entry;
  }
  async registerBoard(room, patch) {
    const key = "org:board:" + room,
      existing = await this.kv.get(key);
    let next;
    // Activity, counts and settings update the same record at once. Writing
    // only the patched fields keeps one request from restoring what another
    // just changed, such as making a private board visible again.
    if (existing && typeof this.kv.update === "function")
      next = await this.kv.update(
        key,
        Object.fromEntries(
          Object.entries(patch).map(([field, value]) => [
            `["${field}"]`,
            value ?? null,
          ]),
        ),
      );
    else {
      next = { ...(existing || { room, created: this.now() }), ...patch, room };
      await this.kv.set(key, next);
    }
    if (!existing || "visibility" in patch || "deleted" in patch) {
      if (next.visibility === "organization" && !next.deleted)
        await this.kv.set("org:visible:" + room, 1);
      else await this.kv.del("org:visible:" + room);
    }
    return next;
  }
  // Largest simultaneous session per board and per day, for capacity reports.
  async recordPeak(room, count) {
    const peaks = (this.caches.peaks ??= new Map()),
      today = day(this.now()),
      key = `${room}|${today}`;
    if ((peaks.get(key) || 0) >= count) return;
    if (peaks.size > 5000) peaks.clear();
    peaks.set(key, count);
    try {
      if (count > (Number(await this.kv.get("org:peak:" + today)) || 0))
        await this.kv.set(
          "org:peak:" + today,
          count,
          Math.floor((this.now() + 400 * DAY) / 1000),
        );
      const board = await this.kv.get("org:board:" + room);
      if (board && (board.peakParticipants || 0) < count)
        await this.registerBoard(room, {
          peakParticipants: count,
          peakAt: this.now(),
        });
    } catch {
      /* Usage statistics never block collaboration. */
    }
  }
  // Time spent on boards, from presence heartbeats (at most a minute each).
  // Seconds accumulate in memory and are written at most once a minute.
  async recordTime(ms, { flush = false } = {}) {
    const seconds = Math.round(Math.min(60_000, ms) / 1000);
    const time = this.instance.time;
    if (seconds > 0) time.seconds += seconds;
    time.since ||= this.now();
    if (!time.seconds || (!flush && this.now() - time.since < 60_000)) return;
    const amount = time.seconds;
    time.seconds = 0;
    time.since = this.now();
    try {
      await this.kv.incr(`org:time:${day(this.now())}`, amount);
    } catch {
      time.seconds += amount;
    }
  }
  async indexMembership(uuid, room, role) {
    if (role && role !== "removed")
      await this.kv.set(`org:ub:${uuid}:${room}`, role);
    else await this.kv.del(`org:ub:${uuid}:${room}`);
  }
  async notify(uuid, notification) {
    if (!uuid) return;
    // Deactivated people receive nothing, in the app or by email.
    if ((await this.user(uuid))?.status === "deactivated") return;
    const at = this.now(),
      iso = new Date(at).toISOString(),
      entry = {
        id: `${iso}:${rand()}`,
        at,
        read: false,
        ...notification,
      };
    await this.kv.set(
      `org:notif:${uuid}:${entry.id}`,
      entry,
      Math.floor((at + 90 * DAY) / 1000),
    );
    this.pendingNotifications ??= [];
    this.pendingNotifications.push({ uuid, entry });
    return entry;
  }
  // Delivery that can happen after the response is decided: SIEM, webhooks,
  // alerts, email, and retention housekeeping. Nothing here can fail a request.
  async flush() {
    const events = this.pending.splice(0);
    const notifications = (this.pendingNotifications || []).splice(0);
    if (!events.length && !notifications.length) return;
    let policy;
    try {
      policy = await this.policy();
    } catch {
      return;
    }
    await deliver(this, policy, events, notifications).catch(() => {});
  }
  async info(identity) {
    const [meta, owner, role] = await Promise.all([
      this.meta(),
      this.accountOwner(),
      this.role(identity),
    ]);
    const policy = meta?.policy || normalizePolicy();
    const user = await this.user(identity.uuid);
    return {
      configured: !!meta,
      name: policy.name || null,
      role,
      owner: owner.uuid,
      user: user
        ? {
            email: user.email || null,
            emailVerified: !!user.emailVerified,
            status: user.status,
            teams: user.teams || [],
            prefs: user.prefs || {},
          }
        : null,
      // The subset of policy clients need to shape their interface.
      policy: {
        ai: policy.ai,
        integrations: Object.fromEntries(
          Object.entries(policy.integrations).map(([k, v]) => [
            k,
            { enabled: !!v.enabled },
          ]),
        ),
        externalSharing: policy.externalSharing,
        guestAccess: policy.guestAccess,
        restrictToOrganization: policy.restrictToOrganization,
        publicLinks: policy.publicLinks,
        membersCanCreate: policy.membersCanCreate,
        defaultVisibility: policy.defaultVisibility,
        domains: policy.domains,
        domainCapture: policy.domainCapture,
      },
    };
  }
  // Whether this identity may create boards on the organization's worker.
  async canCreate(identity) {
    const role = await this.role(identity);
    if (role === "owner" || role === "admin") return true;
    if (role !== "member") return false;
    return (await this.policy()).membersCanCreate;
  }
  async scheduledWork() {
    const now = this.now();
    if (now - this.caches.purged > 3600_000) {
      this.caches.purged = now;
      const { more } = await purge(this).catch(() => ({}));
      // A backlog of expired records is worked through every five minutes.
      if (more) this.caches.purged = now - 3600_000 + 300_000;
    }
    if (now - this.caches.reported > 3600_000) {
      this.caches.reported = now;
      await sendScheduledReport(this).catch(() => {});
    }
  }
}
