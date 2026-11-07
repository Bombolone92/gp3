// Facilitation console: workshop session, private mode, anonymous input,
// participant locks, staged frames, dot voting, polls, the agenda runner,
// participants, engagement summary, and result history. Dependencies are
// injected by the editor, like the timer.
import { tableTextContent } from "../src/table-language.js";
import { escape } from "../src/model.js";
import { canManage } from "../src/collaboration/protocol.js";
import { changeTimer } from "../src/timer.js";
import { orderedFrames } from "../src/scene.js";
import { labelled, t, language, objectName, objectNameContent } from "./i18n-table-current-candidate.js";
import {
  authoredTextHTML,
  objectNameHTML,
} from "./object-content-table-current-candidate.js";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";
import { appendRun, sliceTextRuns } from "../src/rich-text.js";
import { ROLE_LABELS, assignableRoles } from "../src/organization/board-access.js";
import { counted } from "../src/facilitation/strings.js";
import {
  REACTIONS,
  WORKSHOP_LIMITS,
  agendaSteps,
  runStep,
  answerKey,
  answers,
  ballots,
  concealment,
  hiddenObjects,
  contributionKey,
  historyKey,
  historyRecords,
  keyKind,
  myAnswer,
  myBallot,
  objectTarget,
  participantKey,
  pollOpen,
  pollTally,
  portableWorkshop,
  reactionIndex,
  reactionKey,
  recording,
  resultRecord,
  validateWorkshop,
  validateWorkshopChanges,
  voteKey,
  voteOpen,
  VOTE_GRACE,
  voteTally,
  workshopSettings,
} from "../src/facilitation/model.js";
import {
  engagement,
  engagementCSV,
  resultsCSV,
  resultsJSON,
} from "../src/facilitation/results.js";
import { createOverlay } from "../src/facilitation/overlay.js";
import {
  createAuthoredField,
  fieldContent,
  trimmedFieldContent,
} from "../src/facilitation/authored-field.js";

const TABS = [
  ["session", "Session"],
  ["vote", "Voting"],
  ["poll", "Poll"],
  ["agenda", "Agenda"],
  ["people", "People"],
  ["summary", "Summary"],
  ["history", "History"],
];
const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function shortLabel(text) {
  let end = Math.min(120, text.length);
  const previous = text.charCodeAt(end - 1),
    next = text.charCodeAt(end);
  if (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  )
    end--;
  return text.slice(0, end);
}
const fill = (text, values) =>
  Object.entries(values).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, () => v),
    typeof values.count === "number" ? counted(text, values.count) : t(text),
  );

