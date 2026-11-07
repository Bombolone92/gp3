// Result exports and engagement analytics, derived from the board's comments
// and bounded workshop registers. Nothing here writes to the board.
import { toCSV } from "../export-sheet.js";
import { t } from "../i18n.js";
import { ROLE_LABELS } from "../organization/board-access.js";
import {
  answers,
  ballots,
  contributions,
  historyRecords,
  participants,
  reactionRecords,
  workshopSettings,
} from "./model.js";

// Names saved for people without an account name, as the author of a
// personal board, are shown in the reader's language.
const PLACEHOLDER_NAMES = new Set(["Local author", "Member"]);
const shownName = (name) => (PLACEHOLDER_NAMES.has(name) ? t(name) : name);

const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
const share = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

export function resultsCSV(record) {
  // A vote's shares are of all the dots; a poll's are of the people who
  // answered, who may each have chosen several options.
  const total =
    record.kind === "poll"
      ? record.participants
      : record.results.reduce((sum, r) => sum + r.count, 0);
  const named = !record.anonymous;
  // Each count's rank: one more than the number of results above it.
  const rank = new Map();
  record.results
    .map((r) => r.count)
    .sort((a, b) => b - a)
    .forEach((count, n) => rank.has(count) || rank.set(count, n + 1));
  return toCSV([
    [t(record.kind === "vote" ? "Dot vote" : "Poll"), record.title],
    [t("Started"), iso(record.startedAt)],
    [t("Ended"), iso(record.endedAt)],
    [t("Participants"), record.participants],
    // Votes save only the objects that got a vote, so the count of objects
    // in the vote tells how many got none.
    ...(record.targets !== undefined
      ? [[t("Objects in the vote"), record.targets]]
      : []),
    [t("Anonymous"), t(record.anonymous ? "Yes" : "No")],
    [],
    [
      t("Rank"),
      t(record.kind === "vote" ? "Object" : "Option"),
      t(record.kind === "vote" ? "Votes" : "Responses"),
      t("Share (%)"),
      ...(named ? [t("Participants")] : []),
    ],
    // Tied results share a rank.
    ...record.results.map((r) => [
      rank.get(r.count),
      r.label,
      r.count,
      share(r.count, total),
      ...(named ? [(r.voters || []).map(shownName).join("; ")] : []),
    ]),
  ]);
}
export const resultsJSON = (record) =>
  JSON.stringify(
    {
      format: "whiteboard-workshop-results",
      version: 1,
      ...record,
      startedAt: iso(record.startedAt),
      endedAt: iso(record.endedAt),
    },
    null,
    2,
  );

