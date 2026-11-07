import { DAY, administers, publicHost } from "./org.js";
import { commentExcerpt } from "../src/comments.js";
// Outbound delivery for organization events: SIEM export, signed webhooks,
// security alerts, and notification email. Every function here is best effort
// and bounded; the caller has already made the change durable.
// Board-level activity worth surfacing to administrators immediately.
export const ALERTS = {
  "board.visibility.link": "publicSharing",
  "board.guest.joined": "guestAccess",
  "board.role.changed": "permissionChanges",
  "user.role.changed": "permissionChanges",
  "apikey.created": "permissionChanges",
  "policy.updated": "policyChanges",
};
const TIMEOUT = 5000;
const tokens = new Map();
const signal = () => AbortSignal.timeout(TIMEOUT);
const ALERT_TEXT = {
  "board.visibility.link": "A board was opened to anyone with the link",
  "board.guest.joined": "A guest joined a board",
  "board.role.changed": "Board permissions changed",
  "user.role.changed": "An organization role changed",
  "apikey.created": "An API key was created",
  "policy.updated": "Organization policy changed",
};
const ALERT_TEXT_FR = {
  "board.visibility.link":
    "Un tableau a été ouvert à toute personne ayant le lien",
  "board.guest.joined": "Un invité s’est joint à un tableau",
  "board.role.changed": "Les autorisations d’un tableau ont changé",
  "user.role.changed": "Un rôle dans l’organisation a changé",
  "apikey.created": "Une clé d’API a été créée",
  "policy.updated": "La politique de l’organisation a changé",
};
// Email goes out in both official languages, English first, as Government
// of Canada correspondence does; the worker does not know each reader's
// language.
export const bilingualSubject = (en, fr) => `${en} / ${fr}`;
export const bilingualBody = (en, fr) =>
  `(Le français suit.)\n\n${en}\n\n---\n\n${fr}`;