export function createFacilitationUI(api) {
  let host,
    panel,
    opener = null,
    banner,
    live,
    tab = null,
    boardId,
    tabSignature,
    bannerSignature,
    previous,
    ticker,
    pending = null,
    recordedAt = 0,
    checkedAt = 0,
    known = new Set(),
    knownBoard;
  const caches = {};
  const board = () => api.board();
  const me = () => api.identity();
  const role = () => api.role();
  const manage = () => !!board() && canManage(role()) && api.canParticipate();
  const shared = () => !!board()?.shared;
  const now = () => Math.round(api.now());
  const settings = () => workshopSettings(board());
  // Memoize derived views by the arrays and registers they read.
  function memo(name, inputs, compute) {
    const c = caches[name];
    if (
      c &&
      c.inputs.length === inputs.length &&
      c.inputs.every((v, n) => v === inputs[n])
    )
      return c.value;
    const value = compute();
    caches[name] = { inputs, value };
    return value;
  }
  const index = () =>
    memo("index", [board()?.workshop], () => reactionIndex(board()));
  const hiddenFromParticipants = () => {
    const b = board();
    return memo("hidden", [b?.workshop, b?.items], () =>
      b ? hiddenObjects(b) : new Set(),
    );
  };
  const concealed = () => {
    const b = board();
    return memo("conceal", [b?.workshop, b?.items, me().id, manage()], () =>
      concealment(b, me().id, manage()),
    );
  };
  const byId = () => {
    const b = board();
    return memo(
      "byId",
      [b?.items, b?.items.length, b?.updated],
      () => new Map((b?.items || []).map((i) => [i.id, i])),
    );
  };
  function label(id) {
    const i = byId().get(id);
    if (!i) return t("Removed object");
    const c = concealed();
    if (c.notes.has(id)) return t("Private note");
    if (c.hidden.has(id) || c.frames.has(id))
      return t("Hidden by the facilitator");
    const text = (i.text || "").trim().split("\n")[0];
    return shortLabel(text ? text : objectName(i));
  }
  function labelHTML(id) {
    const i = byId().get(id),
      c = concealed();
    if (!i || c.notes.has(id) || c.hidden.has(id) || c.frames.has(id))
      return escape(label(id));
    const text = (i.text || "").trim().split("\n")[0];
    return text
      ? authoredTextHTML(i, shortLabel(text), i.text.indexOf(text))
      : objectNameHTML(i, 120);
  }
  function labelContent(id) {
    const text = label(id),
      content = { text, lang: language },
      i = byId().get(id),
      c = concealed();
    if (!i || c.notes.has(id) || c.hidden.has(id) || c.frames.has(id))
      return content;
    const first = (i.text || "").trim().split("\n")[0],
      runs = [];
    if (first) {
      content.lang = canonicalLanguage(i.lang) || language;
      const start = i.text.indexOf(first);
      for (const r of sliceTextRuns(i.textRuns, start, start + text.length)) {
        const lang = canonicalLanguage(r.style.lang);
        if (lang) appendRun(runs, r.start, r.end, { lang });
      }
    } else {
      const body =
          objectNameContent(i),
        start = objectName(i).length - body.length,
        lang = canonicalLanguage(i.lang);
      // Translated type prefixes keep the interface language; only the
      // authored alternative text, file name, or cells receive its tag.
      if (i.cells && !i.text && !i.alt && !i.fileName) {
        const content = tableTextContent(i, {
          limit: Math.min(300, Math.max(0, text.length - start)),
        });
        let at = 0;
        for (const run of content.textRuns || []) {
          if (lang) appendRun(runs, start + at, start + run.start, { lang });
          appendRun(runs, start + run.start, start + run.end, run.style);
          at = run.end;
        }
        if (lang) appendRun(runs, start + at, text.length, { lang });
      } else if (body && lang) appendRun(runs, start, text.length, { lang });
    }
    if (runs.length) content.textRuns = runs;
    return content;
  }
  function labelledResult(row, content) {
    const { lang, textRuns, ...rest } = row;
    return {
      ...rest,
      label: content.text,
      ...(content.lang !== undefined ? { lang: content.lang } : {}),
      ...(content.textRuns?.length ? { textRuns: content.textRuns } : {}),
    };
  }
  const overlay = createOverlay({
    board,
    view: () => api.view(),
    canvas: () => api.canvas(),
    hidden: () => api.hidden(),
    selection: () => api.selection(),
    editing: () => !!api.editing?.(),
    me,
    canParticipate: () => api.canParticipate(),
    index,
    concealment: concealed,
    label,
    labelHTML,
    icon: api.icon,
    voting: () => {
      const b = board(),
        v = b?.workshop?.vote;
      if (!v) return null;
      const second = Math.floor(now() / 1000);
      return memo("voting", [b.workshop, me().id, manage(), second], () => {
        const open = voteOpen(v, now()),
          mine = myBallot(b, v.id, me().id);
        return {
          targets: new Set(v.targets),
          open,
          multiple: v.multiple,
          mine,
          left: Math.max(0, v.votes - mine.length),
          // A timed vote is over at its deadline, even before a facilitator
          // records its end.
          showCounts: v.revealed || (!v.hidden && !open),
          counts: new Map(voteTally(b, v).map((r) => [r.id, r.count])),
        };
      });
    },
    // Facilitators see what participants do not, marked as hidden: frames
    // not yet revealed and objects they hid.
    stagedForManager: (id) => {
      if (!manage()) return false;
      const { stage, hide } = settings();
      return memo(
        "manager-hidden",
        [stage, hide],
        () =>
          new Set([
            ...(stage?.frames.slice(stage.shown) || []),
            ...(hide || []),
          ]),
      ).has(id);
    },
    react,
    vote,
  });

  // Every write goes through the same validation the worker applies.
  function change(fn, { quiet = false } = {}) {
    const b = board();
    if (!b || !api.canParticipate()) {
      if (!quiet) api.toast("This board is read-only.");
      return false;
    }
    const before = b.workshop || {},
      next = structuredClone(before);
    try {
      fn(next, b);
      validateWorkshop(next);
      if (b.shared)
        validateWorkshopChanges(
          { ...b, workshop: before },
          { ...b, workshop: next },
          { uuid: me().id, username: me().name },
          role(),
          now(),
        );
    } catch (error) {
      if (!quiet) api.toast(error.message);
      return false;
    }
    if (same(before, next)) return true;
    api.commit(Object.keys(next).length ? next : undefined);
    return true;
  }
  function announce(message, html = false) {
    if (!live) return;
    live.textContent = "";
    if (html) live.innerHTML = message;
    else live.textContent = message;
  }
  function react(target, type) {
    if (!api.canParticipate()) return api.toast("This board is read-only.");
    const anonymous = settings().anonymous;
    const done = change((w) => {
      const key = reactionKey(me().id, target),
        types = new Set(w[key]?.types || []);
      if (types.has(type)) types.delete(type);
      else types.add(type);
      // One record holds all of a person's reactions to a target, so one
      // left anonymously never gains a name from a later reaction.
      const named = !anonymous && (!w[key] || w[key].name !== undefined);
      if (!types.size) delete w[key];
      else
        w[key] = {
          by: me().id,
          target,
          types: REACTIONS.map((r) => r[0]).filter((k) => types.has(k)),
          at: now(),
          ...(named ? { name: me().name } : {}),
        };
    });
    if (done) {
      const reaction = REACTIONS.find((r) => r[0] === type);
      const on = index()
        .get(JSON.stringify(target))
        ?.some((r) => r.by === me().id && r.types.includes(type));
      announce(
        labelled(t(reaction[2]), t(on ? "Reaction added" : "Reaction removed")),
      );
    }
  }
  function vote(id, delta) {
    const b = board(),
      v = b?.workshop?.vote;
    if (!voteOpen(v, now())) return api.toast("Voting has ended.");
    const done = change((w) => {
      const key = voteKey(v.id, me().id),
        ids = [...(w[key]?.ids || [])];
      if (delta > 0) {
        if (!v.targets.includes(id))
          throw Error("This object is not part of the vote.");
        if (ids.length >= v.votes) throw Error("You have no votes left.");
        if (!v.multiple && ids.includes(id))
          throw Error("You already voted for this object.");
        ids.push(id);
      } else {
        const n = ids.lastIndexOf(id);
        if (n < 0) return;
        ids.splice(n, 1);
      }
      if (ids.length)
        w[key] = {
          vote: v.id,
          by: me().id,
          ids,
          at: now(),
          ...(v.anonymous ? {} : { name: me().name }),
        };
      else delete w[key];
    });
    if (done)
      announce(
        fill("{count} votes left", {
          count: v.votes - myBallot(board(), v.id, me().id).length,
        }),
      );
  }

  // Engagement records: attendance for the active session. Facilitators also
  // record everyone in the live roster, including viewers who cannot write.
  function recordAttendance() {
    const b = board(),
      session = b?.workshop?.session;
    if (!b?.shared || session?.state !== "active" || !api.canParticipate())
      return;
    if (Date.now() - recordedAt < 30000) return;
    const people = new Map([[me().id, { name: me().name, role: role() }]]);
    if (manage())
      for (const p of api.roster())
        if (!people.has(p.user))
          people.set(p.user, { name: p.username, role: p.role });
    const stamp = now();
    const stale = [...people].filter(([id]) => {
      const p = b.workshop[participantKey(id)];
      return !p || p.session !== session.id || stamp - p.last > 300000;
    });
    if (!stale.length) return;
    recordedAt = Date.now();
    change(
      (w) => {
        for (const [id, p] of stale) {
          const old = w[participantKey(id)];
          const fresh = old?.session !== session.id;
          if (
            !fresh ||
            Object.keys(w).filter((k) => keyKind(k) === "p").length <
              WORKSHOP_LIMITS.participants
          )
            w[participantKey(id)] = {
              by: id,
              name: String(p.name || t("Participant")).slice(0, 100),
              role: String(p.role || "editor").slice(0, 20),
              session: session.id,
              first: fresh ? stamp : old.first,
              last: stamp,
            };
        }
      },
      { quiet: true },
    );
  }
  // Called by the editor's save: attribute new objects while a workshop is
  // running, drop records of removed objects, and stop changes a locked board
  // does not allow before they reach the worker.
  function beforeSave(baseline) {
    const b = board();
    if (!b) return true;
    if (knownBoard !== b.id) {
      knownBoard = b.id;
      known = new Set(b.items.map((i) => i.id));
    }
    const base = baseline ? new Set(baseline.items.map((i) => i.id)) : known;
    const present = new Set(b.items.map((i) => i.id));
    const w = b.workshop ? { ...b.workshop } : {};
    let changed = false;
    if (api.canParticipate() && recording(b, now())) {
      const s = settings();
      for (const i of b.items)
        if (!base.has(i.id) && !w[contributionKey(i.id)]) {
          w[contributionKey(i.id)] = {
            by: me().id,
            at: now(),
            ...(s.anonymous ? { anonymous: true } : { name: me().name }),
            ...(s.private && i.type === "note" ? { round: s.private } : {}),
          };
          changed = true;
        }
    }
    // During a session, a removed object's record stays, so undoing the
    // removal or recovering the object keeps its author (and a private note
    // its round) instead of crediting whoever restored it. Records are
    // dropped once the session ends, or before they near the limit.
    const keepRemoved =
      recording(b, now()) &&
      Object.keys(w).filter((k) => keyKind(k) === "c").length <
        WORKSHOP_LIMITS.contributions * 0.8;
    for (const key of Object.keys(w)) {
      const kind = keyKind(key);
      const gone =
        (kind === "c" &&
          !keepRemoved &&
          !present.has(JSON.parse(key.slice(2))[0])) ||
        (kind === "r" &&
          w[key].target[0] === "o" &&
          !present.has(w[key].target[1]) &&
          (w[key].by === me().id || api.canEdit()));
      if (gone) {
        delete w[key];
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(w).length) b.workshop = w;
      else delete b.workshop;
    }
    if (baseline && b.shared && !manage()) {
      try {
        validateWorkshopChanges(
          baseline,
          b,
          { uuid: me().id, username: me().name },
          role(),
          now(),
        );
      } catch (error) {
        // Restore the last saved content; workshop entries remain as saved.
        b.items = structuredClone(baseline.items);
        b.title = baseline.title;
        for (const key of ["tags", "timer", "planning", "workshop"])
          if (baseline[key] !== undefined)
            b[key] = structuredClone(baseline[key]);
          else delete b[key];
        api.toast(error.message);
        api.draw();
        return false;
      }
    }
    known = present;
    return true;
  }

  // Facilitator actions.
  // A new session starts with no attendance, so earlier sessions' records
  // do not fill the participant limit.
  function startSession(w, stamp) {
    for (const key of Object.keys(w)) if (keyKind(key) === "p") delete w[key];
    w.session = { id: newId(), state: "active", startedAt: stamp };
  }
  function toggleSession(active) {
    change((w) => {
      if (active) startSession(w, now());
      else if (w.session)
        w.session = { ...w.session, state: "ended", endedAt: now() };
    });
    recordedAt = checkedAt = 0;
  }
  function setSetting(patch) {
    change((w) => {
      const next = { ...workshopSettings({ workshop: w }), ...patch };
      if (!next.stage) delete next.stage;
      if (!next.hide?.length) delete next.hide;
      w.settings = next;
    });
  }
  function targetsFor(scope, frames) {
    const items = board().items;
    if (scope === "selection")
      return items
        .filter((i) => api.selection().has(i.id) && i.type !== "arrow")
        .map((i) => i.id);
    if (scope === "frames")
      return items
        .filter((i) => frames.has(i.parentId) && i.type !== "arrow")
        .map((i) => i.id);
    return items.filter((i) => i.type === "note").map((i) => i.id);
  }
  function trimHistory(w) {
    const records = Object.keys(w)
      .filter((k) => keyKind(k) === "h")
      .sort((a, b) => w[a].endedAt - w[b].endedAt);
    while (records.length > WORKSHOP_LIMITS.history) delete w[records.shift()];
  }
  function startVote(form) {
    const value = (id) => form.querySelector(id).value;
    const checked = (id) => form.querySelector(id).checked;
    const titleField = form.querySelector("#fac-vote-title"),
      content = trimmedFieldContent(titleField),
      enteredTitle = content.text,
      title = (enteredTitle || t("Dot vote")).slice(0, 200),
      titleLang = enteredTitle ? content.lang : language;
    const votes = +value("#fac-vote-count"),
      minutes = +value("#fac-vote-minutes");
    const scope = form.querySelector('[name="fac-vote-scope"]:checked').value;
    const frames = new Set(
      [...form.querySelectorAll("#fac-vote-frames input:checked")].map(
        (i) => i.value,
      ),
    );
    try {
      if (
        !Number.isInteger(votes) ||
        votes < 1 ||
        votes > WORKSHOP_LIMITS.votes
      )
        throw Error("Choose from 1 to 20 votes per person.");
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600)
        throw Error("Set a time limit from 0 to 600 minutes.");
      const targets = targetsFor(scope, frames).slice(
        0,
        WORKSHOP_LIMITS.targets,
      );
      if (!targets.length)
        throw Error("Choose at least one object to vote on.");
      const stamp = now();
      const started = change((w) => {
        // Earlier ballots are cleared; their results stay in the history.
        for (const key of Object.keys(w))
          if (keyKind(key) === "v") delete w[key];
        w.vote = {
          id: newId(),
          title,
          ...(titleLang ? { titleLang } : {}),
          ...(enteredTitle && content.textRuns?.length
            ? { titleRuns: content.textRuns }
            : {}),
          votes,
          multiple: checked("#fac-vote-multiple"),
          anonymous: checked("#fac-vote-anonymous"),
          hidden: checked("#fac-vote-hidden"),
          targets,
          state: "active",
          revealed: false,
          startedAt: stamp,
          endsAt: minutes ? stamp + minutes * 60000 : 0,
        };
      });
      if (started && minutes && checked("#fac-vote-timer") && api.canEdit())
        api.setTimer(
          changeTimer(board().timer, "start", {
            now: stamp,
            duration: minutes * 60000,
          }),
        );
    } catch (error) {
      showError(error.message);
    }
  }
  // Revealing or hiding results also applies to the session's history.
  function reveal(kind, revealed) {
    change((x) => {
      x[kind] = { ...x[kind], revealed };
      const record = x[historyKey(x[kind].id)];
      if (record)
        x[historyKey(record.id)] = {
          ...record,
          hidden: !!x[kind].hidden && !revealed,
        };
    });
  }
  // Ends a vote or poll and saves its result in the history.
  function finish(w, b, kind) {
    const session = w[kind];
    if (!session) return;
    // A timed session ended at its deadline, even when the facilitator who
    // saves its result comes online later.
    const endedAt = session.endsAt ? Math.min(now(), session.endsAt) : now();
    w[kind] = {
      ...session,
      state: kind === "vote" ? "ended" : "closed",
      endedAt,
    };
    // Notes of a private round, and objects hidden from participants or in
    // frames not yet revealed, are saved without their text, which the
    // facilitator sees but others must not, even once the object is gone;
    // each viewer names them when shown.
    const round = settings().private;
    const unseen = concealment({ ...b, workshop: w }, "", false);
    const saved = (id) =>
      (round && w[contributionKey(id)]?.round === round) ||
      unseen.hidden.has(id) ||
      unseen.frames.has(id)
        ? ""
        : labelContent(id);
    const record = resultRecord({ ...b, workshop: w }, kind, saved, endedAt);
    w[historyKey(record.id)] = record;
    trimHistory(w);
  }
  function endSession(kind) {
    change((w, b) => finish(w, b, kind));
  }
  function startPoll(form) {
    const questionField = form.querySelector("#fac-poll-question"),
      content = trimmedFieldContent(questionField),
      question = content.text;
    const optionsField = form.querySelector("#fac-poll-options"),
      options = [];
    let offset = 0;
    for (const line of optionsField.value.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        const start = offset + line.length - line.trimStart().length;
        options.push(
          fieldContent(
            optionsField,
            start,
            start + Math.min(200, trimmed.length),
          ),
        );
      }
      offset += line.length + 1;
    }
    try {
      if (!question) {
        questionField.setAttribute("aria-invalid", "true");
        questionField.focus();
        throw Error("Enter a question.");
      }
      if (options.length < 2 || options.length > WORKSHOP_LIMITS.options) {
        optionsField.setAttribute("aria-invalid", "true");
        optionsField.focus();
        throw Error("Enter from 2 to 12 options, one per line.");
      }
      change((w) => {
        for (const key of Object.keys(w))
          if (keyKind(key) === "a") delete w[key];
        w.poll = {
          id: newId(),
          question: question.slice(0, 300),
          ...(content.lang ? { questionLang: content.lang } : {}),
          ...(content.textRuns?.length
            ? { questionRuns: content.textRuns }
            : {}),
          options: options.map((content) => ({ id: newId(), ...content })),
          multiple: form.querySelector("#fac-poll-multiple").checked,
          anonymous: form.querySelector("#fac-poll-anonymous").checked,
          hidden: form.querySelector("#fac-poll-hidden").checked,
          state: "open",
          revealed: false,
          startedAt: now(),
        };
      });
    } catch (error) {
      showError(error.message);
    }
  }
  function answerPoll(form) {
    const poll = board()?.workshop?.poll;
    if (!pollOpen(poll)) return api.toast("This poll is closed.");
    const ids = [
      ...form.querySelectorAll('[name="fac-poll-answer"]:checked'),
    ].map((i) => i.value);
    if (
      change((w) => {
        const key = answerKey(poll.id, me().id);
        if (!ids.length) delete w[key];
        else
          w[key] = {
            poll: poll.id,
            by: me().id,
            ids,
            at: now(),
            ...(poll.anonymous ? {} : { name: me().name }),
          };
      })
    )
      announce(t(ids.length ? "Answer saved." : "Answer cleared."));
  }
  function saveAgenda(form) {
    const steps = [...form.querySelectorAll("[data-step]")].map((row) => {
      const minutes = +row.querySelector(".fac-step-minutes").value,
        content = trimmedFieldContent(row.querySelector(".fac-step-text"));
      return {
        frame: row.dataset.step,
        ...(Number.isInteger(minutes) && minutes > 0
          ? { minutes: Math.min(600, minutes) }
          : {}),
        ...(content.text ? content : {}),
        ...(row.querySelector(".fac-step-include").checked
          ? {}
          : { skip: true }),
      };
    });
    // Only frames with settings are stored; the rest use the defaults, so
    // boards with many frames keep every change.
    const configured = steps.filter((s) => s.minutes || s.text || s.skip);
    if (configured.length > WORKSHOP_LIMITS.steps)
      return api.toast(
        fill("Up to {count} frames can have agenda settings.", {
          count: WORKSHOP_LIMITS.steps,
        }),
      );
    if (change((w) => (w.agenda = { steps: configured })))
      announce(t("Agenda saved."));
  }
  function goToStep(step, start = false) {
    const steps = agendaSteps(board());
    if (!steps.length)
      return api.toast("Add frames to the board to build an agenda.");
    const n = Math.max(0, Math.min(step, steps.length - 1));
    const stamp = now(),
      frame = steps[n].frame.id;
    let started = false;
    const ok = change((w) => {
      if (start || !w.run || w.run.state !== "running")
        w.run = {
          id: newId(),
          state: "running",
          step: n,
          frame,
          startedAt: stamp,
          stepAt: stamp,
        };
      else w.run = { ...w.run, step: n, frame, stepAt: stamp };
      started = start && w.session?.state !== "active";
      if (started) startSession(w, stamp);
    });
    if (!ok) return;
    // This person's own attendance is recorded for the new session at once.
    if (started) recordedAt = checkedAt = 0;
    const s = steps[n];
    api.focusFrame(s.frame);
    api.bring();
    if (s.minutes && api.canEdit())
      api.setTimer(
        changeTimer(board().timer, "start", {
          now: stamp,
          duration: s.minutes * 60000,
        }),
      );
  }
  async function setRole(uuid, next) {
    const session = api.session();
    if (!session) return;
    try {
      await session.request("role", { uuid, role: next });
      await session.heartbeat();
      announce(
        t(next === "removed" ? "Participant removed." : "Role changed."),
      );
    } catch (error) {
      api.toast(error.message);
    }
    tabSignature = null;
    render();
  }
  // Saved results name each object as the facilitator saw it; anyone else
  // sees the placeholder for objects that are still hidden from them, and
  // private notes saved without a name are named as this person sees them.
  const coveredResult = (x, c = concealed()) =>
    !x.label || c.notes.has(x.id) || c.hidden.has(x.id) || c.frames.has(x.id);
  function relabel(record) {
    if (!record) return record;
    const c = concealed();
    if (!record.results?.some((x) => coveredResult(x, c))) return record;
    return {
      ...record,
      results: record.results.map((x) =>
        coveredResult(x, c) ? labelledResult(x, labelContent(x.id)) : x,
      ),
    };
  }
  function download(record, format) {
    record = relabel(record);
    const name =
      (record.title || "results")
        .normalize("NFC")
        .replace(/[^\p{L}\p{M}\p{N} _-]+/gu, "")
        .trim()
        .slice(0, 60) || "results";
    if (format === "csv")
      api.download(resultsCSV(record), `${name}.csv`, "text/csv;charset=utf-8");
    else api.download(resultsJSON(record), `${name}.json`, "application/json");
  }
  function currentRecord(kind) {
    const b = board(),
      session = b.workshop?.[kind];
    return session && resultRecord(b, kind, label, now());
  }
  function showError(message) {
    const output = panel?.querySelector("#fac-error");
    if (output) {
      output.hidden = false;
      output.textContent = t(message);
    } else api.toast(message);
  }

  // Panel markup. Tabs rebuild only when the state they show changes, and
  // keep form drafts and focus across remote updates.
  const time = (ms) =>
    new Date(ms).toLocaleTimeString(language === "fr" ? "fr-CA" : "en-CA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const date = (ms) =>
    new Date(ms).toLocaleString(language === "fr" ? "fr-CA" : "en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const user = (value) => `<span data-user-content>${escape(value)}</span>`;
  const frameTitle = (frame) =>
    frame.text ? authoredTextHTML(frame) : escape(t("Frame"));
  const stepTitle = (step) =>
    step.titleHidden ? user(step.title) : frameTitle(step.frame);
  const agendaFieldId = (id) =>
    "fac-agenda-text-" +
    [...id].map((c) => c.codePointAt(0).toString(16).padStart(6, "0")).join("");
  const check = (id, text, checked = false, extra = "") =>
    `<label class="check-field"><input type="checkbox" id="${id}" ${checked ? "checked" : ""} ${extra}><span>${t(text)}</span></label>`;
  function bars(rows, total, noun, name = (r) => user(r.label)) {
    return `<ol class="fac-results">${rows
      .map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        return `<li><div class="fac-result-row"><span class="fac-result-label">${name(r)}</span><span class="fac-result-count">${fill(noun, { count: r.count })} · ${pct}%</span></div><div class="fac-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>${r.voters?.length ? `<small>${user(r.voters.join(", "))}</small>` : ""}</li>`;
      })
      .join("")}</ol>`;
  }
  function sessionTab() {
    const b = board(),
      w = b.workshop || {},
      s = settings(),
      m = manage(),
      frames = orderedFrames(b.items);
    const statuses = [
      s.private &&
        "Private mode is on. Your new sticky notes are hidden from others until the facilitator reveals them.",
      s.anonymous &&
        "Anonymous input is on. New sticky notes are not attributed to their authors.",
      s.lock === "contribute" &&
        "The board is locked. You can add sticky notes, vote, react, and comment.",
      s.lock === "frozen" &&
        "The board is frozen. You can vote, react, and comment.",
      s.stage && "The facilitator is revealing frames one at a time.",
    ].filter(Boolean);
    if (!m)
      return `<h3>${t("Workshop status")}</h3>${statuses.length ? `<ul class="fac-status-list">${statuses.map((x) => `<li>${t(x)}</li>`).join("")}</ul>` : `<p class="dialog-copy">${t("No facilitation controls are active.")}</p>`}<p class="dialog-copy">${t("Private mode hides notes in this app. It is not encryption: anyone with access to the board data could read them.")}</p>`;
    const session = w.session;
    return `<h3>${t("Workshop session")}</h3><p class="dialog-copy">${
      session?.state === "active"
        ? fill("Recording participation since {time}.", {
            time: time(session.startedAt),
          })
        : session
          ? fill("Last session: {start} to {end}.", {
              start: date(session.startedAt),
              end: time(session.endedAt || session.startedAt),
            })
          : t(
              "Start a session to record attendance and contributions for the summary.",
            )
    }</p><div class="fac-actions">${
      session?.state === "active"
        ? `<button type="button" class="secondary" data-fac="session-end">${t("End workshop session")}</button>`
        : `<button type="button" class="primary" data-fac="session-start">${t("Start workshop session")}</button>`
    }<button type="button" class="secondary" data-fac="bring" ${b.shared ? "" : "disabled"}>${t("Bring everyone to my view")}</button></div>
    <h3>${t("Private mode")}</h3><p class="dialog-copy">${t("While private mode is on, each person sees only their own new sticky notes. Others appear face down until you reveal them. Private mode hides notes in this app. It is not encryption: anyone with access to the board data could read them.")}</p><div class="fac-actions">${
      s.private
        ? `<button type="button" class="primary" data-fac="private-reveal">${t("Reveal all contributions")}</button>`
        : `<button type="button" class="secondary" data-fac="private-on">${t("Turn on private mode")}</button>`
    }</div>
    <h3>${t("Anonymous input")}</h3>${check("fac-anonymous", "New sticky notes, reactions, and editing indicators do not show who made them.", s.anonymous)}<p class="dialog-copy">${t("Board owners and organization audit logs still record who made each change.")}</p>
    <fieldset class="fac-fieldset"><legend>${t("Participant access")}</legend>${[
      ["open", "Open: participants edit as usual"],
      [
        "contribute",
        "Locked: participants can add sticky notes, vote, and react, but not change others' work",
      ],
      [
        "frozen",
        "Frozen: no content changes; voting, reactions, and comments continue",
      ],
    ]
      .map(
        ([value, text]) =>
          `<label class="check-field"><input type="radio" name="fac-lock" value="${value}" ${s.lock === value ? "checked" : ""}><span>${t(text)}</span></label>`,
      )
      .join("")}</fieldset>
    <h3>${t("Stage frames")}</h3>${
      s.stage
        ? `<p class="dialog-copy">${fill("{shown} of {total} staged frames are visible to participants.", { shown: s.stage.shown, total: s.stage.frames.length })}</p><div class="fac-actions"><button type="button" class="primary" data-fac="stage-next">${t("Reveal next frame")}</button><button type="button" class="secondary" data-fac="stage-all">${t("Reveal all frames")}</button></div>`
        : frames.length
          ? `<p class="dialog-copy">${t("Hide frames from participants, then reveal them one at a time.")}</p><div class="fac-choices" id="fac-stage-frames" role="group" aria-label="${t("Frames to stage")}">${frames.map((f) => `<label><input type="checkbox" value="${escape(f.id)}" checked>${frameTitle(f)}</label>`).join("")}</div><div class="fac-actions"><button type="button" class="secondary" data-fac="stage-start">${t("Hide selected frames")}</button></div>`
          : `<p class="dialog-copy">${t("Add frames to the board to stage them.")}</p>`
    }`;
  }
  function voteTab() {
    const b = board(),
      v = b.workshop?.vote,
      m = manage(),
      frames = orderedFrames(b.items);
    const form = `<form id="fac-vote-form"><div class="field"><span id="fac-vote-title-label">${t("Title")}</span><div id="fac-vote-title" data-fac-authored></div></div><div class="field-row"><label class="field">${t("Votes per person")}<input id="fac-vote-count" type="number" min="1" max="20" value="3" required></label><label class="field">${t("Time limit in minutes (0 for none)")}<input id="fac-vote-minutes" type="number" min="0" max="600" value="0" required></label></div><fieldset class="fac-fieldset"><legend>${t("Votable objects")}</legend>${[
      ["notes", "All sticky notes"],
      ["selection", "The current selection"],
      ["frames", "Objects in chosen frames"],
    ]
      .map(
        ([value, text], n) =>
          `<label class="check-field"><input type="radio" name="fac-vote-scope" value="${value}" ${n ? "" : "checked"}><span>${t(text)}</span></label>`,
      )
      .join(
        "",
      )}<div class="fac-choices" id="fac-vote-frames" role="group" aria-label="${t("Frames")}">${frames.map((f) => `<label><input type="checkbox" value="${escape(f.id)}">${frameTitle(f)}</label>`).join("")}</div></fieldset>${check("fac-vote-multiple", "Allow several votes on one object")}${check("fac-vote-anonymous", "Anonymous: results do not show who voted", true)}${check("fac-vote-hidden", "Hide results until I reveal them", true)}${check("fac-vote-timer", "Show the time limit in the board timer", true)}<p class="dialog-copy">${t("Anonymous and hidden results are hidden in this app, not encrypted: anyone with access to the board data could see who voted and the tally.")}</p><div class="dialog-footer"><button class="primary" type="submit">${t("Start voting")}</button></div></form>`;
    if (!v)
      return m
        ? `<h3>${t("Start a dot vote")}</h3>${form}`
        : `<p class="dialog-copy">${t("No vote is running. The facilitator can start one.")}</p>`;
    const open = voteOpen(v, now()),
      mine = myBallot(b, v.id, me().id),
      tally = voteTally(b, v),
      voters = ballots(b, v.id).filter((x) => x.ids.length).length,
      // Participants see a vote's results once it is revealed, or once it
      // ends or reaches its deadline unless it was started with results
      // hidden.
      shared = v.revealed || (!v.hidden && !open),
      visible = shared || m;
    const left =
      v.endsAt && open ? Math.max(0, Math.ceil((v.endsAt - now()) / 60000)) : 0;
    const canVote = open && api.canParticipate();
    const total = tally.reduce((sum, r) => sum + r.count, 0);
    const hidden = concealed().hidden,
      present = new Set(b.items.map((i) => i.id));
    const available = (id) => !hidden.has(id) && present.has(id);
    // Objects deleted or hidden after someone voted for them stay listed
    // for that person, so the vote can be taken back.
    const targets = v.targets.filter(
      (id) => available(id) || mine.includes(id),
    );
    return `<h3>${authoredTextHTML({ lang: v.titleLang, textRuns: v.titleRuns }, v.title)}</h3><p class="dialog-copy">${
      open
        ? fill("Voting is open. {count} participants have voted.", {
            count: voters,
          })
        : fill("Voting has ended. {count} participants voted.", {
            count: voters,
          })
    }${left ? ` ${fill("About {count} minutes left.", { count: left })}` : ""} ${t(v.anonymous ? "Votes are anonymous." : "Votes show who voted.")}</p>${
      canVote
        ? `<p class="fac-remaining" id="fac-remaining">${fill("You have {left} of {total} votes left.", { left: v.votes - mine.length, total: v.votes })}</p><p class="dialog-copy">${t("Select Vote on a highlighted object, or use the list below.")}</p>`
        : ""
    }${
      canVote || mine.length
        ? `<details class="fac-details" ${canVote ? "open" : ""}><summary>${fill("Votable objects ({count})", { count: targets.length })}</summary><ul class="fac-vote-list">${targets
            .slice(0, 200)
            .map((id, index) => {
              const n = mine.filter((x) => x === id).length;
              const nameId = `fac-vote-name-${index}`;
              return `<li><span id="${nameId}">${labelHTML(id)}</span><span class="fac-vote-mine">${n ? `✓${n}` : ""}</span>${canVote ? `<button type="button" class="text-btn" data-fac="vote-add" data-id="${escape(id)}" ${mine.length >= v.votes || (!v.multiple && n) || !available(id) ? 'aria-disabled="true"' : ""} aria-labelledby="fac-vote-add-${index} ${nameId}"><span class="sr-only" id="fac-vote-add-${index}">${t("Vote for")}</span><span aria-hidden="true">${t("Vote")}</span></button><button type="button" class="text-btn" data-fac="vote-remove" data-id="${escape(id)}" ${n ? "" : "disabled"} aria-labelledby="fac-vote-remove-${index} ${nameId}"><span class="sr-only" id="fac-vote-remove-${index}">${t("Remove your vote from")}</span><span aria-hidden="true">${t("Remove")}</span></button>` : ""}</li>`;
            })
            .join(
              "",
            )}</ul>${targets.length > 200 ? `<p class="dialog-copy">${fill("The list shows the first {shown} of {count}. Vote for the others on the board.", { shown: 200, count: targets.length })}</p>` : ""}</details>`
        : ""
    }${
      m
        ? `<div class="fac-actions">${open ? `<button type="button" class="primary" data-fac="vote-end">${t("End voting")}</button>` : ""}${v.hidden || open ? (v.revealed ? `<button type="button" class="secondary" data-fac="vote-hide">${t("Hide results")}</button>` : `<button type="button" class="secondary" data-fac="vote-reveal">${t("Reveal results")}</button>`) : ""}${!open ? `<button type="button" class="secondary" data-fac="vote-clear">${t("New vote")}</button>` : ""}</div>`
        : ""
    }${
      visible
        ? `<h4>${t("Results")}</h4>${m && !shared ? `<p class="dialog-copy">${t("Only facilitators can see these results until you reveal them.")}</p>` : ""}${bars(
            tally.map((r) => ({ ...r, label: label(r.id) })),
            total,
            "{count} votes",
            (r) => labelHTML(r.id),
          )}<div class="fac-actions"><label class="field fac-inline">${t("Top", "results")}<input id="fac-top" type="number" min="1" max="${Math.max(1, tally.length)}" value="${Math.min(3, tally.length)}"></label><button type="button" class="secondary" data-fac="vote-top">${t("Select top results")}</button><button type="button" class="secondary" data-fac="vote-csv">${t("Export CSV")}</button><button type="button" class="secondary" data-fac="vote-json">${t("Export JSON")}</button></div>`
        : `<p class="dialog-copy">${t("Results are hidden until the facilitator reveals them.")}</p>`
    }`;
  }
  function pollTab() {
    const b = board(),
      p = b.workshop?.poll,
      m = manage();
    const form = `<form id="fac-poll-form"><div class="field"><span id="fac-poll-question-label">${t("Question")}</span><div id="fac-poll-question" data-fac-authored></div></div><div class="field"><span id="fac-poll-options-label">${t("Options, one per line")}</span><div id="fac-poll-options" data-fac-authored></div></div>${check("fac-poll-multiple", "Allow several answers")}${check("fac-poll-anonymous", "Anonymous: results do not show who answered", true)}${check("fac-poll-hidden", "Hide results until I reveal them")}<p class="dialog-copy">${t("Anonymous and hidden results are hidden in this app, not encrypted: anyone with access to the board data could see who answered and the tally.")}</p><div class="dialog-footer"><button class="primary" type="submit">${t("Start poll")}</button></div></form>`;
    if (!p)
      return m
        ? `<h3>${t("Create a poll")}</h3>${form}`
        : `<p class="dialog-copy">${t("No poll is open. The facilitator can start one.")}</p>`;
    const open = pollOpen(p),
      mine = new Set(myAnswer(b, p.id, me().id)),
      tally = pollTally(b, p),
      responses = answers(b, p.id).filter((a) => a.ids.length).length,
      visible =
        p.revealed ||
        m ||
        (!p.hidden && p.state === "closed") ||
        (!p.hidden && mine.size);
    const canAnswer = open && api.canParticipate();
    const total = tally.reduce((sum, r) => sum + r.count, 0);
    return `<h3>${authoredTextHTML({ lang: p.questionLang, textRuns: p.questionRuns }, p.question)}</h3><p class="dialog-copy">${fill(open ? "The poll is open. {count} responses." : "The poll is closed. {count} responses.", { count: responses })} ${t(p.anonymous ? "Answers are anonymous." : "Answers show who answered.")}</p>${
      canAnswer
        ? `<form id="fac-answer-form"><fieldset class="fac-fieldset"><legend>${t(p.multiple ? "Choose one or more answers" : "Choose one answer")}</legend>${p.options
            .map(
              (o) =>
                `<label class="check-field"><input type="${p.multiple ? "checkbox" : "radio"}" name="fac-poll-answer" value="${o.id}" ${mine.has(o.id) ? "checked" : ""}>${authoredTextHTML(o, o.text)}</label>`,
            )
            .join(
              "",
            )}</fieldset><div class="dialog-footer"><button class="primary" type="submit">${t(mine.size ? "Update answer" : "Submit answer")}</button></div></form>`
        : ""
    }${
      m
        ? `<div class="fac-actions">${open ? `<button type="button" class="primary" data-fac="poll-close">${t("Close poll")}</button>` : `<button type="button" class="secondary" data-fac="poll-clear">${t("New poll")}</button>`}${p.hidden || open ? (p.revealed ? `<button type="button" class="secondary" data-fac="poll-hide">${t("Hide results")}</button>` : `<button type="button" class="secondary" data-fac="poll-reveal">${t("Reveal results")}</button>`) : ""}</div>`
        : ""
    }${
      visible
        ? `<h4>${t("Results")}</h4>${bars(
            tally.map((r) => ({ ...r, label: r.text })),
            total,
            "{count} responses",
            (row) => authoredTextHTML(row, row.label),
          )}<div class="fac-actions"><button type="button" class="secondary" data-fac="poll-csv">${t("Export CSV")}</button><button type="button" class="secondary" data-fac="poll-json">${t("Export JSON")}</button></div>`
        : `<p class="dialog-copy">${t("Results are hidden until the facilitator reveals them.")}</p>`
    }`;
  }
  // Steps keep their place, but a covered frame's title and instructions
  // stay hidden until it is shown.
  function visibleSteps(b) {
    const c = concealed();
    return agendaSteps(b).map((s) =>
      c.frames.has(s.frame.id) || c.hidden.has(s.frame.id)
        ? {
            ...s,
            title: t("Hidden by the facilitator"),
            text: "",
            titleHidden: true,
          }
        : s,
    );
  }
  function agendaTab() {
    const b = board(),
      m = manage(),
      run = b.workshop?.run,
      steps = visibleSteps(b),
      frames = orderedFrames(b.items),
      config = new Map(
        (b.workshop?.agenda?.steps || []).map((s) => [s.frame, s]),
      );
    const running = run?.state === "running";
    const current = running ? runStep(run, steps) : -1;
    const list = `<ol class="fac-agenda">${steps
      .map(
        (s, n) =>
          `<li ${n === current ? 'aria-current="step" class="current"' : ""}><strong id="fac-agenda-title-${n}">${stepTitle(s)}</strong>${s.minutes ? ` · ${fill("{count} min", { count: s.minutes })}` : ""}${s.text ? `<p>${authoredTextHTML(s, s.text)}</p>` : ""}${m ? `<button type="button" class="text-btn" data-fac="agenda-go" data-step="${n}" aria-labelledby="fac-agenda-action-${n} fac-agenda-title-${n}"><span id="fac-agenda-action-${n}">${t("Go to step")}<span class="sr-only">:</span></span></button>` : ""}</li>`,
      )
      .join("")}</ol>`;
    if (!frames.length)
      return `<p class="dialog-copy">${t("Add frames to the board to build an agenda. Each frame becomes a step, in frame order.")}</p>`;
    const controls = m
      ? `<div class="fac-actions">${
          running
            ? `<button type="button" class="secondary" data-fac="agenda-prev" ${current <= 0 ? "disabled" : ""}>${t("Previous step")}</button><button type="button" class="primary" data-fac="agenda-next" ${current >= steps.length - 1 ? "disabled" : ""}>${t("Next step")}</button><button type="button" class="secondary" data-fac="agenda-end">${t("End agenda")}</button>`
            : `<button type="button" class="primary" data-fac="agenda-start" ${steps.length ? "" : "disabled"}>${t("Start agenda")}</button>`
        }</div>`
      : "";
    // A run whose frames were all left out has no step to name.
    const status =
      current >= 0
        ? `<p class="fac-remaining">${fill("Step {n} of {total}: {title}", { n: current + 1, total: steps.length, title: stepTitle(steps[current]) })}</p>`
        : "";
    const editor = m
      ? `<details class="fac-details"><summary>${t("Edit agenda steps")}</summary><form id="fac-agenda-form"><p class="dialog-copy">${t("Steps follow the frame order. Change the order in Frames and navigation.")}</p>${frames
          .map((f) => {
            const c = config.get(f.id) || {},
              id = agendaFieldId(f.id);
            return `<fieldset class="fac-step" data-step="${escape(f.id)}"><legend>${frameTitle(f)}</legend><label class="check-field"><input type="checkbox" class="fac-step-include" ${c.skip ? "" : "checked"}><span>${t("Include in agenda")}</span></label><label class="field">${t("Duration in minutes (optional)")}<input type="number" class="fac-step-minutes" min="0" max="600" value="${c.minutes || 0}"></label><div class="field"><span id="${id}-label">${t("Instructions")}</span><div id="${id}" data-fac-agenda-text></div></div></fieldset>`;
          })
          .join(
            "",
          )}<div class="dialog-footer"><button class="primary" type="submit">${t("Save agenda")}</button></div></form></details>`
      : "";
    return `${status}${controls}${steps.length ? list : `<p class="dialog-copy">${t("All frames are excluded from the agenda.")}</p>`}${editor}`;
  }
  function peopleTab() {
    const session = api.session();
    if (!shared() || !session)
      return `<p class="dialog-copy">${t("Share this board to invite participants.")}</p>`;
    const m = manage(),
      mine = role(),
      people = new Map();
    for (const p of api.roster()) {
      const entry = people.get(p.user) || { ...p, sessions: [] };
      entry.sessions.push(p.session);
      people.set(p.user, entry);
    }
    const rows = [...people.values()].sort((a, b) =>
      a.username.localeCompare(b.username),
    );
    return `<h3>${fill("Present now ({count})", { count: rows.length })}</h3><ul class="fac-people">${rows
      .map((p) => {
        const self = p.user === me().id;
        const editable =
          m &&
          !self &&
          p.role !== "owner" &&
          (mine === "owner" || p.role !== "facilitator");
        const options = [...new Set([p.role, ...assignableRoles(mine)])];
        return `<li><span class="fac-person">${user(p.username)}${self ? ` (${t("you")})` : ""}</span><span class="badge">${t(ROLE_LABELS[p.role] || p.role)}</span>${p.guest ? `<span class="badge">${t("Guest")}</span>` : ""}${
          editable
            ? `<label class="sr-only" for="fac-role-${escape(p.user)}">${escape(`${t("Access for")} ${p.username}`)}</label><select id="fac-role-${escape(p.user)}" data-fac-role="${escape(p.user)}">${options.map((r) => `<option value="${r}" ${r === p.role ? "selected" : ""}>${t(ROLE_LABELS[r])}</option>`).join("")}</select><button type="button" class="text-btn" data-fac="remove" data-id="${escape(p.user)}" aria-label="${escape(`${t("Remove")} ${p.username}`)}">${t("Remove")}</button>`
            : ""
        }${m && !self ? `<button type="button" class="text-btn" data-fac="follow" data-id="${escape(p.sessions[0])}" aria-label="${escape(labelled(t("Ask to follow you"), p.username))}">${t("Ask to follow you")}</button>` : ""}</li>`;
      })
      .join(
        "",
      )}</ul>${m ? `<div class="fac-actions"><button type="button" class="secondary" data-fac="bring">${t("Bring everyone to my view")}</button></div>` : ""}`;
  }
  function summaryTab() {
    const summary = engagement(board(), { now: now(), label });
    const max = Math.max(
      1,
      ...summary.timeline.map(
        (b) => b.notes + b.comments + b.reactions + b.votes + b.answers,
      ),
    );
    return `<p class="dialog-copy">${summary.session ? fill("From {start} to {end}.", { start: date(summary.from), end: time(summary.to) }) : t("No workshop session was started, so the summary covers all recorded activity.")}</p><dl class="fac-totals">${[
      ["Participants", summary.totals.participants],
      ["Notes", summary.totals.notes],
      ["Comments", summary.totals.comments],
      ["Reactions", summary.totals.reactions],
      ["Votes", summary.totals.votes],
      ["Poll answers", summary.totals.answers],
    ]
      .map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`)
      .join(
        "",
      )}</dl>${summary.anonymous ? `<p class="dialog-copy">${t("Anonymous input is on, so contributions are shown in aggregate.")}</p>` : ""}<h3 id="fac-summary-table-heading">${t("Contributions per participant")}</h3>${
      summary.people.length
        ? `<div id="fac-summary-table" class="fac-table-wrap" role="region" aria-labelledby="fac-summary-table-heading" tabindex="0"><table class="fac-table"><thead><tr><th scope="col">${t("Name")}</th><th scope="col">${t("Notes")}</th><th scope="col">${t("Comments")}</th><th scope="col">${t("Reactions")}</th><th scope="col">${t("Votes")}</th><th scope="col">${t("Poll answers")}</th></tr></thead><tbody>${summary.people
            .map(
              (p) =>
                `<tr><th scope="row">${user(p.name)}</th><td>${p.notes}</td><td>${p.comments}</td><td>${p.reactions}</td><td>${p.votes}</td><td>${p.answers}</td></tr>`,
            )
            .join(
              "",
            )}${summary.anonymousNotes ? `<tr><th scope="row">${t("Anonymous notes")}</th><td>${summary.anonymousNotes}</td><td></td><td></td><td></td><td></td></tr>` : ""}</tbody></table></div>`
        : `<p class="dialog-copy">${t("No participation recorded yet.")}</p>`
    }<h3>${t("Activity over time")}</h3><ol class="fac-results">${summary.timeline
      .map((b) => {
        const n = b.notes + b.comments + b.reactions + b.votes + b.answers;
        return `<li><div class="fac-result-row"><span>${time(b.at)}</span><span class="fac-result-count">${fill("{count} actions", { count: n })}</span></div><div class="fac-bar" aria-hidden="true"><span style="width:${Math.round((n / max) * 100)}%"></span></div></li>`;
      })
      .join("")}</ol><h3>${t("Most reacted objects")}</h3>${
      summary.reacted.length
        ? `<ol class="fac-rank">${summary.reacted.map((r) => `<li>${labelHTML(r.id)} · ${fill("{count} reactions", { count: r.count })}</li>`).join("")}</ol>`
        : `<p class="dialog-copy">${t("No reactions yet.")}</p>`
    }<h3>${t("Most voted objects")}</h3>${
      summary.voted.length
        ? `<ol class="fac-rank">${summary.voted.map((r) => `<li>${labelHTML(r.id)} · ${fill("{count} votes", { count: r.count })}</li>`).join("")}</ol>`
        : `<p class="dialog-copy">${t("No votes yet.")}</p>`
    }<div class="fac-actions"><button type="button" class="primary" data-fac="summary-csv">${t("Export summary as CSV")}</button></div>`;
  }
  function historyTab() {
    const records = historyRecords(board());
    if (!records.length)
      return `<p class="dialog-copy">${t("Completed votes and polls appear here.")}</p>`;
    return `<ul class="fac-history">${records
      .map(relabel)
      .map((r) => {
        const total = r.results.reduce((sum, x) => sum + x.count, 0);
        // Hidden results stay with the facilitators, as in the live session.
        // Facilitators can still reveal them once a new vote or poll began.
        const shown = !r.hidden || manage();
        const titleId = `fac-history-title-${r.id}`;
        const action = (key, text) => {
          const actionId = `fac-${key}-${r.id}`;
          return `<button type="button" class="text-btn" data-fac="${key}" data-id="${escape(r.id)}" aria-labelledby="${actionId} ${titleId}"><span id="${actionId}">${t(text)}<span class="sr-only">${language === "fr" ? " :" : ":"}</span></span></button>`;
        };
        return `<li><details><summary><strong id="${titleId}">${authoredTextHTML({ lang: r.titleLang, textRuns: r.titleRuns }, r.title)}</strong> · ${t(r.kind === "vote" ? "Dot vote" : "Poll")} · ${date(r.endedAt)} · ${fill("{count} participants", { count: r.participants })}</summary>${r.hidden && manage() ? `<p class="dialog-copy">${t("Only facilitators can see these results until you reveal them.")}</p>` : ""}${shown ? bars(r.results, total, r.kind === "vote" ? "{count} votes" : "{count} responses", (row) => authoredTextHTML(row, row.label)) : `<p class="dialog-copy">${t("Results are hidden until the facilitator reveals them.")}</p>`}</details>${shown ? `<div class="fac-actions">${r.hidden ? action("history-reveal", "Reveal results") : ""}${action("history-csv", "Export CSV")}${action("history-json", "Export JSON")}</div>` : ""}</li>`;
      })
      .join("")}</ul>`;
  }
  const RENDER = {
    session: sessionTab,
    vote: voteTab,
    poll: pollTab,
    agenda: agendaTab,
    people: peopleTab,
    summary: summaryTab,
    history: historyTab,
  };
  const tabs = () => TABS.filter(([key]) => key !== "summary" || manage());
  function renderPanel(force = false) {
    if (!panel) return;
    const b = board();
    if (!b) return;
    const available = tabs();
    if (!available.some(([key]) => key === tab)) tab = available[0][0];
    const list = panel.querySelector('[role="tablist"]');
    const markup = available
      .map(
        ([key, text]) =>
          `<button type="button" role="tab" id="fac-tab-${key}" aria-controls="fac-tabpanel" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}" data-tab="${key}">${t(text)}</button>`,
      )
      .join("");
    if (list.dataset.markup !== markup) {
      const focused = list.contains(document.activeElement);
      list.innerHTML = markup;
      list.dataset.markup = markup;
      if (focused) list.querySelector('[aria-selected="true"]')?.focus();
    }
    const w = b.workshop || {};
    // Only the open tab's inputs are gathered; this runs on every draw.
    const inputs = {
      session: () => [
        w.settings,
        w.session,
        b.items.length,
        orderedFrames(b.items).map((f) => [f.id, f.text, f.lang, f.textRuns]),
      ],
      vote: () => [
        w.vote,
        // Ballots change only with the workshop, which is replaced on edits.
        w.vote &&
          memo("vote-ballots", [b.workshop], () =>
            JSON.stringify(ballots(b, w.vote.id)),
          ),
        w.vote && voteOpen(w.vote, now()),
        w.vote?.endsAt && Math.ceil((w.vote.endsAt - now()) / 60000),
        orderedFrames(b.items).map((f) => [f.id, f.text, f.lang, f.textRuns]),
        w.vote && w.vote.targets.map(labelHTML),
      ],
      poll: () => [w.poll, w.poll && answers(b, w.poll.id)],
      agenda: () => [
        w.agenda,
        w.run,
        orderedFrames(b.items).map((f) => [f.id, f.text, f.lang, f.textRuns]),
        // Revealing or hiding a frame changes which step titles show.
        visibleSteps(b).map((s) => [s.title, !!s.titleHidden]),
      ],
      people: () => [
        api.roster().map((p) => [p.user, p.role, p.username]),
        role(),
      ],
      // The summary also counts objects and runs to the current minute.
      summary: () => {
        const summary = memo(
          "summary-inputs",
          [b.workshop, b.comments, b.items, Math.floor(now() / 60000)],
          () => {
            const value = engagement(b, { now: now(), label });
            return {
              signature: JSON.stringify(value),
              ids: [...value.reacted, ...value.voted].map((r) => r.id),
            };
          },
        );
        return [summary.signature, summary.ids.map(labelHTML)];
      },
      history: () => {
        // Saved labels follow what is hidden from this person now.
        const c = concealed(),
          ids = memo("history-live-labels", [b.workshop, c], () => [
            ...new Set(
              historyRecords(b).flatMap((record) =>
                record.results
                  .filter((row) => coveredResult(row, c))
                  .map((row) => row.id),
              ),
            ),
          ]),
          labels = JSON.stringify(ids.map(labelContent));
        return [
          memo("history-inputs", [b.workshop, c, labels], () =>
            JSON.stringify(historyRecords(b).map(relabel)),
          ),
        ];
      },
    }[tab]();
    // Parts are compared one by one; cached strings are not copied again.
    const signature = [
      tab,
      manage(),
      api.canParticipate(),
      language,
      ...inputs.map((v) => (typeof v === "string" ? v : JSON.stringify(v))),
    ];
    if (
      !force &&
      tabSignature?.length === signature.length &&
      signature.every((v, n) => v === tabSignature[n])
    )
      return;
    tabSignature = signature;
    const content = panel.querySelector("#fac-tabpanel");
    content.setAttribute("aria-labelledby", `fac-tab-${tab}`);
    // Keep drafts and focus when the same controls are rebuilt.
    const fields = new Map(
      [...content.querySelectorAll(".fac-authored-input")].map((input) => [
        input.id,
        input.languageState(),
      ]),
    );
    const values = new Map(),
      active = content.contains(document.activeElement)
        ? document.activeElement
        : null;
    const keyOf = (el) =>
      el.id ||
      (el.name && `${el.name}=${el.value}`) ||
      (el.closest(".fac-choices") &&
        `${el.closest(".fac-choices").id}=${el.value}`) ||
      (el.closest("[data-step]") &&
        `${el.closest("[data-step]").dataset.step}:${el.className}`);
    // Only drafts are restored; controls showing shared state are not.
    const draft = (el) =>
      !!el.closest("form, .fac-choices") || el.id === "fac-top";
    // Fields left as they were rendered show the latest state instead, so
    // saving a form keeps what another facilitator changed meanwhile.
    const edited = (el) =>
      el.type === "checkbox" || el.type === "radio"
        ? el.checked !== el.defaultChecked
        : el.tagName === "SELECT"
          ? [...el.options].some((o) => o.selected !== o.defaultSelected)
          : el.value !== el.defaultValue;
    for (const el of content.querySelectorAll("input,textarea,select"))
      if (keyOf(el) && draft(el) && edited(el))
        values.set(
          keyOf(el),
          el.type === "checkbox" || el.type === "radio" ? el.checked : el.value,
        );
    const focusKey =
      active &&
      (keyOf(active) ||
        (active.dataset.fac &&
          `${active.dataset.fac}|${active.dataset.id || active.dataset.step || ""}`));
    // Sections someone opened or closed stay that way, and focus can fall
    // back to the control in the same place when its own is gone.
    const focusable = () => [
      ...content.querySelectorAll(
        "input,textarea,select,button,summary,.fac-authored-input,#fac-summary-table",
      ),
    ];
    const position = active ? focusable().indexOf(active) : -1;
    const sections = new Map(
      [...content.querySelectorAll("details")].map((d) => [
        d.querySelector("summary")?.textContent,
        d.open,
      ]),
    );
    for (const input of content.querySelectorAll(".fac-authored-input"))
      input.destroy();
    const summaryScroll =
      content.querySelector("#fac-summary-table")?.scrollLeft;
    content.innerHTML = `${RENDER[tab]()}<p id="fac-error" class="fac-error" role="alert" hidden></p>`;
    const summaryTable = content.querySelector("#fac-summary-table");
    if (summaryTable && summaryScroll !== undefined)
      summaryTable.scrollLeft = summaryScroll;
    const titleField = content.querySelector(
      "#fac-vote-title[data-fac-authored]",
    );
    if (titleField)
      createAuthoredField(
        titleField,
        { text: t("Dot vote"), lang: language },
        { maxLength: 200, multiline: false },
      );
    const questionField = content.querySelector(
      "#fac-poll-question[data-fac-authored]",
    );
    if (questionField)
      createAuthoredField(
        questionField,
        { text: "", lang: language },
        { maxLength: 300, multiline: false, required: true },
      );
    const optionsField = content.querySelector(
      "#fac-poll-options[data-fac-authored]",
    );
    if (optionsField) {
      const field = createAuthoredField(
        optionsField,
        { text: "", lang: language },
        { maxLength: Infinity, multiline: true, required: true },
      );
      field.style.minHeight = "6em";
    }
    const agenda = new Map(
      (w.agenda?.steps || []).map((step) => [step.frame, step]),
    );
    for (const placeholder of content.querySelectorAll(
      "[data-fac-agenda-text]",
    )) {
      const config =
        agenda.get(placeholder.closest("[data-step]").dataset.step) || {};
      const field = createAuthoredField(
        placeholder,
        {
          text: config.text || "",
          lang: config.lang || (config.text ? undefined : language),
          textRuns: config.textRuns,
        },
        { maxLength: 1000, multiline: true },
      );
      field.classList.add("fac-step-text");
      field.style.minHeight = "3em";
    }
    if (!force)
      for (const input of content.querySelectorAll(".fac-authored-input")) {
        const saved = fields.get(input.id);
        if (saved) input.restoreLanguageState(saved);
      }
    for (const d of content.querySelectorAll("details")) {
      const open = sections.get(d.querySelector("summary")?.textContent);
      if (open !== undefined) d.open = open;
    }
    for (const form of content.querySelectorAll("form"))
      form.onsubmit = onPanelSubmit;
    if (!force)
      for (const el of content.querySelectorAll("input,textarea,select")) {
        const key = keyOf(el);
        if (!values.has(key) || !draft(el)) continue;
        if (el.type === "checkbox" || el.type === "radio")
          el.checked = values.get(key);
        else el.value = values.get(key);
      }
    if (active) {
      const usable = (el) =>
        el && !el.disabled && el.getAttribute("aria-disabled") !== "true";
      const same = focusKey
        ? focusable().find(
            (el) =>
              keyOf(el) === focusKey ||
              (el.dataset.fac &&
                `${el.dataset.fac}|${el.dataset.id || el.dataset.step || ""}` ===
                  focusKey),
          )
        : null;
      const nearby = focusable().slice(Math.max(0, position)).find(usable);
      (usable(same) ? same : nearby || content).focus({ preventScroll: true });
    }
    api.refreshIcons?.();
  }
  function onPanelClick(e) {
    const tabButton = e.target.closest("[data-tab]");
    if (tabButton) return selectTab(tabButton.dataset.tab, true);
    const button = e.target.closest("[data-fac]");
    if (
      !button ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true"
    )
      return;
    const b = board(),
      w = b?.workshop || {},
      id = button.dataset.id;
    const shownStep = () => Math.max(0, runStep(w.run, agendaSteps(b)));
    const actions = {
      "session-start": () => toggleSession(true),
      "session-end": () => toggleSession(false),
      bring: () => api.bring(),
      follow: () => api.follow(id),
      "private-on": () => setSetting({ private: newId() }),
      "private-reveal": () => setSetting({ private: null }),
      "stage-start": () => {
        const chosen = new Set(
          [...panel.querySelectorAll("#fac-stage-frames input:checked")].map(
            (i) => i.value,
          ),
        );
        const frames = orderedFrames(b.items)
          .filter((f) => chosen.has(f.id))
          .map((f) => f.id);
        if (!frames.length) return showError("Choose at least one frame.");
        // Frames past the limit would stay in view, so none are staged.
        if (frames.length > WORKSHOP_LIMITS.steps)
          return showError(
            fill("Choose up to {count} frames to reveal one at a time.", {
              count: WORKSHOP_LIMITS.steps,
            }),
          );
        setSetting({ stage: { frames, shown: 0 } });
      },
      "stage-next": () => {
        const stage = settings().stage;
        if (!stage) return;
        const shown = stage.shown + 1;
        setSetting({
          stage: shown >= stage.frames.length ? null : { ...stage, shown },
        });
        const frame = b.items.find((i) => i.id === stage.frames[stage.shown]);
        if (frame) {
          api.focusFrame(frame);
          api.bring();
        }
      },
      "stage-all": () => setSetting({ stage: null }),
      "vote-add": () => vote(id, 1),
      "vote-remove": () => vote(id, -1),
      "vote-end": () => endSession("vote"),
      "vote-reveal": () => reveal("vote", true),
      "vote-hide": () => reveal("vote", false),
      "vote-clear": () =>
        change((x, b) => {
          // A timed vote stays active briefly after its deadline for late
          // ballots; its result is saved before the ballots are cleared.
          if (x.vote?.state === "active") finish(x, b, "vote");
          for (const key of Object.keys(x))
            if (keyKind(key) === "v") delete x[key];
          delete x.vote;
        }),
      "vote-top": () => {
        const n = Math.max(1, +panel.querySelector("#fac-top").value || 1);
        const present = new Set(b.items.map((i) => i.id));
        const ids = voteTally(b, w.vote)
          .filter((r) => r.count > 0 && present.has(r.id))
          .slice(0, n)
          .map((r) => r.id);
        if (!ids.length) return showError("No votes yet.");
        api.select(new Set(ids));
        announce(fill("{count} objects selected.", { count: ids.length }));
      },
      "vote-csv": () => download(currentRecord("vote"), "csv"),
      "vote-json": () => download(currentRecord("vote"), "json"),
      "poll-close": () => endSession("poll"),
      "poll-reveal": () => reveal("poll", true),
      "poll-hide": () => reveal("poll", false),
      "poll-clear": () =>
        change((x) => {
          for (const key of Object.keys(x))
            if (keyKind(key) === "a") delete x[key];
          delete x.poll;
        }),
      "poll-csv": () => download(currentRecord("poll"), "csv"),
      "poll-json": () => download(currentRecord("poll"), "json"),
      "agenda-start": () => goToStep(0, true),
      // Steps move from the step shown, which may be clamped when frames
      // were deleted during the run.
      "agenda-next": () => goToStep(shownStep() + 1),
      "agenda-prev": () => goToStep(shownStep() - 1),
      "agenda-go": () =>
        goToStep(+button.dataset.step, w.run?.state !== "running"),
      "agenda-end": () =>
        change((x) => x.run && (x.run = { ...x.run, state: "ended" })),
      remove: () => setRole(id, "removed"),
      "summary-csv": () =>
        api.download(
          engagementCSV(engagement(b, { now: now(), label })),
          "workshop-summary.csv",
          "text/csv;charset=utf-8",
        ),
      "history-csv": () => download(w[historyKey(id)], "csv"),
      "history-json": () => download(w[historyKey(id)], "json"),
      // A vote or poll still in its tab is revealed there too.
      "history-reveal": () =>
        w.vote?.id === id
          ? reveal("vote", true)
          : w.poll?.id === id
            ? reveal("poll", true)
            : change((x) => {
                const record = x[historyKey(id)];
                if (record) x[historyKey(id)] = { ...record, hidden: false };
              }),
    };
    actions[button.dataset.fac]?.();
  }
  function onPanelChange(e) {
    if (e.target.id === "fac-anonymous")
      setSetting({ anonymous: e.target.checked });
    else if (e.target.name === "fac-lock") setSetting({ lock: e.target.value });
    else if (e.target.dataset.facRole)
      setRole(e.target.dataset.facRole, e.target.value);
  }
  function onPanelSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (form.id === "fac-vote-form") startVote(form);
    else if (form.id === "fac-poll-form") startPoll(form);
    else if (form.id === "fac-answer-form") answerPoll(form);
    else if (form.id === "fac-agenda-form") saveAgenda(form);
  }
  function selectTab(key, focus = false) {
    tab = key;
    tabSignature = null;
    renderPanel(true);
    if (focus) panel.querySelector(`#fac-tab-${key}`)?.focus();
  }
  function open(next) {
    if (!host || !board()) return;
    api.prepare?.();
    boardId = board().id;
    if (!panel) {
      // Closing returns focus to the control that opened the panel, such
      // as a banner chip; otherwise it goes to the Facilitation button.
      const origin = document.activeElement;
      opener = origin?.closest?.(
        '[data-fac-open], [data-action="facilitation"]',
      )
        ? origin
        : null;
      panel = document.createElement("section");
      panel.id = "facilitation-panel";
      panel.className = "facilitation-panel panel";
      panel.setAttribute("aria-labelledby", "facilitation-heading");
      panel.innerHTML = `<header><h2 id="facilitation-heading" tabindex="-1">${t("Facilitation")}</h2><button type="button" class="icon-btn" id="facilitation-close" aria-label="${t("Close facilitation")}">${api.icon("x")}</button></header><div role="tablist" aria-label="${t("Facilitation sections")}"></div><div id="fac-tabpanel" role="tabpanel" tabindex="0"></div>`;
      host.append(panel);
      panel.querySelector("#facilitation-close").onclick = () => close();
      panel.addEventListener("click", onPanelClick);
      panel.addEventListener("change", onPanelChange);
      for (const event of ["copy", "cut", "paste"])
        panel.addEventListener(event, (e) => e.stopPropagation());
      panel.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          close();
          return;
        }
        if (
          e.target.id === "fac-summary-table" &&
          !e.defaultPrevented &&
          !e.isComposing &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.shiftKey &&
          ["ArrowLeft", "ArrowRight"].includes(e.key)
        ) {
          const scrolling = e.target;
          const maximum = scrolling.scrollWidth - scrolling.clientWidth;
          if (maximum > 0) {
            e.preventDefault();
            scrolling.scrollLeft = Math.max(
              0,
              Math.min(
                maximum,
                scrolling.scrollLeft + (e.key === "ArrowRight" ? 48 : -48),
              ),
            );
          }
          return;
        }
        const current = e.target.closest('[role="tab"]');
        if (
          current &&
          ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
        ) {
          e.preventDefault();
          const keys = tabs().map(([k]) => k),
            at = keys.indexOf(current.dataset.tab);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? keys.length - 1
                : (at + (e.key === "ArrowRight" ? 1 : -1) + keys.length) %
                  keys.length;
          selectTab(keys[next], true);
        }
      });
    }
    tab =
      next ||
      tab ||
      (manage()
        ? "session"
        : board().workshop?.vote
          ? "vote"
          : board().workshop?.poll
            ? "poll"
            : "session");
    tabSignature = null;
    renderPanel(true);
    document
      .querySelectorAll('[data-action="facilitation"]')
      .forEach((b) => b.setAttribute("aria-expanded", "true"));
    panel.querySelector("#facilitation-heading").focus();
  }
  function close(focus = true) {
    if (!panel) return;
    for (const input of panel.querySelectorAll(".fac-authored-input"))
      input.destroy();
    panel.remove();
    panel = null;
    tabSignature = null;
    document
      .querySelectorAll('[data-action="facilitation"]')
      .forEach((b) => b.setAttribute("aria-expanded", "false"));
    // A banner chip redrawn meanwhile is found again by its section.
    const back = opener?.isConnected
      ? opener
      : opener?.dataset.facOpen
        ? document.querySelector(`[data-fac-open="${opener.dataset.facOpen}"]`)
        : null;
    opener = null;
    if (focus)
      (
        back ||
        document.querySelector(
          '.canvas-navigation [data-action="facilitation"]',
        ) ||
        api.canvas()
      )?.focus();
  }

  // The banner sits below the selection toolbar while one is shown, so it
  // never covers the toolbar's controls; the toolbar can be several rows.
  function placeBanner() {
    if (!banner || !host) return;
    const tools = host.querySelector("#selection-tools");
    let top = "";
    if (!banner.hidden && tools && !tools.hidden) {
      const box = tools.getBoundingClientRect();
      if (box.height)
        top = `${Math.round(box.bottom - host.getBoundingClientRect().top + 8)}px`;
    }
    if (banner.style.top !== top) banner.style.top = top;
  }
  // The banner summarizes what participants need to know, and its live
  // region announces session changes.
  function renderBanner() {
    if (!banner) return;
    const b = board(),
      w = b?.workshop || {},
      s = settings();
    const chips = [];
    const steps = w.run?.state === "running" ? visibleSteps(b) : [];
    if (steps.length) {
      const n = runStep(w.run, steps);
      chips.push([
        "agenda",
        fill("Step {n} of {total}: {title}", {
          n: n + 1,
          total: steps.length,
          title: steps[n].title || t("Frame"),
        }),
        steps[n].text,
        fill("Step {n} of {total}: {title}", {
          n: n + 1,
          total: steps.length,
          title: stepTitle(steps[n]),
        }),
        authoredTextHTML(steps[n], steps[n].text),
      ]);
    }
    if (s.private)
      chips.push([
        "session",
        t("Private mode: notes are hidden until revealed"),
      ]);
    if (s.anonymous) chips.push(["session", t("Anonymous input")]);
    if (s.lock === "contribute")
      chips.push(["session", t("Board locked for participants")]);
    if (s.lock === "frozen") chips.push(["session", t("Board frozen")]);
    const v = w.vote;
    if (voteOpen(v, now())) {
      const left = v.votes - myBallot(b, v.id, me().id).length;
      const seconds = v.endsAt
        ? Math.max(0, Math.ceil((v.endsAt - now()) / 1000))
        : 0;
      chips.push([
        "vote",
        labelled(
          t("Voting"),
          `${api.canParticipate() ? fill("{count} votes left", { count: left }) : t("in progress")}${seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}`,
        ),
      ]);
    } else if (v?.revealed) chips.push(["vote", t("Voting results revealed")]);
    if (pollOpen(w.poll)) chips.push(["poll", t("Poll open")]);
    const signature = JSON.stringify([chips, language]);
    if (signature !== bannerSignature) {
      bannerSignature = signature;
      const content = banner.querySelector(".workshop-banner-content");
      const current = [...content.children];
      // The countdown changes every second; chips are updated in place so
      // a chip that has keyboard focus keeps it.
      if (
        current.length === chips.length &&
        chips.every(
          ([key, , detail], n) =>
            current[n].dataset.facOpen === key &&
            !!current[n].querySelector("small") === !!detail,
        )
      )
        chips.forEach(([, text, detail, html, detailHTML], n) => {
          const span = current[n].querySelector("span");
          if (html) span.innerHTML = html;
          else span.textContent = text;
          if (detail)
            current[n].querySelector("small").innerHTML =
              detailHTML || escape(detail);
        });
      else {
        const focused = content.contains(document.activeElement)
          ? document.activeElement.dataset.facOpen
          : null;
        content.innerHTML = chips
          .map(
            ([key, text, detail, html, detailHTML]) =>
              `<button type="button" class="workshop-chip" data-fac-open="${key}"><span data-user-content>${html || escape(text)}</span>${detail ? `<small data-user-content>${detailHTML || escape(detail)}</small>` : ""}</button>`,
          )
          .join("");
        if (focused)
          content.querySelector(`[data-fac-open="${focused}"]`)?.focus();
      }
      banner.hidden = !chips.length;
    }
    placeBanner();
    // Live countdowns update the banner once a second without repainting.
    // The panel redraws only when its minutes left change. At the deadline
    // everything renders once, which ends the vote and updates the panel
    // and the canvas voting controls.
    const counting = voteOpen(v, now()) && v.endsAt;
    if (counting && !ticker)
      ticker = setInterval(() => {
        if (!voteOpen(board()?.workshop?.vote, now())) return render();
        renderBanner();
        renderPanel();
      }, 1000);
    if (!counting && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }
  function announceChanges() {
    const b = board(),
      w = b?.workshop || {};
    const s = settings();
    const steps = w.run?.state === "running" ? visibleSteps(b) : [];
    const state = {
      vote: w.vote && [w.vote.id, voteOpen(w.vote, now()), w.vote.revealed],
      poll: w.poll && [w.poll.id, w.poll.state, w.poll.revealed],
      private: !!s.private,
      lock: s.lock,
      anonymous: s.anonymous,
      stage: s.stage?.shown ?? null,
      step: steps.length
        ? [w.run.id, steps[runStep(w.run, steps)].frame.id]
        : null,
    };
    const old = previous;
    previous = state;
    if (!old) return;
    const messages = [];
    const titleHTML = new Map();
    if (state.vote?.[0] !== old.vote?.[0] && state.vote?.[1]) {
      messages.push(fill("Voting started: {title}", { title: w.vote.title }));
      titleHTML.set(
        0,
        fill("Voting started: {title}", {
          title: authoredTextHTML(
            { lang: w.vote.titleLang, textRuns: w.vote.titleRuns },
            w.vote.title,
          ),
        }),
      );
    } else if (old.vote?.[1] && state.vote && !state.vote[1])
      messages.push(t("Voting ended."));
    if (state.vote?.[2] && !old.vote?.[2])
      messages.push(t("Voting results revealed."));
    if (state.poll?.[0] !== old.poll?.[0] && state.poll?.[1] === "open") {
      titleHTML.set(
        messages.length,
        fill("Poll started: {title}", {
          title: authoredTextHTML(
            { lang: w.poll.questionLang, textRuns: w.poll.questionRuns },
            w.poll.question,
          ),
        }),
      );
      messages.push(fill("Poll started: {title}", { title: w.poll.question }));
    } else if (old.poll?.[1] === "open" && state.poll?.[1] === "closed")
      messages.push(t("The poll closed."));
    if (state.private !== old.private)
      messages.push(
        t(state.private ? "Private mode is on." : "Contributions revealed."),
      );
    if (state.lock !== old.lock)
      messages.push(
        t(
          {
            open: "The board is open for editing.",
            contribute:
              "The board is locked. You can add sticky notes, vote, react, and comment.",
            frozen: "The board is frozen. You can vote, react, and comment.",
          }[state.lock],
        ),
      );
    if (state.anonymous !== old.anonymous)
      messages.push(
        t(
          state.anonymous
            ? "Anonymous input is on."
            : "Anonymous input is off.",
        ),
      );
    // Staging hides frames, each reveal shows one more, and ending it (or
    // revealing the last) shows them all.
    if (state.stage !== old.stage)
      messages.push(
        t(
          old.stage === null
            ? "The facilitator is revealing frames one at a time."
            : state.stage === null
              ? "All frames are visible."
              : "The facilitator revealed another frame.",
        ),
      );
    let stepHTML;
    if (state.step && !same(state.step, old.step)) {
      const n = runStep(w.run, steps);
      messages.push(
        fill("Step {n} of {total}: {title}", {
          n: n + 1,
          total: steps.length,
          title: steps[n].title || t("Frame"),
        }),
      );
      stepHTML = fill("Step {n} of {total}: {title}", {
        n: n + 1,
        total: steps.length,
        title: stepTitle(steps[n]),
      });
    }
    if (messages.length)
      announce(
        titleHTML.size || stepHTML
          ? messages
              .map(
                (message, n) =>
                  titleHTML.get(n) ||
                  (n === messages.length - 1 && stepHTML) ||
                  escape(message),
              )
              .join(" ")
          : messages.join(" "),
        !!(titleHTML.size || stepHTML),
      );
  }
  function render() {
    const b = board();
    if (!host || !b) return;
    if (boardId !== b.id) {
      boardId = b.id;
      previous = null;
      close(false);
    }
    // A timed vote closes at its deadline; a facilitator records the result
    // once ballots cast just before it have had the worker's grace period
    // to arrive, so the saved result matches the live tally.
    const v = b.workshop?.vote;
    if (
      manage() &&
      v?.state === "active" &&
      v.endsAt &&
      now() >= v.endsAt &&
      !pending
    )
      pending = setTimeout(
        () => {
          pending = null;
          const latest = board()?.workshop?.vote;
          if (latest?.id === v.id && latest.state === "active")
            endSession("vote");
        },
        Math.max(0, v.endsAt + VOTE_GRACE - now()),
      );
    // Ballots and poll answers the worker accepted before the end can still
    // arrive after the result was saved; the saved result is brought up to
    // date for a minute. Saved labels are kept: each facilitator names
    // objects in their own language and sees different private notes, and
    // rewriting them would have facilitators overwrite each other.
    const savedLabel = (record) => {
      const names = new Map(
        record.results?.map((r) => [
          r.id,
          {
            text: r.label,
            ...(r.lang !== undefined ? { lang: r.lang } : {}),
            ...(r.textRuns?.length ? { textRuns: r.textRuns } : {}),
          },
        ]),
      );
      return (id) => names.get(id) ?? labelContent(id);
    };
    for (const [kind, ended] of [
      ["vote", "ended"],
      ["poll", "closed"],
    ]) {
      const session = b.workshop?.[kind],
        saved = session && b.workshop[historyKey(session.id)];
      if (
        !manage() ||
        session?.state !== ended ||
        !saved ||
        now() - saved.endedAt >= 60_000 ||
        pending
      )
        continue;
      // Draws repeat far more often than entries change.
      const outdated = memo(`catch-up-${kind}`, [b.workshop, b.items], () => {
        const fresh = resultRecord(b, kind, savedLabel(saved), saved.endedAt);
        return (
          fresh.participants !== saved.participants ||
          JSON.stringify(fresh.results) !== JSON.stringify(saved.results)
        );
      });
      if (outdated)
        pending = setTimeout(() => {
          pending = null;
          change((w, latest) => {
            const key = historyKey(session.id);
            if (w[kind]?.id !== session.id || !w[key]) return;
            w[key] = resultRecord(
              { ...latest, workshop: w },
              kind,
              savedLabel(w[key]),
              saved.endedAt,
            );
          });
        }, 0);
    }
    // Revealing a vote or poll while another facilitator ends it can leave
    // its saved result hidden once the changes merge; the result follows
    // the session.
    for (const [kind, ended] of [
      ["vote", "ended"],
      ["poll", "closed"],
    ]) {
      const session = b.workshop?.[kind],
        saved = session && b.workshop[historyKey(session.id)];
      if (
        manage() &&
        session?.state === ended &&
        saved &&
        !pending &&
        saved.hidden !== (!!session.hidden && !session.revealed)
      )
        pending = setTimeout(() => {
          pending = null;
          change((w) => {
            const record = w[historyKey(session.id)];
            if (w[kind]?.id !== session.id || !record) return;
            const hidden = !!w[kind].hidden && !w[kind].revealed;
            if (record.hidden !== hidden)
              w[historyKey(session.id)] = { ...record, hidden };
          });
        }, 0);
    }
    if (
      b.workshop?.session?.state === "active" &&
      b.shared &&
      Date.now() - checkedAt >= 10000
    ) {
      checkedAt = Date.now();
      setTimeout(recordAttendance, 0);
    }
    overlay.render();
    renderBanner();
    announceChanges();
    renderPanel();
  }
  function bind(element) {
    detach();
    host = element;
    if (!host) return;
    banner = document.createElement("div");
    banner.id = "workshop-banner";
    banner.className = "workshop-banner panel";
    banner.hidden = true;
    banner.innerHTML = `<div class="workshop-banner-content"></div>`;
    live = document.createElement("p");
    live.id = "facilitation-live";
    live.className = "sr-only";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    host.append(banner, live);
    banner.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-fac-open]");
      if (chip) open(chip.dataset.facOpen);
    });
    overlay.bind(host);
    // Objects already on the board when it opens are not new contributions.
    knownBoard = board()?.id;
    known = new Set(board()?.items.map((i) => i.id) || []);
    bannerSignature = null;
    previous = null;
  }
  function detach() {
    close(false);
    overlay.detach();
    banner?.remove();
    live?.remove();
    banner = live = host = null;
    clearInterval(ticker);
    ticker = null;
    clearTimeout(pending);
    pending = null;
  }

  // Views of the board for this participant.
  function visible(items) {
    const hidden = concealed().hidden;
    if (!hidden.size) return items;
    // Objects can be added to the same list, so its length counts too.
    return memo("visible", [items, items.length, hidden], () =>
      items.filter((i) => !hidden.has(i.id)),
    );
  }
  // A covered object's stand-in keeps its identity from draw to draw, so
  // its measured text layout is reused; it follows the object each time.
  const standIns = new WeakMap();
  function standIn(i, cover, drop = []) {
    let out = standIns.get(i);
    if (!out) standIns.set(i, (out = {}));
    for (const key of Object.keys(out)) if (!(key in i)) delete out[key];
    Object.assign(out, i, cover);
    for (const key of drop) delete out[key];
    return out;
  }
  // What a face-down note or covered frame keeps to itself besides its text:
  // formatting, task details, tags, and where its link goes.
  const COVERED = ["textRuns", "textBlocks", "task", "tagIds", "objectLink"];
  function cover(items, c) {
    return items.map((i) => {
      if (c.notes.has(i.id))
        return standIn(
          i,
          {
            text: t("Private note"),
            lang: language,
            color: "#d9d6cc",
            textColor: "#4c4a45",
          },
          COVERED,
        );
      if (c.frames.has(i.id))
        return standIn(
          i,
          { text: t("Hidden by the facilitator"), lang: language },
          COVERED,
        );
      return i;
    });
  }
  function conceal(items) {
    const c = concealed();
    if (!c.notes.size && !c.frames.size) return items;
    return memo("conceal-items", [items, c, language], () => cover(items, c));
  }
  // A new personal board made from this board or one of its versions holds
  // only what this person may see, and no live workshop. Returns how many
  // objects were left out or covered.
  function portableCopy(copy, who = { id: me().id, manager: manage() }) {
    const c = concealment(copy, who.id, who.manager);
    const covered = c.notes.size + c.frames.size + c.hidden.size;
    if (covered)
      copy.items = structuredClone(
        cover(
          copy.items.filter((i) => !c.hidden.has(i.id)),
          c,
        ),
      );
    copy.workshop = who.manager
      ? portableWorkshop(copy.workshop)
      : portableFor(copy.workshop, c);
    if (!copy.workshop) delete copy.workshop;
    return covered;
  }
  // What a copy or export keeps of the workshop for someone who does not
  // run it: saved results name hidden objects by their placeholder, results
  // never revealed stay out, and hidden steps keep no instructions.
  function portableFor(workshop, c) {
    const kept = portableWorkshop(workshop);
    if (!kept) return kept;
    const covered = (id) =>
      c.notes.has(id) || c.hidden.has(id) || c.frames.has(id);
    const name = (id) =>
      t(c.notes.has(id) ? "Private note" : "Hidden by the facilitator");
    for (const [key, record] of Object.entries(kept)) {
      if (keyKind(key) !== "h") continue;
      if (record.hidden) delete kept[key];
      else if (record.results?.some((x) => covered(x.id)))
        kept[key] = {
          ...record,
          results: record.results.map((x) =>
            covered(x.id)
              ? labelledResult(x, { text: name(x.id), lang: language })
              : x,
          ),
        };
    }
    if (kept.agenda?.steps)
      kept.agenda = {
        ...kept.agenda,
        steps: kept.agenda.steps.map((step) => {
          if (!covered(step.frame)) return step;
          const { text: _, lang: _lang, textRuns: _runs, ...rest } = step;
          return rest;
        }),
      };
    return Object.keys(kept).length ? kept : undefined;
  }
  function masked(value) {
    if (!value) return value;
    const items = conceal(visible(value.items));
    return items === value.items ? value : { ...value, items };
  }
  // Locks and hidden notes protect objects in every editing path.
  function locked(ids) {
    const b = board();
    if (!b || !ids?.size) return false;
    const c = concealed();
    for (const id of ids)
      if (c.notes.has(id) || c.frames.has(id) || c.hidden.has(id)) return true;
    if (!b.shared || manage()) return false;
    const s = settings();
    if (s.lock === "frozen") return true;
    return (
      s.lock === "contribute" &&
      [...ids].some((id) => b.workshop?.[contributionKey(id)]?.by !== me().id)
    );
  }
  // Cursors and editing indicators without names. Their color follows the
  // browser session rather than the account, so it cannot be matched to the
  // colored names in Participants.
  function people(map) {
    if (!settings().anonymous || !map?.size) return map;
    return new Map(
      [...map].map(([id, p]) => [
        id,
        { ...p, user: id, username: t("Participant") },
      ]),
    );
  }
  // JSON exports keep reusable workshop content, not the live session, and
  // never include another participant's hidden notes.
  function portable(exported) {
    const items = conceal(visible(exported.items));
    if (items !== exported.items) exported.items = structuredClone(items);
    if (exported.workshop)
      exported.workshop = manage()
        ? portableWorkshop(exported.workshop)
        : portableFor(exported.workshop, concealed());
    if (!exported.workshop) delete exported.workshop;
  }
  return {
    bind,
    detach,
    render,
    open,
    close,
    toggle: (next) => (panel ? close() : open(next)),
    isOpen: () => !!panel,
    beforeSave,
    visible,
    conceal,
    masked,
    locked,
    // Whether a locked board or a private round limits what this person
    // changes, and if so, why a change that skips the editor's save, such
    // as undo on a shared board, is refused (null when it is allowed).
    restricts() {
      const s = settings();
      return (
        !!board()?.shared &&
        !manage() &&
        ((!!s.lock && s.lock !== "open") || !!s.private)
      );
    },
    // Whether participants cannot see an object: hidden, or in a hidden or
    // staged frame. A new object counts by the frame it is drawn in, so live
    // previews of it are kept from them too.
    unseen(i) {
      const b = board();
      if (!i || !b?.shared || !b.workshop) return false;
      const c = memo("unseen", [b.workshop, b.items], () => {
        const u = concealment(b, "", false);
        return new Set([...u.hidden, ...u.frames]);
      });
      return c.has(i.id) || (!!i.parentId && c.has(i.parentId));
    },
    // Whether a locked or frozen board keeps this person from changing the
    // board's title, tags, timer and plan.
    boardLocked() {
      const lock = settings().lock;
      return !!board()?.shared && !manage() && !!lock && lock !== "open";
    },
    // Whether the lock also holds for someone else with this board role.
    lockedFor(role) {
      const lock = settings().lock;
      return !!board()?.shared && !canManage(role) && !!lock && lock !== "open";
    },
    // Why this person cannot change content on a frozen board, or null.
    frozen() {
      return board()?.shared && !manage() && settings().lock === "frozen"
        ? "The facilitator froze this board."
        : null;
    },
    refusal(before, after) {
      try {
        validateWorkshopChanges(
          before,
          after,
          { uuid: me().id, username: me().name },
          role(),
          now(),
        );
        return null;
      } catch (error) {
        return error.message;
      }
    },
    // Objects this person must not see or copy: other people's private
    // notes, staged frames, and objects the facilitator hid.
    concealedIds() {
      const c = concealed();
      return new Set([...c.notes, ...c.frames, ...c.hidden]);
    },
    // Objects left out of this person's view entirely, unlike face-down
    // notes and covered frames, which show as placeholders.
    absent: (id) => concealed().hidden.has(id),
    // The same for another state of a board, such as an earlier version.
    concealedIn(other) {
      const c = concealment(other, me().id, manage());
      return new Set([...c.notes, ...c.frames, ...c.hidden]);
    },
    people,
    portable,
    portableCopy,
    commentReactions: (thread, message) =>
      overlay.commentReactions(thread, message),
    react: (id, type) => react(objectTarget(id), type),
    // Hide objects from participants (facilitators still see them, marked).
    canHide: () => manage(),
    // Objects in a hidden frame are hidden with it.
    hidden: (id) => hiddenFromParticipants().has(id),
    setHidden(ids, hide) {
      if (!manage()) return api.toast?.("Only facilitators can hide objects.");
      const current = new Set(settings().hide || []);
      // Selecting a frame selects what it holds; hiding the frame already
      // hides its contents, so only the frame is stored.
      const chosen = new Set(ids),
        byId = new Map(board().items.map((i) => [i.id, i]));
      if (hide)
        ids = ids.filter((id) => {
          const parent = byId.get(byId.get(id)?.parentId);
          return !(parent?.type === "frame" && chosen.has(parent.id));
        });
      for (const id of ids) hide ? current.add(id) : current.delete(id);
      const list = [...current].filter((id) =>
        board().items.some((i) => i.id === id),
      );
      if (list.length > WORKSHOP_LIMITS.hidden)
        return api.toast?.("Up to 500 objects can be hidden.");
      setSetting({ hide: list });
      // Showing an object inside a hidden frame leaves it hidden with the
      // frame, so say that rather than that it is shown.
      const still = !hide && ids.some((id) => hiddenFromParticipants().has(id));
      api.toast?.(
        hide
          ? "Hidden from participants. You still see these objects."
          : still
            ? "Objects in a hidden frame stay hidden until the frame is shown."
            : "Shown to participants.",
      );
    },
  };
}