// Participation during the current (or most recent) workshop session. With
// anonymous input on, contributions are only reported in aggregate.
export function engagement(
  board,
  { now = Date.now(), label = (id) => id } = {},
) {
  const w = board.workshop || {},
    session = w.session;
  const settings = workshopSettings(board);
  const events = [];
  const from = session?.startedAt ?? 0,
    to = session?.state === "ended" ? session.endedAt || now : now;
  const within = (at) => at >= from && at <= to;
  const people = new Map();
  // People who took part only anonymously count among the participants,
  // without a row naming them.
  const unnamed = new Set();
  const person = (id, given) => {
    const name = shownName(given);
    if (!people.has(id))
      people.set(id, {
        id,
        name: name || t("Participant"),
        role: "",
        first: 0,
        last: 0,
        notes: 0,
        comments: 0,
        reactions: 0,
        votes: 0,
        answers: 0,
      });
    const p = people.get(id);
    if (name && p.name === t("Participant")) p.name = name;
    return p;
  };
  for (const p of participants(board))
    if (!session || p.session === session.id) {
      const row = person(p.by, p.name);
      Object.assign(row, { role: p.role, first: p.first, last: p.last });
    }
  // Totals, rows, and the timeline count the same things: sticky notes
  // added, reaction types, objects voted for, and polls answered.
  const notes = new Set(
    board.items.filter((i) => i.type === "note").map((i) => i.id),
  );
  let anonymousNotes = 0;
  for (const c of contributions(board)) {
    if (!within(c.at) || !notes.has(c.id)) continue;
    events.push({ at: c.at, kind: "notes" });
    if (c.anonymous || settings.anonymous) {
      anonymousNotes++;
      if (c.by) unnamed.add(c.by);
    } else person(c.by, c.name).notes++;
  }
  for (const thread of board.comments || [])
    for (const m of thread.messages)
      if (!m.deleted && within(m.createdAt)) {
        events.push({ at: m.createdAt, kind: "comments" });
        person(m.authorId, m.authorName).comments++;
      }
  const reacted = new Map();
  // Reactions count while what they are on remains: not on an object
  // deleted, even at the same moment, or a deleted comment.
  const objects = new Set(board.items.map((i) => i.id)),
    messages = new Set(
      (board.comments || []).flatMap((thread) =>
        thread.messages
          .filter((m) => !m.deleted)
          .map((m) => `${thread.id}\n${m.id}`),
      ),
    );
  for (const r of reactionRecords(board)) {
    if (!within(r.at)) continue;
    if (
      r.target[0] === "o"
        ? !objects.has(r.target[1])
        : !messages.has(`${r.target[1]}\n${r.target[2]}`)
    )
      continue;
    if (r.target[0] === "o")
      reacted.set(
        r.target[1],
        (reacted.get(r.target[1]) || 0) + r.types.length,
      );
    events.push({ at: r.at, kind: "reactions", n: r.types.length });
    // Reactions left while input was anonymous carry no name and stay
    // uncounted per person after anonymity is turned off.
    if (!settings.anonymous && r.name)
      person(r.by, r.name).reactions += r.types.length;
    else if (r.by) unnamed.add(r.by);
  }
  if (w.vote)
    for (const b of ballots(board, w.vote.id))
      if (within(b.at) && b.ids.length) {
        // Objects voted for, as saved results record once the vote ends;
        // anonymous results keep only each object's number of votes.
        const n = w.vote.anonymous ? b.ids.length : new Set(b.ids).size;
        events.push({ at: b.at, kind: "votes", n });
        if (!w.vote.anonymous) person(b.by, b.name).votes += n;
        else unnamed.add(b.by);
      }
  if (w.poll)
    for (const a of answers(board, w.poll.id))
      if (within(a.at) && a.ids.length) {
        events.push({ at: a.at, kind: "answers" });
        if (!w.poll.anonymous) person(a.by, a.name).answers++;
        else unnamed.add(a.by);
      }
  // Votes and polls that ended earlier in the session were cleared when the
  // next one started; their saved results still count. Saved results name
  // voters rather than accounts, so a name matching one participant is
  // theirs, and any other name counts on its own.
  const current = new Set([w.vote?.id, w.poll?.id].filter(Boolean));
  const named = (given) => {
    const name = shownName(given);
    const found = [...people.values()].filter((p) => p.name === name);
    return found.length === 1 ? found[0] : person(`name:${name}`, name);
  };
  // A vote or poll saved earlier in the session keeps how many took part,
  // not who when anonymous, so at least that many people took part.
  let atLeast = 0;
  for (const h of historyRecords(board)) {
    if (current.has(h.id) || !within(h.endedAt)) continue;
    atLeast = Math.max(atLeast, h.participants || 0);
    const n =
      h.kind === "poll"
        ? h.participants || 0
        : h.results.reduce(
            (sum, r) => sum + (h.anonymous ? r.count : r.voters?.length || 0),
            0,
          );
    if (n)
      events.push({
        at: h.endedAt,
        kind: h.kind === "poll" ? "answers" : "votes",
        n,
      });
    if (h.anonymous) continue;
    if (h.kind === "vote")
      for (const r of h.results)
        for (const name of r.voters || []) named(name).votes++;
    else
      for (const name of new Set(h.results.flatMap((r) => r.voters || [])))
        named(name).answers++;
  }
  // Activity over time in at most twelve equal buckets of whole minutes.
  const start = session ? from : Math.min(...events.map((e) => e.at), to);
  const span = Math.max(60000, to - start),
    size = Math.max(60000, Math.ceil(span / 12 / 60000) * 60000);
  const timeline = [];
  for (let at = start; at <= to && timeline.length < 12; at += size)
    timeline.push({
      at,
      notes: 0,
      comments: 0,
      reactions: 0,
      votes: 0,
      answers: 0,
    });
  const totals = { notes: 0, comments: 0, reactions: 0, votes: 0, answers: 0 };
  for (const e of events) {
    // An event at the very end of the session falls in the last bucket.
    const n = Math.min(Math.floor((e.at - start) / size), timeline.length - 1);
    if (timeline[n]) timeline[n][e.kind] += e.n ?? 1;
    totals[e.kind] += e.n ?? 1;
  }
  // Only ballots cast in this session count, as in the totals.
  const voted = new Map();
  if (w.vote) {
    const targets = new Set(w.vote.targets);
    for (const b of ballots(board, w.vote.id))
      if (within(b.at))
        for (const id of b.ids)
          if (targets.has(id)) voted.set(id, (voted.get(id) || 0) + 1);
  }
  for (const h of historyRecords(board))
    if (h.kind === "vote" && h.id !== w.vote?.id && within(h.endedAt))
      for (const r of h.results)
        voted.set(r.id, (voted.get(r.id) || 0) + r.count);
  const top = (map) =>
    [...map]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, label: label(id), count }));
  return {
    session: session || null,
    from: start,
    to,
    anonymous: settings.anonymous,
    anonymousNotes,
    people: [...people.values()].sort(
      (a, b) =>
        b.notes +
          b.comments +
          b.reactions +
          b.votes +
          b.answers -
          (a.notes + a.comments + a.reactions + a.votes + a.answers) ||
        a.name.localeCompare(b.name),
    ),
    timeline,
    reacted: top(reacted),
    voted: top(voted),
    totals: {
      participants: Math.max(
        new Set([...people.keys(), ...unnamed]).size,
        atLeast,
      ),
      ...totals,
    },
  };
}

