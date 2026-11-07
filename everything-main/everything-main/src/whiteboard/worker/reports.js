import { DAY, currentGuests } from "./org.js";
import { bilingualBody, bilingualSubject, mail } from "./delivery.js";

const date = (at) => new Date(at).toISOString().slice(0, 10);
async function series(org, prefix, days) {
  const now = org.now(),
    dates = Array.from({ length: days }, (_, n) =>
      date(now - (days - 1 - n) * DAY),
    );
  const values = [];
  for (let n = 0; n < dates.length; n += 20)
    values.push(
      ...(await Promise.all(
        dates
          .slice(n, n + 20)
          .map((d) => org.kv.get(prefix + d).then((v) => Number(v) || 0)),
      )),
    );
  return dates.map((d, n) => ({ date: d, value: values[n] }));
}
// Administrative reporting: adoption, ownership, sharing, and session size.
// The inactive people listed are capped, so the report stays small, unless
// `allInactive` asks for every one, as the inactive users export does.
export async function computeReports(
  org,
  { days = 30, allInactive = false } = {},
) {
  days = Math.max(7, Math.min(180, Number(days) || 30));
  const now = org.now();
  const [users, boards, owner, ownerActive, policy] = await Promise.all([
    org.members().then((rows) => org.withActivity(rows)),
    org.list("org:board:").then((rows) => rows.map((r) => r.value)),
    org.accountOwner(),
    org.kv.get("org:owner:lastActive"),
    org.policy(),
  ]);
  const active30 = (u) => u.lastActive && u.lastActive > now - 30 * DAY;
  const inactive = users.filter((u) => u.status === "active" && !active30(u));
  const byOwner = new Map();
  for (const b of boards.filter((b) => !b.deleted))
    byOwner.set(b.owner, (byOwner.get(b.owner) || 0) + 1);
  const names = new Map(users.map((u) => [u.uuid, u.username || u.email]));
  names.set(owner.uuid, owner.username);
  const live = boards.filter((b) => !b.deleted);
  // Boards with guests or a public link; the report lists the 50 with the
  // most guests and counts them all.
  const outside = live.filter(
    (b) => currentGuests(b, now, policy) > 0 || b.visibility === "link",
  );
  const weeks = Array.from({ length: 12 }, (_, n) => {
    const end = now - (11 - n) * 7 * DAY,
      start = end - 7 * DAY;
    return {
      week: date(start),
      created: boards.filter((b) => b.created > start && b.created <= end)
        .length,
    };
  });
  const feedback = (
    await org.list("org:feedback:", { reverse: true, limit: 2000 })
  )
    .map((r) => r.value)
    .filter((f) => f.at > now - days * DAY);
  const distribution = [1, 2, 3, 4, 5].map(
    (score) => feedback.filter((f) => f.ease === score).length,
  );
  return {
    generated: now,
    feedback: {
      responses: feedback.length,
      averageEase: feedback.length
        ? Math.round(
            (feedback.reduce((n, f) => n + f.ease, 0) / feedback.length) * 10,
          ) / 10
        : null,
      distribution,
      recent: feedback
        .filter((f) => f.comment)
        .slice(0, 20)
        .map((f) => ({
          at: f.at,
          ease: f.ease,
          role: f.role,
          comment: f.comment,
          ...(f.lang !== undefined ? { lang: f.lang } : {}),
          ...(f.textRuns?.length
            ? { textRuns: structuredClone(f.textRuns) }
            : {}),
        })),
    },
    days,
    users: {
      total: users.length + 1,
      active: users.filter((u) => u.status === "active").length + 1,
      deactivated: users.filter((u) => u.status === "deactivated").length,
      pending: users.filter((u) => u.status === "pending").length,
      // Guests and administrators who can still sign in: a deactivated one
      // is counted with the deactivated, not twice.
      guests: users.filter(
        (u) => u.role === "guest" && u.status !== "deactivated",
      ).length,
      admins:
        users.filter((u) => u.role === "admin" && u.status !== "deactivated")
          .length + 1,
      // Only accounts that can still sign in count as active.
      activeLast30Days:
        users.filter((u) => u.status === "active" && active30(u)).length +
        (Number(ownerActive) > now - 30 * DAY ? 1 : 0),
      inactiveCount: inactive.length,
      inactive: (allInactive === true ? inactive : inactive.slice(0, 5000)).map(
        (u) => ({
          uuid: u.uuid,
          username: u.username || null,
          email: u.email || null,
          lastActive: u.lastActive || null,
        }),
      ),
    },
    usage: {
      dailyActiveUsers: await series(org, "org:daycount:", days),
      peakConcurrent: await series(org, "org:peak:", days),
      minutesPerDay: (await series(org, "org:time:", days)).map((d) => ({
        date: d.date,
        value: Math.round(d.value / 60),
      })),
    },
    boards: {
      total: live.length,
      archived: live.filter((b) => b.archived).length,
      deleted: boards.filter((b) => b.deleted).length,
      activeLast30Days: live.filter((b) => b.lastActivity > now - 30 * DAY)
        .length,
      stale: live.filter((b) => (b.lastActivity || b.created) < now - 90 * DAY)
        .length,
      empty: live.filter((b) => !b.objectCount).length,
      createdByWeek: weeks,
      topOwners: [...byOwner]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([uuid, count]) => ({
          uuid,
          username: names.get(uuid) || null,
          count,
        })),
      largest: [...live]
        .sort((a, b) => (b.objectCount || 0) - (a.objectCount || 0))
        .slice(0, 10)
        .map((b) => ({
          room: b.room,
          title: b.title,
          objects: b.objectCount || 0,
        })),
    },
    sharing: {
      organizationVisible: live.filter((b) => b.visibility === "organization")
        .length,
      publicLinks: live.filter((b) => b.visibility === "link").length,
      withGuests: live.filter((b) => currentGuests(b, now, policy) > 0).length,
      guestMemberships: live.reduce(
        (n, b) => n + currentGuests(b, now, policy),
        0,
      ),
      sharedOutside: outside.length,
      boardsWithGuests: outside
        .sort(
          (a, b) =>
            currentGuests(b, now, policy) - currentGuests(a, now, policy),
        )
        .slice(0, 50)
        .map((b) => ({
          room: b.room,
          title: b.title,
          guests: currentGuests(b, now, policy),
          visibility: b.visibility || "private",
        })),
    },
    sessions: {
      largest: [...live]
        .filter((b) => b.peakParticipants)
        .sort((a, b) => b.peakParticipants - a.peakParticipants)
        .slice(0, 10)
        .map((b) => ({
          room: b.room,
          title: b.title,
          participants: b.peakParticipants,
          at: b.peakAt || null,
        })),
      sessionsOver50: live.filter((b) => b.peakParticipants >= 50).length,
    },
  };
}
export function reportSummary(report, french = false) {
  // Today has only started, so the average covers the full days before it.
  const dau = report.usage.dailyActiveUsers.slice(0, -1);
  const avg = dau.length
    ? Math.round(dau.reduce((n, d) => n + d.value, 0) / dau.length)
    : 0;
  const date = new Date(report.generated).toISOString().slice(0, 10);
  if (french)
    return [
      `Rapport de l’organisation Whiteboard (${date})`,
      "",
      `Personnes : ${report.users.active} actives, ${report.users.deactivated} désactivées, ${report.users.guests} invitées`,
      `Actives au cours des 30 derniers jours : ${report.users.activeLast30Days}; inactives : ${report.users.inactiveCount ?? report.users.inactive.length}`,
      `Moyenne quotidienne de personnes actives (${Math.max(1, report.days - 1)} jours complets) : ${avg}`,
      `Tableaux : ${report.boards.total} au total, ${report.boards.activeLast30Days} actifs, ${report.boards.stale} inactifs, ${report.boards.empty} vides`,
      `Partage : ${report.sharing.organizationVisible} visibles dans l’organisation, ${report.sharing.publicLinks} liens publics, ${report.sharing.withGuests} avec invités`,
      `Plus grande séance : ${report.sessions.largest[0]?.participants || 0} participants`,
    ].join("\n");
  return [
    `Whiteboard organization report (${date})`,
    "",
    `Users: ${report.users.active} active, ${report.users.deactivated} deactivated, ${report.users.guests} guests`,
    `Active in the last 30 days: ${report.users.activeLast30Days}; inactive: ${report.users.inactiveCount ?? report.users.inactive.length}`,
    `Average daily active users (${Math.max(1, report.days - 1)} full days): ${avg}`,
    `Boards: ${report.boards.total} total, ${report.boards.activeLast30Days} active, ${report.boards.stale} stale, ${report.boards.empty} empty`,
    `Sharing: ${report.sharing.organizationVisible} organization-visible, ${report.sharing.publicLinks} public links, ${report.sharing.withGuests} with guests`,
    `Largest session: ${report.sessions.largest[0]?.participants || 0} participants`,
  ].join("\n");
}
export async function sendScheduledReport(org) {
  const policy = await org.policy();
  const { schedule, emails } = policy.reports;
  if (schedule === "none" || !emails.length) return false;
  const last = Number(await org.kv.get("org:report:last")) || 0;
  const interval = schedule === "weekly" ? 7 * DAY : 30 * DAY;
  if (org.now() - last < interval) return false;
  // Claimed first so other instances do not send it too: two instances
  // that read the same last send race for one claim, and only the first
  // wins. A failed send releases the claim, so the next check tries again.
  const claim = `org:report:claim:${last}`;
  if ((await org.kv.incr(claim)) !== 1) return false;
  await org.kv.expire?.(claim, 60 * 86400).catch?.(() => {});
  await org.kv.set("org:report:last", org.now());
  try {
    const report = await computeReports(org, {
      days: schedule === "weekly" ? 7 : 30,
    });
    await mail(
      org,
      emails,
      bilingualSubject(
        `Whiteboard ${schedule} organization report`,
        `Rapport ${schedule === "weekly" ? "hebdomadaire" : "mensuel"} de l’organisation Whiteboard`,
      ),
      bilingualBody(reportSummary(report), reportSummary(report, true)),
    );
  } catch (error) {
    await org.kv.set("org:report:last", last);
    await org.kv.del(claim);
    throw error;
  }
  await org.audit(null, "org.report.sent", { type: "report", name: schedule });
  return true;
}