export async function deliver(org, policy, events, notifications) {
  // Export at most every few seconds per worker instance; the cursor picks
  // up anything written meanwhile on the next request.
  const exportNow =
    policy.siem.mode !== "none" &&
    org.now() - org.instance.siem >= org.siemInterval;
  if (exportNow) org.instance.siem = org.now();
  await Promise.allSettled([
    exportNow ? siem(org, policy) : null,
    webhooks(org, policy, events),
    alerts(org, policy, events),
    notificationMail(org, notifications),
    boardSlack(org, policy, notifications),
  ]);
}
// Microsoft Sentinel and other SIEM tools ingest a normalized flat record.
export function siemRecord(entry) {
  return {
    TimeGenerated: entry.time,
    EventId: entry.id,
    Category: entry.category,
    Action: entry.action,
    ActorId: entry.actor?.uuid || "",
    ActorName: entry.actor?.username || "",
    TargetType: entry.target?.type || "",
    TargetId: entry.target?.id || "",
    TargetName: entry.target?.name || "",
    BoardId: entry.board || "",
    SourceIp: entry.ip || "",
    UserAgent: entry.userAgent || "",
    Details: entry.details || {},
  };
}
// Read audit records written after the stored cursor, so records written by
// other worker instances are exported too. Records are read by the narrowest
// time prefix that keeps listings few: a recent cursor rereads at most the
// minute it falls in, not the whole day.
export async function unsentAudit(org, cursor, limit = 500, skip = null) {
  const now = org.now() + 1000;
  const resume = cursor ? Date.parse(cursor.slice(0, 24)) : NaN;
  const start = Number.isFinite(resume) ? resume : now - DAY;
  const span = now - start;
  const [size, step] =
    span <= 10 * 60_000
      ? [16, 60_000]
      : span <= 2 * DAY
        ? [13, 3_600_000]
        : [10, DAY];
  const rows = [];
  let previous = null;
  for (let at = start; rows.length < limit; at += step) {
    const part = new Date(Math.min(at, now)).toISOString().slice(0, size);
    if (part !== previous)
      await org.scan("org:audit:" + part, {}, (row) => {
        const id = row.key.slice("org:audit:".length);
        if ((!cursor || id > cursor) && !skip?.has(id)) rows.push(row.value);
        return rows.length >= limit;
      });
    previous = part;
    if (at >= now) break;
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}
// An audit record's id is its time, taken before it is written, so a record
// can land after a later one was exported. Each export rereads the minute
// before its cursor and skips the records it already sent. At most
// SIEM_RECENT sent ids are kept; once a burst fills them, the reread starts
// at the oldest id kept, so ids it forgot are never sent again and cannot
// fill every batch and hold the cursor in place.
const SIEM_OVERLAP = 60_000;
const SIEM_RECENT = 2000;
const overlapStart = (id) =>
  new Date(Date.parse(id.slice(0, 24)) - SIEM_OVERLAP).toISOString();
export async function siem(org, policy, { force = false } = {}) {
  const mode = policy.siem.mode;
  if (mode === "none") return { sent: 0 };
  const [cursor, recent] = await Promise.all([
    org.kv.get("org:siem:cursor"),
    org.kv.get("org:siem:recent"),
  ]);
  // A cursor saved before recent records were kept resumes after itself.
  const sent = new Set(recent || []);
  const from =
    cursor && recent
      ? recent.length >= SIEM_RECENT && recent[0] > overlapStart(cursor)
        ? recent[0]
        : overlapStart(cursor)
      : cursor;
  const rows = await unsentAudit(org, from, 500, sent);
  if (!rows.length && !force) return { sent: 0 };
  const categories = new Set(policy.siem.categories);
  const records = rows
    .filter((r) => categories.has(r.category))
    .map(siemRecord);
  const status = (await org.kv.get("org:siem:status")) || { sent: 0 };
  try {
    if (records.length || force) {
      // A test always includes its own record, after any waiting events.
      const batch = [
        ...records,
        ...(force
          ? [
              siemRecord({
                id: `${new Date(org.now()).toISOString()}:test`,
                time: new Date(org.now()).toISOString(),
                category: "admin",
                action: "siem.test",
                actor: { username: "system" },
              }),
            ]
          : []),
      ];
      if (mode === "sentinel") await sentinel(org, policy, batch);
      else await https(org, policy, batch);
      status.sent += batch.length;
    }
    if (rows.length) {
      const next = [cursor, rows.at(-1).id].filter(Boolean).sort().at(-1);
      const start = overlapStart(next);
      await org.kv.set(
        "org:siem:recent",
        [...sent, ...rows.map((r) => r.id)]
          .filter((id) => id > start)
          .sort()
          .slice(-SIEM_RECENT),
      );
      await org.kv.set("org:siem:cursor", next);
    } else if (cursor && !recent) await org.kv.set("org:siem:recent", []);
    status.lastSuccess = org.now();
    status.lastError = null;
    await org.kv.set("org:siem:status", status);
    return { sent: records.length };
  } catch (error) {
    status.lastError = String(error.message || error).slice(0, 300);
    status.lastErrorAt = org.now();
    await org.kv.set("org:siem:status", status);
    if (force) throw error;
    return { sent: 0, error: status.lastError };
  }
}
async function sentinelToken(org, config) {
  const secret = await org.secret("sentinel");
  if (!secret) throw Error("Add the Sentinel client secret.");
  const key = `${config.tenantId}|${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > org.now() + 60_000) return cached.token;
  const res = await org.fetcher(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: secret,
        scope: "https://monitor.azure.com//.default",
        grant_type: "client_credentials",
      }),
      signal: signal(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token)
    throw Error(
      `Microsoft Entra sign-in failed (${res.status}): ${data.error || "no token"}`,
    );
  tokens.set(key, {
    token: data.access_token,
    expires: org.now() + (Number(data.expires_in) || 3000) * 1000,
  });
  return data.access_token;
}
// Azure Monitor Logs Ingestion API, the documented path into Sentinel tables.
async function sentinel(org, policy, records) {
  const config = policy.siem.sentinel;
  if (
    !config.tenantId ||
    !config.clientId ||
    !config.endpoint ||
    !config.dcrId ||
    !config.stream
  )
    throw Error("Complete the Sentinel connection settings.");
  const token = await sentinelToken(org, config);
  // The ingestion API accepts up to 1 MB per call.
  for (let n = 0; n < records.length; n += 200) {
    const res = await org.fetcher(
      `${config.endpoint}/dataCollectionRules/${encodeURIComponent(config.dcrId)}/streams/${encodeURIComponent(config.stream)}?api-version=2023-01-01`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(records.slice(n, n + 200)),
        signal: signal(),
      },
    );
    if (!res.ok) throw Error(`Sentinel ingestion failed (${res.status}).`);
  }
}
async function https(org, policy, records) {
  if (!policy.siem.url) throw Error("Add the SIEM HTTPS endpoint.");
  // Endpoints saved before private addresses were refused are checked here.
  if (!publicHost(new URL(policy.siem.url).hostname))
    throw Error("The SIEM endpoint must use a public internet address.");
  const token = await org.secret("siem-token");
  const res = await org.fetcher(policy.siem.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ source: "whiteboard", events: records }),
    redirect: "error",
    signal: signal(),
  });
  if (!res.ok) throw Error(`SIEM endpoint returned ${res.status}.`);
}
export async function hmac(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export const hookMatches = (hook, action) =>
  hook.events.includes("*") ||
  hook.events.some((e) => action === e || action.startsWith(e + "."));
export async function sendHook(org, hook, entry) {
  if (!publicHost(new URL(hook.url).hostname))
    throw Error("Webhooks must use a public internet address.");
  const secret = await org.kv.get("org:hooksecret:" + hook.id);
  // Every webhook has a secret, so none means it was deleted, which another
  // instance may not know yet; deliveries are always signed.
  if (!secret) {
    if (!(await org.kv.get("org:webhook:" + hook.id))) return;
    throw Error("The webhook secret is not available yet.");
  }
  const body = JSON.stringify({
    id: entry.id,
    event: entry.action,
    created: entry.time,
    data: entry,
  });
  const res = await org.fetcher(hook.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Whiteboard-Webhooks/1",
      "X-Whiteboard-Event": entry.action,
      "X-Whiteboard-Delivery": entry.id,
      "X-Whiteboard-Signature": "sha256=" + (await hmac(secret, body)),
    },
    body,
    signal: signal(),
    redirect: "error",
  });
  if (!res.ok) throw Error(`Webhook returned ${res.status}.`);
}
// Like an API key, a webhook ends with its maker's administration. One made
// with an API key belongs to the administrator who made that key; an older
// one that does not record them is traced through the key, if it remains.
async function activeHooks(org) {
  const hooks = (await org.list("org:webhook:")).map((r) => r.value);
  let keys = null;
  const current = async (maker) => {
    if (!maker) return true;
    if (maker.startsWith("apikey-")) {
      keys ??= org
        .list("org:apikey:")
        .then((rows) => new Map(rows.map(({ value }) => [value.id, value])));
      const key = (await keys).get(maker.slice("apikey-".length));
      if (!key) return false;
      if (!key.createdBy) return true;
      maker = key.createdBy;
    }
    return administers(org, maker);
  };
  const kept = await Promise.all(
    hooks.map((h) => current(h.admin || h.createdBy)),
  );
  return hooks.filter((_, n) => kept[n]);
}
async function webhooks(org, policy, events) {
  if (!policy.integrations.webhooks.enabled) return;
  // The subscription list is cached for a minute per worker instance.
  const cache = org.instance.hooks;
  const hooks =
    cache && org.now() - cache.at < 60_000
      ? cache.list
      : await activeHooks(org);
  if (!cache || cache.list !== hooks)
    org.instance.hooks = { list: hooks, at: org.now() };
  const now = org.now();
  // Deliveries run in parallel, so a slow receiver adds its timeout once per
  // request rather than once per event. One request sends at most 20; the
  // rest wait in the retry queue, which later requests send a few at a
  // time, so an edit with thousands of comments never opens thousands of
  // connections. Each carries its id and time.
  const queue = (hook, entry, attempts = 1, next = now + 60_000) =>
    org.kv.set(`org:hookq:${hook.id}:${entry.id}`, {
      hook: hook.id,
      entry,
      attempts,
      next,
    });
  const jobs = hooks
    .filter((h) => h.enabled)
    .flatMap((hook) =>
      events
        .filter((e) => hookMatches(hook, e.action))
        .map((entry) => [hook, entry]),
    );
  for (const [n, [hook, entry]] of jobs.entries()) {
    if (n < 20) await sendHook(org, hook, entry).catch(() => queue(hook, entry));
    else await queue(hook, entry, 0, now);
  }
  // Retry earlier failures with exponential backoff, a few per webhook so an
  // unreachable receiver never holds up the others. A receiver that has been
  // failing for a day loses its queued events.
  const stale = new Date(now - DAY).toISOString();
  await Promise.all(
    hooks
      .filter((h) => h.enabled)
      .map(async (hook) => {
        const prefix = `org:hookq:${hook.id}:`;
        const queued = await org.list(prefix, { limit: 10 });
        if (queued[0] && queued[0].key.slice(prefix.length) < stale) {
          for (const row of await org.list(prefix, { values: false })) {
            const key = typeof row === "string" ? row : row.key;
            if (key.slice(prefix.length) < stale) await org.kv.del(key);
          }
          return;
        }
        await Promise.all(
          queued
            .filter(({ value }) => value.next <= now)
            .map(async ({ key, value }) => {
              try {
                await sendHook(org, hook, value.entry);
                await org.kv.del(key);
              } catch (error) {
                // Six attempts in all: the first send and five retries.
                if (value.attempts >= 5) await org.kv.del(key);
                else
                  await org.kv.set(key, {
                    ...value,
                    attempts: value.attempts + 1,
                    next: now + 60_000 * 2 ** value.attempts,
                    error: String(error.message).slice(0, 200),
                  });
              }
            }),
        );
      }),
  );
}
export async function slack(org, url, text) {
  if (!url || !/^https:\/\/hooks\.slack\.com\//.test(url)) return;
  await org.fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Slack reads <...> as links and mentions such as <!channel>; text
    // people wrote is escaped so it shows as written.
    body: JSON.stringify({
      text: text
        .slice(0, 3000)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    }),
    signal: signal(),
  });
}
export async function mail(org, to, subject, body) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length || !org.puter.email?.sendTransactional) return;
  await org.puter.email.sendTransactional({
    to: recipients.slice(0, 10),
    subject: subject.slice(0, 200),
    text: body,
  });
}
// Notification mail goes out while the edit that caused it waits for its
// acknowledgement, so a slow mail service delays saving only so long.
const NOTIFICATION_MAIL_WAIT = 5000;
function describe(entry, french = false) {
  const who = entry.actor?.username || (french ? "Quelqu’un" : "Someone");
  const name = entry.target?.name;
  const what = name ? (french ? ` « ${name} »` : ` "${name}"`) : "";
  const label = (french ? ALERT_TEXT_FR : ALERT_TEXT)[entry.action];
  return `${label || entry.action}${french ? " :" : ":"} ${who}${what} (${entry.time})`;
}
async function alerts(org, policy, events) {
  const matching = events.filter(
    (e) => ALERTS[e.action] && policy.alerts[ALERTS[e.action]],
  );
  if (!matching.length) return;
  const lines = matching.map((e) => describe(e)).join("\n");
  const admins = [(await org.accountOwner()).uuid, ...(await org.adminIds())];
  for (const entry of matching)
    for (const uuid of new Set(admins))
      await org
        .notify(uuid, {
          type: "alert",
          action: entry.action,
          board: entry.board,
          text: describe(entry),
          // The app words the alert in each person's language.
          label: ALERT_TEXT[entry.action] || entry.action,
          who: entry.actor?.username || null,
          ...(entry.target?.name ? { target: entry.target.name } : {}),
        })
        .catch(() => {});
  await Promise.allSettled([
    mail(
      org,
      policy.alerts.emails,
      bilingualSubject(
        `Whiteboard security alert: ${ALERT_TEXT[matching[0].action] || matching[0].action}`,
        `Alerte de sécurité Whiteboard : ${ALERT_TEXT_FR[matching[0].action] || matching[0].action}`,
      ),
      bilingualBody(
        `${lines}\n\nReview the audit log in Organization settings.`,
        `${matching.map((e) => describe(e, true)).join("\n")}\n\nConsultez le journal d’audit dans les paramètres de l’organisation.`,
      ),
    ),
    policy.alerts.slack && policy.integrations.slack.enabled
      ? org.secret("slack").then((url) => slack(org, url, lines))
      : null,
  ]);
}
// A notification in both languages, from the parts it carries.
function notificationWords(entry) {
  // Long board titles are shortened so both halves of the subject fit.
  const title = entry.boardTitle || "";
  // An anonymous contribution names no one, in either language.
  const who = entry.anonymous ? "A participant" : entry.actor?.username || "",
    whoFr = entry.anonymous ? "Un participant" : who,
    board =
      title.length > 60 ? `${commentExcerpt(title, 59).trimEnd()}…` : title;
  const subjects = {
    mention: [
      `${who} mentioned you on ${board}`,
      `${whoFr} vous a mentionné dans ${board}`,
    ],
    reply: [`${who} replied on ${board}`, `${whoFr} a répondu dans ${board}`],
    assignment: entry.more
      ? [
          `${who} assigned you tasks on ${board}`,
          `${whoFr} vous a assigné des tâches dans ${board}`,
        ]
      : [
          `${who} assigned you a task on ${board}`,
          `${whoFr} vous a assigné une tâche dans ${board}`,
        ],
  }[entry.type];
  const more = entry.more > 0 ? entry.more : 0;
  const text =
    entry.type === "assignment" && typeof entry.title === "string"
      ? [
          `${who}: ${entry.title}${entry.due ? ` (due ${entry.due})` : ""}${more ? ` and ${more} more` : ""}`,
          `${whoFr} : ${entry.title === "Untitled task" ? "Tâche sans titre" : entry.title}${entry.due ? ` (échéance le ${entry.due})` : ""}${more ? ` et ${more} ${more === 1 ? "autre" : "autres"}` : ""}`,
        ]
      : typeof entry.excerpt === "string"
        ? [`${who}: ${entry.excerpt}`, `${whoFr} : ${entry.excerpt}`]
        : [entry.text || "", entry.text || ""];
  const fallback = [
    entry.subject || "You have a new Whiteboard notification",
    "Vous avez une nouvelle notification Whiteboard",
  ];
  const [subjectEn, subjectFr] = who && subjects ? subjects : fallback;
  return {
    en: { subject: subjectEn, text: text[0] },
    fr: { subject: subjectFr, text: text[1] },
  };
}
// Each person's mail is sent at once rather than one after another.
async function notificationMail(org, notifications) {
  await Promise.allSettled(
    notifications.map(async ({ uuid, entry }) => {
      if (!["mention", "reply", "assignment"].includes(entry.type)) return;
      const user = await org.user(uuid);
      if (!user?.email || !user.emailVerified) return;
      if (user.prefs?.emailNotifications === false) return;
      const { en, fr } = notificationWords(entry);
      const link = entry.url ? `\n\n${entry.url}` : "";
      let timer;
      await Promise.race([
        mail(
          org,
          user.email,
          bilingualSubject(en.subject, fr.subject),
          bilingualBody(`${en.text}${link}`, `${fr.text}${link}`),
        ),
        new Promise(
          (resolve) => (timer = setTimeout(resolve, NOTIFICATION_MAIL_WAIT)),
        ),
      ]).finally(() => clearTimeout(timer));
    }),
  );
}
// Whoever connected a board's channel still owns the board and can use
// the organization, or administers it.
async function connectorManages(org, room, uuid) {
  if (await administers(org, uuid)) return true;
  const meta = await org.kv.get(`wb:${room}:meta`);
  return meta?.owner === uuid && !!(await org.role({ uuid }));
}
async function boardSlack(org, policy, notifications) {
  if (!policy.integrations.slack.enabled) return;
  const seen = new Set();
  for (const { entry } of notifications) {
    if (!entry.board || !entry.channel || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const key = "org:boardslack:" + entry.board,
      value = await org.kv.get(key);
    // Channels connected before the connector was recorded are plain URLs.
    const url = typeof value === "string" ? value : value?.url;
    if (!url) continue;
    if (value?.by && !(await connectorManages(org, entry.board, value.by))) {
      await org.kv.del(key);
      continue;
    }
    await slack(org, url, entry.text || "").catch(() => {});
  }
}