export function engagementCSV(summary) {
  return toCSV([
    [t("Workshop summary")],
    [t("From"), iso(summary.from)],
    [t("To"), iso(summary.to)],
    [t("Participants"), summary.totals.participants],
    [t("Anonymous"), t(summary.anonymous ? "Yes" : "No")],
    [],
    [
      t("Name"),
      t("Role"),
      t("First seen"),
      t("Last seen"),
      t("Notes"),
      t("Comments"),
      t("Reactions"),
      t("Votes"),
      t("Poll answers"),
    ],
    ...summary.people.map((p) => [
      p.name,
      t(ROLE_LABELS[p.role] || p.role),
      iso(p.first),
      iso(p.last),
      p.notes,
      p.comments,
      p.reactions,
      p.votes,
      p.answers,
    ]),
    ...(summary.anonymousNotes
      ? [[t("Anonymous notes"), "", "", "", summary.anonymousNotes]]
      : []),
    [],
    [
      t("Time"),
      t("Notes"),
      t("Comments"),
      t("Reactions"),
      t("Votes"),
      t("Poll answers"),
    ],
    ...summary.timeline.map((b) => [
      iso(b.at),
      b.notes,
      b.comments,
      b.reactions,
      b.votes,
      b.answers,
    ]),
    [],
    [t("Most reacted objects"), t("Reactions")],
    ...summary.reacted.map((r) => [r.label, r.count]),
    [],
    [t("Most voted objects"), t("Votes")],
    ...summary.voted.map((r) => [r.label, r.count]),
  ]);
}
