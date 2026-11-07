import { escape } from "../model.js";
import { busy } from "../accessibility/busy.js";
import { t, language } from "../i18n.js";
import "./admin-strings.js";
import { boardFilters, organizationLink } from "./client.js";
import { call } from "../collaboration/api.js";
import {
  authoredTextHTML,
  languageAttribute,
} from "../accessibility/object-content.js";
import { textSegments, validateTextRuns } from "../rich-text.js";

// Organization settings for administrators: adoption reports, people and
// teams, the board directory, policy, security integrations, and the audit
// log. Every change goes through the organization worker, which enforces it.
const TABS = [
  ["overview", "Overview", "chart-column"],
  ["people", "People", "users"],
  ["boards", "Boards", "layout-dashboard"],
  ["policies", "Policies", "shield-check"],
  ["integrations", "Integrations", "plug"],
  ["security", "Security", "lock-keyhole"],
  ["audit", "Audit log", "scroll-text"],
];
const date = (at) =>
  at
    ? new Date(at).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "-";
const dateTime = (at) =>
  at ? new Date(at).toLocaleString(language === "fr" ? "fr-CA" : "en-CA") : "-";
const user = (value) => `<span data-user-content>${escape(value ?? "")}</span>`;
// Keep the JSON text intact while marking the human-language title inside
// a facilitation event. Metadata belongs to this saved event, not its board.
const auditDetails = (event) => {
  const details = event.details || {};
  if (
    !["vote.started", "poll.started"].includes(event.action) ||
    typeof details.title !== "string"
  )
    return escape(JSON.stringify(details));
  let parts;
  try {
    validateTextRuns(details.title, details.titleRuns);
    parts = textSegments(details.title, details.titleRuns);
  } catch {
    parts = [{ text: details.title, style: {} }];
  }
  const title =
    `"<span${languageAttribute(details.titleLang)}>` +
    parts
      .map(
        (part) =>
          `<span${languageAttribute(part.style.lang)}>${escape(JSON.stringify(part.text).slice(1, -1))}</span>`,
      )
      .join("") +
    '</span>"';
  return (
    "{" +
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(
        ([key, value]) =>
          `${escape(JSON.stringify(key))}:${key === "title" ? title : escape(JSON.stringify(value))}`,
      )
      .join(",") +
    "}"
  );
};
// A translated message with its {placeholders} filled, numbers formatted
// for the language.
const fill = (text, values) =>
  Object.entries(values).reduce(
    (out, [key, value]) =>
      out.replaceAll(
        `{${key}}`,
        (Number(value) || 0).toLocaleString(
          language === "fr" ? "fr-CA" : "en-CA",
        ),
      ),
    t(text),
  );
// Numbers from the organization's server are shown as numbers only.
const num = (value) => Number(value) || 0;
// A count with its noun, singular for one.
const count = (value, one, many) =>
  `${num(value)} ${t(num(value) === 1 ? one : many)}`;
// Text that spreadsheets would evaluate as a formula gets an apostrophe
// prefix (OWASP CSV injection guidance).
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
// Each column is a field name, or a [header, (row) => value] pair.
export const toCSV = (rows, columns) =>
  "﻿" +
  [
    columns.map((c) => csvCell(Array.isArray(c) ? c[0] : c)).join(","),
    ...rows.map((r) =>
      columns.map((c) => csvCell(Array.isArray(c) ? c[1](r) : r[c])).join(","),
    ),
  ].join("\r\n");
const lines = (value) =>
  String(value || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

// A single-series bar chart: bars are anchored to the baseline, values show
// on hover and focus, and the same numbers are available as a table.
export function barChart(series, label) {
  const width = 560,
    height = 140,
    pad = 24,
    max = Math.max(1, ...series.map((d) => d.value)),
    step = (width - pad * 2) / Math.max(1, series.length),
    bar = Math.max(1, step - Math.min(2, step / 3));
  const bars = series
    .map((d, n) => {
      const h = Math.max(d.value ? 3 : 0, ((height - pad * 2) * d.value) / max);
      const x = pad + n * step,
        y = height - pad - h;
      // Rounded top corners never make a bar wider than its slot, and a
      // zero day draws nothing.
      const r = Math.min(4, bar / 2, h);
      const mark = h
        ? `<path d="M${x},${height - pad}V${y + r}q0,${-r} ${r},${-r}h${bar - 2 * r}q${r},0 ${r},${r}V${height - pad}Z" class="chart-mark"></path>`
        : "";
      // One bar per chart is a tab stop; arrow keys move between bars.
      return `<g class="chart-bar" role="img" tabindex="${n === series.length - 1 ? 0 : -1}" aria-label="${escape(`${d.date}: ${d.value}`)}"><rect class="chart-hit" x="${x}" y="${pad}" width="${step}" height="${height - pad * 2}"></rect>${mark}<title>${escape(`${d.date}: ${d.value}`)}</title></g>`;
    })
    .join("");
  return `<figure class="admin-chart"><figcaption>${escape(t(label))}</figcaption><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${escape(t(label))}"><line x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}" class="chart-axis"></line><text x="${pad}" y="${pad - 8}" class="chart-tick">${max}</text><text x="${pad}" y="${height - 6}" class="chart-tick">${escape(series[0]?.date || "")}</text><text x="${width - pad}" y="${height - 6}" text-anchor="end" class="chart-tick">${escape(series.at(-1)?.date || "")}</text>${bars}</svg><details><summary>${t("Show as table")}</summary><table class="admin-table"><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("Value")}</th></tr></thead><tbody>${series.map((d) => `<tr><td>${escape(d.date)}</td><td>${num(d.value)}</td></tr>`).join("")}</tbody></table></details></figure>`;
}
const tile = (label, value, detail = "") =>
  `<div class="stat-tile"><span class="stat-label">${t(label)}</span><strong class="stat-value">${escape(String(value))}</strong>${detail ? `<span class="stat-detail">${t(detail)}</span>` : ""}</div>`;
const check = (id, label, checked, hint = "") =>
  `<label class="check-field"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span>${t(label)}${hint ? `<small>${t(hint)}</small>` : ""}</span></label>`;
const text = (id, label, value = "", extra = "") =>
  `<label class="field">${t(label)}<input id="${id}" value="${escape(value ?? "")}" ${extra}></label>`;
// Options marked as named by people, such as teams, are shown as written.
// Options are [value, label, named, context]; a named option shows a name
// as written, and a context picks the label's translation for its use.
const select = (id, label, value, options) =>
  `<label class="field">${t(label)}<select id="${id}">${options
    .map(
      ([v, l, named, context]) =>
        `<option value="${escape(v)}" ${v === value ? "selected" : ""}${named ? " data-user-content" : ""}>${escape(named ? l : t(l, context))}</option>`,
    )
    .join("")}</select></label>`;

// The labels shown for a person's role and status in the people list.
const PERSON_ROLES = {
  member: "Member",
  admin: "Administrator",
  guest: "Guest",
};
const PERSON_STATUSES = {
  active: "Active",
  deactivated: "Deactivated",
  pending: "Provisioned, awaiting sign-in",
};

export function createAdminConsole({
  org,
  modal,
  toast,
  icon,
  download,
  refresh = () => {},
  openBoard = async () => {},
  migrate = null,
}) {
  let dialog = null,
    cache = {};
  const request = (op, data) => org.request(op, data);
  // Each tab loads its data with `load`; a load finishing after another tab
  // was opened is dropped so it never renders over the newer tab.
  let turn = 0;
  const STALE = Symbol("stale");
  const load = (op, data) => {
    const mine = turn;
    return request(op, data).then((result) => {
      if (mine !== turn) throw STALE;
      return result;
    });
  };
  const panel = () => dialog?.querySelector("#admin-panel");
  const status = (message) => {
    const el = dialog?.querySelector("#admin-status");
    if (el) el.textContent = t(message);
  };
  // Irreversible actions take a second press on the same button.
  const confirmFirst = (button, label) => {
    if (button.dataset.confirmed) return false;
    button.dataset.confirmed = "1";
    button.textContent = t(label);
    status(label);
    return true;
  };
  // `reload` shows a tab again after the action, unless another tab opened
  // while the action was running.
  async function guarded(button, fn) {
    const done = busy(button);
    const started = turn;
    const reload = (tab) => (started === turn ? show(tab) : undefined);
    try {
      return await fn(reload);
    } catch (error) {
      // Another tab opened meanwhile; its result has nowhere to go.
      if (error === STALE) return;
      toast(error.message || "Something went wrong.");
      status(error.message || "Something went wrong.");
    } finally {
      done();
    }
  }
  function show(tab) {
    const tabs = [...dialog.querySelectorAll('[role="tab"]')];
    for (const el of tabs) {
      const active = el.dataset.tab === tab;
      el.setAttribute("aria-selected", String(active));
      el.tabIndex = active ? 0 : -1;
    }
    panel().setAttribute("aria-labelledby", "admin-tab-" + tab);
    panel().innerHTML = `<p class="dialog-copy">${t("Loading…")}</p>`;
    status("");
    const mine = ++turn;
    return render[tab]().then(
      () => {
        if (mine !== turn) return;
        restoreFocus();
        refresh();
      },
      (error) => {
        if (mine !== turn || !panel()) return;
        panel().innerHTML = `<p class="dialog-copy" role="alert">${escape(t(error.message || "Could not load this section."))}</p>`;
        restoreFocus();
      },
    );
  }
  // Re-rendering a panel removes the control that had focus; keyboard and
  // screen reader users return to the same control, or to the panel.
  let panelFocus = null;
  function restoreFocus() {
    const active = document.activeElement;
    if (panelFocus === null || (active && active !== document.body)) return;
    const target =
      (/^[\w-]+$/.test(panelFocus) &&
        panel().querySelector(`#${panelFocus}`)) ||
      panel();
    target.focus();
  }
  const render = {
    async overview() {
      const days = cache.days || 30;
      const r = await load("org.reports", { days });
      cache.report = r;
      panel().innerHTML = `<div class="admin-toolbar">${select(
        "report-days",
        "Period",
        String(days),
        [
          ["7", "Last 7 days"],
          ["30", "Last 30 days"],
          ["90", "Last 90 days"],
          ["180", "Last 180 days"],
        ],
      )}<button class="secondary" id="report-json">${icon("download")}${t("Export report")}</button><button class="secondary" id="report-users">${icon("download")}${t("Inactive users (CSV)")}</button></div>
<div class="stat-grid">${tile("Active users", r.users.active, `${num(r.users.activeLast30Days)} ${t("active in the last 30 days", num(r.users.activeLast30Days) === 1 ? "one" : undefined)}`)}${tile("Inactive users", r.users.inactiveCount ?? r.users.inactive.length, "No activity in 30 days")}${tile("Guests", r.users.guests)}${tile("Deactivated", r.users.deactivated)}${tile("Boards", r.boards.total, `${num(r.boards.activeLast30Days)} ${t("active in the last 30 days", num(r.boards.activeLast30Days) === 1 ? "one" : undefined)}`)}${tile("Stale boards", r.boards.stale, "No activity in 90 days")}${tile("Boards with guests", r.sharing.withGuests, count(r.sharing.guestMemberships, "guest membership", "guest memberships"))}${tile("Public links", r.sharing.publicLinks)}${tile("Largest session", r.sessions.largest[0]?.participants || 0, count(r.sessions.sessionsOver50, "session with 50 or more people", "sessions with 50 or more people"))}${tile("Time on boards", `${r.usage.minutesPerDay.reduce((n, d) => n + d.value, 0)} min`, "Total in this period")}${tile("Ease of use", r.feedback.averageEase ?? "-", count(r.feedback.responses, "rating out of 5", "ratings out of 5"))}</div>
${barChart(r.usage.dailyActiveUsers, "Daily active users")}${barChart(r.usage.peakConcurrent, "Largest simultaneous session per day")}${barChart(r.usage.minutesPerDay, "Minutes spent on boards per day")}${barChart(
        r.boards.createdByWeek.map((w) => ({ date: w.week, value: w.created })),
        "Boards created per week",
      )}
<div class="admin-columns"><section><h3>${t("Top board owners")}</h3><table class="admin-table"><thead><tr><th scope="col">${t("Owner")}</th><th scope="col">${t("Boards")}</th></tr></thead><tbody>${r.boards.topOwners.map((o) => `<tr><td>${user(o.username || o.uuid)}</td><td>${num(o.count)}</td></tr>`).join("") || `<tr><td colspan="2">${t("None")}</td></tr>`}</tbody></table></section><section><h3>${t("Largest sessions")}</h3><table class="admin-table"><thead><tr><th scope="col">${t("Board")}</th><th scope="col">${t("People")}</th><th scope="col">${t("When")}</th></tr></thead><tbody>${r.sessions.largest.map((s) => `<tr><td>${user(s.title)}</td><td>${num(s.participants)}</td><td>${date(s.at)}</td></tr>`).join("") || `<tr><td colspan="3">${t("None")}</td></tr>`}</tbody></table></section></div>
<section><h3>${t("Feedback")}</h3>${r.feedback.responses ? `<table class="admin-table"><thead><tr><th scope="col">${t("Rating")}</th><th scope="col">${t("Responses")}</th></tr></thead><tbody>${r.feedback.distribution.map((n, i) => `<tr><td>${i + 1} / 5</td><td>${num(n)}</td></tr>`).join("")}</tbody></table><ul class="feedback-comments">${r.feedback.recent.map((f) => `<li><strong>${num(f.ease)} / 5</strong> ${authoredTextHTML(f, f.comment)}</li>`).join("")}</ul>` : `<p class="dialog-copy">${t("No feedback yet. People can rate their experience from Help and training.")}</p>`}</section><section><h3>${t("Boards shared outside the organization")}</h3><table class="admin-table"><thead><tr><th scope="col">${t("Board")}</th><th scope="col">${t("Guests")}</th><th scope="col">${t("Visibility")}</th></tr></thead><tbody>${r.sharing.boardsWithGuests.map((b) => `<tr><td>${user(b.title)}</td><td>${num(b.guests)}</td><td>${t(b.visibility === "link" ? "Anyone with the link" : b.visibility === "organization" ? "Organization" : "Invited people")}</td></tr>`).join("") || `<tr><td colspan="3">${t("None")}</td></tr>`}</tbody></table></section>`;
      panel().querySelector("#report-days").onchange = (e) => {
        cache.days = Number(e.target.value);
        show("overview");
      };
      panel().querySelector("#report-json").onclick = () =>
        download(
          JSON.stringify(r, null, 2),
          "organization-report.json",
          "application/json",
        );
      // The report lists the first 5,000 inactive people; the export
      // holds them all.
      panel().querySelector("#report-users").onclick = (e) =>
        guarded(e.currentTarget, async () => {
          const people =
            (r.users.inactiveCount ?? 0) > r.users.inactive.length
              ? (await request("org.reports", { days, allInactive: true }))
                  .users.inactive
              : r.users.inactive;
          download(
            toCSV(people, [
              "username",
              "email",
              [
                "lastActive",
                (u) => u.lastActive && new Date(u.lastActive).toISOString(),
              ],
            ]),
            "inactive-users.csv",
            "text/csv",
          );
        });
    },
    async people() {
      const [{ users, owner }, { teams }] = await Promise.all([
        load("org.users.list"),
        load("teams.list"),
      ]);
      const teamName = new Map(teams.map((tm) => [tm.id, tm.name]));
      const rows = (filter = "") =>
        users
          .filter(
            (u) =>
              !filter ||
              [
                u.username,
                u.email,
                u.role,
                u.status,
                // And the labels on screen, so a search in French finds them.
                t(PERSON_ROLES[u.role]),
                t(PERSON_STATUSES[u.status], "person"),
              ]
                .join(" ")
                .toLowerCase()
                .includes(filter),
          )
          .map(
            (u) =>
              `<tr><td>${user(u.username || t("Not signed in yet"))}<br><small>${user(u.email || "")}${u.email && !u.emailVerified ? ` · ${t("unverified")}` : ""}</small></td><td><select data-role="${escape(u.uuid)}" aria-label="${escape(t("Role for") + " " + (u.username || u.email || ""))}">${["member", "admin", "guest"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${t(PERSON_ROLES[r])}</option>`).join("")}</select></td><td>${u.status === "pending" ? t(PERSON_STATUSES.pending) : `<select data-status="${escape(u.uuid)}" aria-label="${escape(t("Status for") + " " + (u.username || ""))}">${["active", "deactivated"].map((v) => `<option value="${v}" ${u.status === v ? "selected" : ""}>${t(PERSON_STATUSES[v], "person")}</option>`).join("")}</select>`}</td><td>${(u.teams || []).map((id) => user(teamName.get(id) || id)).join(", ")}</td><td>${date(u.lastActive)}</td><td><button class="text-btn" data-transfer="${escape(u.uuid)}">${t("Transfer boards")}</button></td></tr>`,
          )
          .join("") ||
        `<tr><td colspan="6">${t("No people match your search.")}</td></tr>`;
      panel().innerHTML = `<div class="admin-toolbar"><label class="search">${icon("search")}<input id="people-search" aria-label="${t("Search people")}" placeholder="${t("Search people")}"></label>${select(
        "invite-role",
        "Invite as",
        "member",
        [
          ["member", "Member"],
          ["guest", "Guest"],
          ["admin", "Administrator"],
        ],
      )}<button class="primary" id="invite-people">${icon("user-plus")}${t("Create invitation link")}</button><button class="secondary" id="revoke-org-invites">${t("Revoke invitation links")}</button><button class="secondary" id="export-people">${icon("download")}${t("Export CSV")}</button></div><label class="field" hidden id="invite-output-field">${t("Organization invitation link")}<input id="invite-output" readonly></label>
<p class="dialog-copy">${t("Account owner")}: ${user(owner.username)}. ${t("People who verify an email address in your organization's domains join automatically when domain capture is on. SCIM provisioning adds people before they first sign in.")}</p>
<div class="table-scroll"><table class="admin-table"><thead><tr><th scope="col">${t("Person")}</th><th scope="col">${t("Role")}</th><th scope="col">${t("Status")}</th><th scope="col">${t("Teams")}</th><th scope="col">${t("Last active")}</th><th scope="col"><span class="sr-only">${t("Actions")}</span></th></tr></thead><tbody id="people-rows">${rows()}</tbody></table></div>
<section><div class="section-heading"><h3>${t("Teams")}</h3><button class="secondary" id="new-team">${icon("plus")}${t("New team")}</button></div><div id="team-list">${teams.map((tm) => `<div class="team-row"><strong data-user-content>${escape(tm.name)}</strong><span>${count(tm.members.length, "member", "members")}</span><button class="text-btn" data-edit-team="${escape(tm.id)}">${t("Edit")}</button><button class="text-btn danger" data-delete-team="${escape(tm.id)}">${t("Delete")}</button></div>`).join("") || `<p>${t("No teams yet. Teams can also be synchronized from Google Workspace groups through SCIM.")}</p>`}</div></section>`;
      // Keep the loaded list in step with the server, so searching redraws
      // the saved values, and put back a value the server refused.
      const change = async (uuid, field, el) => {
        const person = users.find((u) => u.uuid === uuid);
        try {
          const { user: saved } = await request("org.users.update", {
            uuid,
            [field]: el.value,
          });
          if (person) Object.assign(person, saved);
        } catch (error) {
          if (person) el.value = person[field];
          throw error;
        }
      };
      const bindRows = () => {
        panel()
          .querySelectorAll("[data-role]")
          .forEach((el) => {
            el.onchange = () =>
              guarded(el, () =>
                change(el.dataset.role, "role", el).then(() =>
                  toast("Role updated."),
                ),
              );
          });
        panel()
          .querySelectorAll("[data-status]")
          .forEach((el) => {
            el.onchange = () =>
              guarded(el, () =>
                change(el.dataset.status, "status", el).then(() =>
                  toast(
                    el.value === "deactivated"
                      ? "Account deactivated. Their sessions end now."
                      : "Account reactivated.",
                  ),
                ),
              );
          });
        panel()
          .querySelectorAll("[data-transfer]")
          .forEach((el) => {
            el.onclick = () => {
              const choices = [
                owner,
                ...users.filter(
                  (u) =>
                    u.status === "active" &&
                    u.role !== "guest" &&
                    u.uuid !== el.dataset.transfer,
                ),
              ];
              // One transfer form at a time, in a row under its person.
              dialog.querySelector("#transfer-target")?.closest("tr")?.remove();
              const target = document.createElement("div");
              target.id = "transfer-target";
              target.className = "inline-form";
              target.innerHTML = `<label class="field">${t("New owner")}<select id="transfer-to">${choices.map((c) => `<option value="${escape(c.uuid)}" data-user-content>${escape(c.username || c.email || c.uuid)}</option>`).join("")}</select></label><button class="primary" id="transfer-go">${t("Transfer all boards")}</button>`;
              el.closest("tr").after(
                Object.assign(document.createElement("tr"), {
                  innerHTML: `<td colspan="6"></td>`,
                }),
              );
              el.closest("tr").nextElementSibling.firstChild.append(target);
              target.querySelector("#transfer-to").focus();
              target.querySelector("#transfer-go").onclick = (e) =>
                guarded(e.currentTarget, async () => {
                  const { transferred } = await request("org.users.transfer", {
                    from: el.dataset.transfer,
                    to: target.querySelector("#transfer-to").value,
                  });
                  toast(
                    count(
                      transferred,
                      "board transferred.",
                      "boards transferred.",
                    ),
                  );
                  // Focus returns to the row's button, not the page.
                  target.closest("tr").remove();
                  el.focus();
                });
              refresh();
            };
          });
      };
      bindRows();
      panel().querySelector("#people-search").oninput = (e) => {
        panel().querySelector("#people-rows").innerHTML = rows(
          e.target.value.toLowerCase(),
        );
        bindRows();
        refresh();
      };
      panel().querySelector("#invite-people").onclick = (e) =>
        guarded(e.currentTarget, async () => {
          const role = panel().querySelector("#invite-role").value;
          // The link goes in the People tab; once another tab has opened
          // there is nowhere to show it.
          const { token } = await load("org.invite", { role });
          const field = panel().querySelector("#invite-output");
          field.value = organizationLink(org.server, token);
          panel().querySelector("#invite-output-field").hidden = false;
          field.select();
          status(
            role === "admin"
              ? "Invitation link created. It works for one person and expires in 14 days."
              : "Invitation link created. It expires in 14 days.",
          );
        });
      panel().querySelector("#revoke-org-invites").onclick = (e) => {
        const button = e.currentTarget;
        if (confirmFirst(button, "Confirm revoke")) return;
        guarded(button, async () => {
          await request("org.invite.revoke");
          delete button.dataset.confirmed;
          button.textContent = t("Revoke invitation links");
          toast("Invitation links revoked.");
        });
      };
      panel().querySelector("#export-people").onclick = () =>
        download(
          toCSV(users, [
            "username",
            "email",
            "role",
            "status",
            "license",
            [
              "teams",
              (u) =>
                (u.teams || []).map((id) => teamName.get(id) || id).join("; "),
            ],
            [
              "lastActive",
              (u) => u.lastActive && new Date(u.lastActive).toISOString(),
            ],
            "source",
          ]),
          "people.csv",
          "text/csv",
        );
      const editTeam = (team, opener) => {
        // One team form at a time, so its fields keep unique ids.
        panel().querySelector("#team-list > form")?.remove();
        const form = document.createElement("form");
        form.className = "inline-form";
        form.innerHTML = `${text("team-name", "Team name", team?.name || "", 'required maxlength="120"')}<fieldset><legend>${t("Members")}</legend><div class="check-list">${users
          .filter((u) => u.status !== "deactivated")
          .map(
            (u) =>
              `<label><input type="checkbox" value="${escape(u.uuid)}" ${team?.members.includes(u.uuid) ? "checked" : ""}> <span data-user-content>${escape(u.username || u.email)}</span></label>`,
          )
          .join(
            "",
          )}</div></fieldset><div class="dialog-footer"><button type="button" class="secondary" id="team-cancel">${t("Cancel")}</button><button class="primary">${t("Save team")}</button></div>`;
        panel().querySelector("#team-list").prepend(form);
        form.querySelector("#team-cancel").onclick = () => {
          form.remove();
          opener.focus();
        };
        form.onsubmit = (e) => {
          e.preventDefault();
          guarded(form.querySelector(".primary"), async (reload) => {
            // Deactivated people are not listed, so they stay on the team.
            const listed = new Set(
              [...form.querySelectorAll("input[type=checkbox]")].map(
                (i) => i.value,
              ),
            );
            await request(team ? "teams.update" : "teams.create", {
              id: team?.id,
              name: form.querySelector("#team-name").value,
              members: [
                ...form.querySelectorAll("input[type=checkbox]:checked"),
              ]
                .map((i) => i.value)
                .concat((team?.members || []).filter((id) => !listed.has(id))),
            });
            reload("people");
          });
        };
        refresh();
        form.querySelector("#team-name").focus();
      };
      panel().querySelector("#new-team").onclick = (e) =>
        editTeam(null, e.currentTarget);
      panel()
        .querySelectorAll("[data-edit-team]")
        .forEach((el) => {
          el.onclick = () =>
            editTeam(
              teams.find((tm) => tm.id === el.dataset.editTeam),
              el,
            );
        });
      panel()
        .querySelectorAll("[data-delete-team]")
        .forEach((el) => {
          el.onclick = () =>
            confirmFirst(el, "Confirm delete") ||
            guarded(el, async (reload) => {
              await request("teams.delete", { id: el.dataset.deleteTeam });
              reload("people");
            });
        });
    },
    async boards() {
      const filters = cache.boardFilters || {
        archived: undefined,
        sort: "updated",
      };
      const limit = cache.boardLimit || 200;
      const [{ boards, total = boards.length }, { teams }, { spaces }] =
        await Promise.all([
          load("org.boards", boardFilters({ ...filters, scope: "all", limit })),
          load("teams.list"),
          load("spaces.list"),
        ]);
      panel().innerHTML = `<form class="admin-filters" id="board-filters">${text("bf-query", "Search", filters.query || "", 'type="search"')}${select(
        "bf-activity",
        "Activity",
        filters.activity || "",
        [
          ["", "Any"],
          ["active", "Active in 30 days"],
          ["stale", "No activity in 90 days"],
          ["unused", "Empty boards"],
        ],
      )}${select("bf-visibility", "Visibility", filters.visibility || "", [
        ["", "Any"],
        ["private", "Invited people"],
        ["organization", "Organization"],
        ["link", "Anyone with the link"],
      ])}${select("bf-team", "Team", filters.team || "", [["", "Any"], ...teams.map((tm) => [tm.id, tm.name, true])])}${select("bf-space", "Space", filters.space || "", [["", "Any", false, "space"], ...spaces.map((s) => [s.id, s.name, true])])}${select(
        "bf-type",
        "Contains",
        filters.type || "",
        [
          ["", "Anything"],
          ["note", "Sticky notes"],
          ["table", "Tables"],
          ["image", "Images"],
          ["file", "Files"],
          ["frame", "Frames"],
          ["link", "Links"],
        ],
      )}${select(
        "bf-state",
        "State",
        filters.deleted ? "deleted" : filters.archived ? "archived" : "",
        [
          ["", "Current"],
          ["archived", "Archived", false, "boards"],
          ["deleted", "Deleted (recoverable)"],
        ],
      )}<label class="field">${t("Updated after")}<input type="date" id="bf-after" value="${escape(filters.updatedAfter || "")}"></label>${select(
        "bf-sort",
        "Sort",
        filters.sort || "updated",
        [
          ["updated", "Last activity"],
          ["created", "Created"],
          ["title", "Name"],
          ["size", "Size"],
        ],
      )}<button class="primary">${t("Apply")}</button><button type="button" class="secondary" id="bf-duplicates">${t("Find duplicates")}</button><button type="button" class="secondary" id="bf-export">${icon("download")}${t("Export CSV")}</button>${migrate ? `<button type="button" class="secondary" id="bf-migrate">${icon("import")}${t("Migrate from Miro")}</button>` : ""}</form>
<p class="dialog-copy" role="status">${total > boards.length ? `${fill("Showing {shown} of {total} boards.", { shown: boards.length, total })}${boards.length >= 1000 ? ` ${t("Refine the filters to find others; Export CSV includes them all.")}` : ""}` : count(boards.length, "board", "boards")}</p><div class="table-scroll"><table class="admin-table"><thead><tr><th scope="col">${t("Board")}</th><th scope="col">${t("Owner")}</th><th scope="col">${t("Last activity")}</th><th scope="col">${t("Objects")}</th><th scope="col">${t("Sharing")}</th><th scope="col"><span class="sr-only">${t("Actions")}</span></th></tr></thead><tbody>${boards.map((b) => `<tr><td>${user(b.title)}${b.legalHold ? ` <span class="badge">${t("Legal hold")}</span>` : ""}${b.archived ? ` <span class="badge">${t("Archived")}</span>` : ""}</td><td>${user(b.ownerName || b.owner)}</td><td>${date(b.lastActivity || b.created)}</td><td>${num(b.objectCount)}</td><td>${t(b.visibility === "link" ? "Anyone with the link" : b.visibility === "organization" ? "Organization" : "Invited people")}${b.guestCount ? ` · ${count(b.guestCount, "guest", "guests")}` : ""}</td><td class="row-actions"><button class="text-btn" data-open-board="${escape(b.room)}">${t("Open", "action")}</button><button class="text-btn" data-activity="${escape(b.room)}">${t("Activity")}</button>${b.deleted ? `<button class="text-btn" data-govern="restore" data-room="${escape(b.room)}">${t("Restore")}</button>` : `<button class="text-btn" data-govern="${b.archived ? "unarchive" : "archive"}" data-room="${escape(b.room)}">${t(b.archived ? "Unarchive" : "Archive")}</button><button class="text-btn" data-govern="hold" data-enabled="${!b.legalHold}" data-room="${escape(b.room)}">${t(b.legalHold ? "Release hold" : "Legal hold")}</button><button class="text-btn danger" data-govern="delete" data-room="${escape(b.room)}">${t("Delete")}</button>`}</td></tr>`).join("") || `<tr><td colspan="6">${t("No boards match these filters.")}</td></tr>`}</tbody></table></div>${total > boards.length && boards.length < 1000 ? `<button type="button" class="secondary" id="bf-more">${t("Show more boards")}</button>` : ""}<div id="board-detail"></div>`;
      const form = panel().querySelector("#board-filters");
      panel()
        .querySelector("#bf-more")
        ?.addEventListener("click", () => {
          cache.boardLimit = Math.min(1000, limit + 200);
          show("boards");
        });
      form.onsubmit = (e) => {
        e.preventDefault();
        const state = form.querySelector("#bf-state").value;
        cache.boardLimit = 200;
        cache.boardFilters = {
          query: form.querySelector("#bf-query").value,
          activity: form.querySelector("#bf-activity").value || undefined,
          visibility: form.querySelector("#bf-visibility").value || undefined,
          team: form.querySelector("#bf-team").value || undefined,
          space: form.querySelector("#bf-space").value || undefined,
          type: form.querySelector("#bf-type").value || undefined,
          updatedAfter: form.querySelector("#bf-after").value || undefined,
          sort: form.querySelector("#bf-sort").value,
          archived: state === "archived" ? true : undefined,
          deleted: state === "deleted",
          content: !!form.querySelector("#bf-query").value,
        };
        show("boards");
      };
      // The export includes every matching board, read a page at a time.
      form.querySelector("#bf-export").onclick = (e) =>
        guarded(e.currentTarget, async () => {
          const all = [];
          for (let offset = 0; offset < total; offset += 1000) {
            const page = await load(
              "org.boards",
              boardFilters({ ...filters, scope: "all", limit: 1000, offset }),
            );
            all.push(...page.boards);
            if (!page.boards.length) break;
          }
          exportBoards(all);
        });
      const exportBoards = (rows) =>
        download(
          toCSV(rows, [
            "title",
            "ownerName",
            "owner",
            ["created", (b) => b.created && new Date(b.created).toISOString()],
            [
              "lastActivity",
              (b) => b.lastActivity && new Date(b.lastActivity).toISOString(),
            ],
            "objectCount",
            "visibility",
            "memberCount",
            "guestCount",
            "peakParticipants",
            "room",
          ]),
          "boards.csv",
          "text/csv",
        );
      form
        .querySelector("#bf-migrate")
        ?.addEventListener("click", () => migrate());
      form.querySelector("#bf-duplicates").onclick = (e) =>
        guarded(e.currentTarget, async () => {
          const { groups } = await load("org.boards.duplicates");
          panel().querySelector("#board-detail").innerHTML =
            `<h3>${t("Possible duplicates")}</h3>${groups.map((g) => `<div class="team-row"><strong>${t(g.reason === "same content" ? "Same content" : "Same name")}</strong><span data-user-content>${g.boards.map((b) => `${escape(b.title)} (${escape(b.ownerName || "")}, ${num(b.objectCount)})`).join(" · ")}</span></div>`).join("") || `<p>${t("No duplicates found.")}</p>`}`;
          // The results appear below the table, out of sight of the button.
          status(
            groups.length
              ? fill(
                  groups.length === 1
                    ? "{count} set of possible duplicates found."
                    : "{count} sets of possible duplicates found.",
                  { count: groups.length },
                )
              : "No duplicates found.",
          );
          refresh();
        });
      panel()
        .querySelectorAll("[data-open-board]")
        .forEach((el) => {
          el.onclick = () => {
            dialog.close();
            openBoard(el.dataset.openBoard).catch((error) =>
              toast(error.message),
            );
          };
        });
      panel()
        .querySelectorAll("[data-activity]")
        .forEach((el) => {
          el.onclick = () =>
            guarded(el, async () => {
              const { entries } = await load("org.board.activity", {
                room: el.dataset.activity,
              });
              panel().querySelector("#board-detail").innerHTML =
                `<h3>${t("Board activity")}</h3>${auditTable(entries, "Board activity")}`;
              status(
                fill(
                  entries.length === 1
                    ? "Board activity: {count} event."
                    : "Board activity: {count} events.",
                  { count: entries.length },
                ),
              );
              refresh();
            });
        });
      panel()
        .querySelectorAll("[data-govern]")
        .forEach((el) => {
          el.onclick = () =>
            (el.dataset.govern === "delete" &&
              confirmFirst(el, "Confirm delete")) ||
            guarded(el, async (reload) => {
              await call(window.puter, org.server, {
                op: el.dataset.govern,
                room: el.dataset.room,
                enabled: el.dataset.enabled === "true",
              });
              reload("boards");
            });
        });
    },
    async policies() {
      const data = await load("org.policy.get");
      cache.policy = data;
      const p = data.policy;
      panel().innerHTML = `<form id="policy-form" class="policy-form">
<fieldset><legend>${t("Organization")}</legend>${text("p-name", "Organization name", p.name, 'maxlength="120"')}<label class="field">${t("Email domains")}<textarea id="p-domains" rows="2" aria-describedby="p-domains-hint">${escape(p.domains.join("\n"))}</textarea><small id="p-domains-hint">${t("One per line.")}</small></label>${check("p-capture", "Domain capture", p.domainCapture, "People who verify an email address in these domains join the organization automatically.")}${check("p-create", "Members can create boards", p.membersCanCreate)}${select(
        "p-visibility",
        "Default board visibility",
        p.defaultVisibility,
        [
          ["private", "Invited people"],
          ["organization", "Everyone in the organization"],
        ],
      )}</fieldset>
<fieldset><legend>${t("External collaboration")}</legend>${select(
        "p-external",
        "Sharing outside the organization",
        p.externalSharing,
        [
          ["none", "Not allowed"],
          ["guests", "Invited guests only"],
          ["anyone", "Guests and public links"],
        ],
      )}${check("p-guests", "Allow guest access", p.guestAccess)}<label class="field">${t("Guest access expires after (days, 0 for never)")}<input id="p-guest-days" type="number" min="0" max="365" value="${num(p.guestExpiryDays)}"></label>${check("p-links", "Allow boards to be opened by anyone with the link", p.publicLinks, "Requires guests and public links above. Viewers still sign in with Puter.")}${check("p-restrict", "Restrict boards to organization members", p.restrictToOrganization)}</fieldset>
<fieldset><legend>${t("AI features")}</legend>${check("p-ai", "Turn on AI features", p.ai.enabled, "Requests run through the organization's worker so this setting is enforced for everyone.")}${check("p-ai-summaries", "Summaries and generation", p.ai.summaries)}${check("p-ai-clustering", "Grouping ideas into themes", p.ai.clustering)}${check("p-ai-handwriting", "Converting photos of handwritten notes", p.ai.handwriting)}${text("p-ai-model", "AI model (optional)", p.ai.model || "", 'maxlength="100" placeholder="gpt-5-nano"')}</fieldset>
<fieldset><legend>${t("Retention and legal hold")}</legend><label class="field">${t("Keep audit logs for (days)")}<input id="p-audit-days" type="number" min="30" max="3650" value="${num(p.retention.auditDays)}"></label><label class="field">${t("Keep deleted boards recoverable for (days)")}<input id="p-deleted-days" type="number" min="1" max="3650" value="${num(p.retention.deletedBoardDays)}"></label>${check("p-hold", "Organization-wide legal hold", p.retention.legalHold, "While on, nothing is deleted: not audit logs, not deleted boards.")}</fieldset>
<fieldset><legend>${t("Scheduled reports")}</legend>${select(
        "p-report",
        "Email an administrative report",
        p.reports.schedule,
        [
          ["none", "Never"],
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
        ],
      )}${text("p-report-emails", "Report recipients", p.reports.emails.join(", "))}</fieldset>
<div class="dialog-footer"><button class="primary">${t("Save policies")}</button></div></form>`;
      const f = panel().querySelector("#policy-form");
      const v = (id) => f.querySelector("#" + id);
      f.onsubmit = (e) => {
        e.preventDefault();
        guarded(f.querySelector(".primary"), async () => {
          await request("org.policy.set", {
            policy: {
              name: v("p-name").value,
              domains: lines(v("p-domains").value),
              domainCapture: v("p-capture").checked,
              membersCanCreate: v("p-create").checked,
              defaultVisibility: v("p-visibility").value,
              externalSharing: v("p-external").value,
              guestAccess: v("p-guests").checked,
              guestExpiryDays: Number(v("p-guest-days").value) || 0,
              publicLinks: v("p-links").checked,
              restrictToOrganization: v("p-restrict").checked,
              ai: {
                enabled: v("p-ai").checked,
                summaries: v("p-ai-summaries").checked,
                clustering: v("p-ai-clustering").checked,
                handwriting: v("p-ai-handwriting").checked,
                model: v("p-ai-model").value,
              },
              retention: {
                auditDays: Number(v("p-audit-days").value) || 365,
                deletedBoardDays: Number(v("p-deleted-days").value) || 30,
                legalHold: v("p-hold").checked,
              },
              reports: {
                schedule: v("p-report").value,
                emails: lines(v("p-report-emails").value),
              },
            },
          });
          await org.refresh();
          toast("Policies saved.");
        });
      };
    },
    async integrations() {
      const data = await load("org.policy.get");
      const p = data.policy.integrations;
      panel().innerHTML = `<form id="integrations-form" class="policy-form">
<fieldset><legend>Google Workspace</legend>${check("i-google", "Allow Google Docs, Sheets, Slides, and Drive embeds and Sheets import", p.google.enabled)}<p class="dialog-copy">${t("Single sign-on with Google Workspace uses SAML through the Puter account platform. Provision users and groups from Google Workspace with the SCIM endpoint on the Security tab.")}</p></fieldset>
<fieldset><legend>Slack</legend>${check("i-slack", "Send notifications to Slack", p.slack.enabled)}<label class="field">${t("Slack incoming webhook URL")} ${data.secrets.slack ? `<span class="badge">${t("Configured")}</span>` : ""}<input id="i-slack-url" type="url" placeholder="https://hooks.slack.com/services/…" autocomplete="off"></label><p class="dialog-copy">${t("Security alerts can go to this channel. Board owners can also connect a board to its own channel for mentions.")}</p></fieldset>
<fieldset><legend>Jira</legend>${check("i-jira", "Send items to Jira and show their status on boards", p.jira.enabled)}${text("i-jira-site", "Jira Cloud site", p.jira.site, 'placeholder="team.atlassian.net"')}${text("i-jira-email", "Integration account email", p.jira.email)}${text("i-jira-project", "Project key", p.jira.project, 'placeholder="CDS"')}<label class="field">${t("API token")} ${data.secrets.jira ? `<span class="badge">${t("Configured")}</span>` : ""}<input id="i-jira-token" type="password" autocomplete="off"></label></fieldset>
<fieldset><legend>${t("Other integrations")}</legend>${check("i-embeds", "Allow embedded web content (video, design files, forms)", p.embeds.enabled)}${check("i-webhooks", "Deliver events to webhooks", p.webhooks.enabled)}${check("i-miro", "Allow Miro imports", p.miro.enabled)}</fieldset>
<div class="dialog-footer"><button class="primary">${t("Save integrations")}</button></div></form>`;
      const f = panel().querySelector("#integrations-form");
      const v = (id) => f.querySelector("#" + id);
      f.onsubmit = (e) => {
        e.preventDefault();
        guarded(f.querySelector(".primary"), async (reload) => {
          const secrets = {};
          if (v("i-slack-url").value) secrets.slack = v("i-slack-url").value;
          if (v("i-jira-token").value) secrets.jira = v("i-jira-token").value;
          await request("org.policy.set", {
            policy: {
              integrations: {
                google: { enabled: v("i-google").checked },
                slack: { enabled: v("i-slack").checked },
                jira: {
                  enabled: v("i-jira").checked,
                  site: v("i-jira-site").value,
                  email: v("i-jira-email").value,
                  project: v("i-jira-project").value,
                },
                embeds: { enabled: v("i-embeds").checked },
                webhooks: { enabled: v("i-webhooks").checked },
                miro: { enabled: v("i-miro").checked },
              },
            },
            secrets,
          });
          await org.refresh();
          toast("Integrations saved.");
          reload("integrations");
        });
      };
    },
    async security() {
      const [data, keys, hooks] = await Promise.all([
        load("org.policy.get"),
        load("apikeys.list"),
        load("webhooks.list"),
      ]);
      const s = data.policy.siem,
        a = data.policy.alerts;
      panel().innerHTML = `<section class="policy-form"><h3>${t("Sign-in and identity")}</h3><p class="dialog-copy">${t("People sign in with Puter accounts. Google Workspace SAML single sign-on, domain verification, and enforced multifactor authentication are account platform features; this organization verifies email domains itself and supports SCIM provisioning today.")}</p><label class="check-field"><input type="checkbox" disabled aria-describedby="mfa-note"><span>${t("Require multifactor authentication")}<small id="mfa-note">${t("Available once Puter sign-in tokens report multifactor authentication. Until then, enforce it in Google Workspace with single sign-on.")}</small></span></label><dl class="admin-facts"><dt>${t("SCIM base URL")}</dt><dd><code data-user-content>${escape(org.server + "/scim/v2")}</code></dd><dt>${t("REST API reference")}</dt><dd><a href="${escape(org.server + "/v1/openapi.json")}" target="_blank" rel="noopener">${escape(org.server + "/v1/openapi.json")}</a></dd></dl></section>
<form id="siem-form" class="policy-form"><fieldset><legend>${t("SIEM export")}</legend>${select(
        "s-mode",
        "Destination",
        s.mode,
        [
          ["none", "Off"],
          ["sentinel", "Microsoft Sentinel (Logs Ingestion API)"],
          ["https", "Other HTTPS endpoint"],
        ],
      )}<fieldset class="nested"><legend>Microsoft Sentinel</legend>${text("s-tenant", "Tenant ID", s.sentinel.tenantId)}${text("s-client", "Application (client) ID", s.sentinel.clientId)}<label class="field">${t("Client secret")} ${data.secrets.sentinel ? `<span class="badge">${t("Configured")}</span>` : ""}<input id="s-secret" type="password" autocomplete="off"></label>${text("s-endpoint", "Data collection endpoint", s.sentinel.endpoint, 'placeholder="https://….ingest.monitor.azure.com"')}${text("s-dcr", "Data collection rule immutable ID", s.sentinel.dcrId, 'placeholder="dcr-…"')}${text("s-stream", "Stream name", s.sentinel.stream, 'placeholder="Custom-WhiteboardAudit"')}</fieldset><fieldset class="nested"><legend>${t("HTTPS endpoint")}</legend>${text("s-url", "Endpoint URL", s.url)}<label class="field">${t("Bearer token")} ${data.secrets["siem-token"] ? `<span class="badge">${t("Configured")}</span>` : ""}<input id="s-token" type="password" autocomplete="off"></label></fieldset><fieldset class="nested"><legend>${t("Event categories")}</legend><div class="check-list">${["admin", "security", "access", "sharing", "content", "api"].map((c) => `<label><input type="checkbox" name="s-category" value="${c}" ${s.categories.includes(c) ? "checked" : ""}> ${t({ admin: "Administration", security: "Security", access: "Board access", sharing: "Sharing", content: "Board content", api: "API and SCIM" }[c], "category")}</label>`).join("")}</div></fieldset><p class="dialog-copy" role="status">${data.siem ? `${t("Last delivery")}: ${dateTime(data.siem.lastSuccess)} · ${count(data.siem.sent, "event sent", "events sent")}${data.siem.lastError ? ` · ${t("Last error")}: <span data-user-content>${escape(data.siem.lastError)}</span>` : ""}` : t("Nothing sent yet.")}</p><p class="dialog-copy">${t("Events are exported within seconds of the activity that creates them. Sentinel can also poll the audit API with an API key that has the audit:read scope.")}</p></fieldset>
<fieldset><legend>${t("Security alerts")}</legend>${check("a-public", "A board is opened to anyone with the link", a.publicSharing)}${check("a-guest", "A guest joins a board", a.guestAccess)}${check("a-perm", "Roles or permissions change", a.permissionChanges)}${check("a-policy", "Organization policy changes", a.policyChanges)}${text("a-emails", "Alert email recipients", a.emails.join(", "))}${check("a-slack", "Also post alerts to Slack", a.slack)}</fieldset><div class="dialog-footer"><button type="button" class="secondary" id="siem-test">${t("Send test event")}</button><button class="primary">${t("Save security settings")}</button></div></form>
<section class="policy-form"><h3>${t("API keys")}</h3><p class="dialog-copy">${t("Keys authenticate the REST API and SCIM provisioning. A key is shown once.")}</p><form id="key-form" class="inline-form">${text("k-name", "Key name", "", 'required maxlength="80"')}<fieldset><legend>${t("Scopes")}</legend><div class="check-list">${keys.scopes.map((sc) => `<label><input type="checkbox" name="k-scope" value="${escape(sc)}"> <code>${escape(sc)}</code></label>`).join("")}</div></fieldset>${text("k-days", "Expires after (days, blank for never)", "", 'type="number" min="1" max="730"')}<button class="primary">${t("Create API key")}</button></form><label class="field" hidden id="k-output-field">${t("New API key")}<input id="k-output" readonly></label><div class="table-scroll"><table class="admin-table"><thead><tr><th scope="col">${t("Name")}</th><th scope="col">${t("Scopes")}</th><th scope="col">${t("Last used")}</th><th scope="col">${t("Expires")}</th><th scope="col"><span class="sr-only">${t("Actions")}</span></th></tr></thead><tbody>${keys.keys.map((k) => `<tr><td>${user(k.name)} <code>${escape(k.prefix)}…</code></td><td>${k.scopes.map((sc) => `<code>${escape(sc)}</code>`).join(" ")}</td><td>${dateTime(k.lastUsed)}</td><td>${k.expires ? date(k.expires) : t("Never")}</td><td><button class="text-btn danger" data-revoke-key="${escape(k.id)}">${t("Revoke")}</button></td></tr>`).join("") || `<tr><td colspan="5">${t("No API keys.")}</td></tr>`}</tbody></table></div></section>
<section class="policy-form"><h3>${t("Webhooks")}</h3><p class="dialog-copy">${t("Deliveries are signed with an X-Whiteboard-Signature header (HMAC SHA-256 of the body with the webhook secret). Turn webhooks on in Integrations.")} ${hooks.pending ? count(hooks.pending, "delivery waiting to retry.", "deliveries waiting to retry.") : ""}</p><form id="hook-form" class="inline-form">${text("h-url", "HTTPS endpoint", "", 'type="url" required')}<fieldset><legend>${t("Events")}</legend><div class="check-list">${hooks.events.map((ev) => `<label><input type="checkbox" name="h-event" value="${escape(ev)}" ${ev === "*" ? "checked" : ""}> <code>${ev === "*" ? t("All events") : escape(ev)}</code></label>`).join("")}</div></fieldset><button class="primary">${t("Add webhook")}</button></form><label class="field" hidden id="h-output-field">${t("Signing secret")}<input id="h-output" readonly></label><div class="table-scroll"><table class="admin-table"><tbody>${hooks.webhooks.map((h) => `<tr><td><code data-user-content>${escape(h.url)}</code></td><td>${h.events.map((ev) => `<code>${escape(ev)}</code>`).join(" ")}</td><td><button class="text-btn" data-test-hook="${escape(h.id)}">${t("Test")}</button><button class="text-btn danger" data-delete-hook="${escape(h.id)}">${t("Delete")}</button></td></tr>`).join("") || `<tr><td>${t("No webhooks.")}</td></tr>`}</tbody></table></div></section>`;
      const f = panel().querySelector("#siem-form");
      const v = (id) => panel().querySelector("#" + id);
      const saveSecurity = async () => {
        const secrets = {};
        if (v("s-secret").value) secrets.sentinel = v("s-secret").value;
        if (v("s-token").value) secrets["siem-token"] = v("s-token").value;
        await request("org.policy.set", {
          policy: {
            siem: {
              mode: v("s-mode").value,
              categories: [
                ...f.querySelectorAll('[name="s-category"]:checked'),
              ].map((i) => i.value),
              sentinel: {
                tenantId: v("s-tenant").value,
                clientId: v("s-client").value,
                endpoint: v("s-endpoint").value,
                dcrId: v("s-dcr").value,
                stream: v("s-stream").value,
              },
              url: v("s-url").value,
            },
            alerts: {
              publicSharing: v("a-public").checked,
              guestAccess: v("a-guest").checked,
              permissionChanges: v("a-perm").checked,
              policyChanges: v("a-policy").checked,
              emails: lines(v("a-emails").value),
              slack: v("a-slack").checked,
            },
          },
          secrets,
        });
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        guarded(f.querySelector(".primary"), async (reload) => {
          await saveSecurity();
          toast("Security settings saved.");
          reload("security");
        });
      };
      v("siem-test").onclick = (e) =>
        guarded(e.currentTarget, async () => {
          await saveSecurity();
          const result = await request("org.siem.test");
          toast(
            `${t("Test delivered.")} ${count(result.sent, "event sent", "events sent")}`,
          );
        });
      panel().querySelector("#key-form").onsubmit = (e) => {
        e.preventDefault();
        guarded(e.target.querySelector(".primary"), async () => {
          const { key } = await request("apikeys.create", {
            name: v("k-name").value,
            scopes: [
              ...panel().querySelectorAll('[name="k-scope"]:checked'),
            ].map((i) => i.value),
            days: Number(v("k-days").value) || undefined,
          });
          // Kept until the Security tab shows it, even if reloading the tab
          // fails or another tab opens first: it cannot be shown again.
          cache.revealed = {
            field: "k",
            value: key,
            message: "Copy this key now. It will not be shown again.",
          };
          await show("security");
          if (cache.revealed)
            toast("Open the Security tab again to copy the new secret.");
        });
      };
      panel()
        .querySelectorAll("[data-revoke-key]")
        .forEach((el) => {
          el.onclick = () =>
            confirmFirst(el, "Confirm revoke") ||
            guarded(el, async (reload) => {
              await request("apikeys.revoke", { id: el.dataset.revokeKey });
              reload("security");
            });
        });
      panel().querySelector("#hook-form").onsubmit = (e) => {
        e.preventDefault();
        guarded(e.target.querySelector(".primary"), async () => {
          const { secret } = await request("webhooks.create", {
            url: v("h-url").value,
            events: [
              ...panel().querySelectorAll('[name="h-event"]:checked'),
            ].map((i) => i.value),
          });
          cache.revealed = {
            field: "h",
            value: secret,
            message:
              "Copy this signing secret now. It will not be shown again.",
          };
          await show("security");
          if (cache.revealed)
            toast("Open the Security tab again to copy the new secret.");
        });
      };
      panel()
        .querySelectorAll("[data-test-hook]")
        .forEach((el) => {
          el.onclick = () =>
            guarded(el, async () => {
              await request("webhooks.test", { id: el.dataset.testHook });
              toast("Webhook test delivered.");
            });
        });
      panel()
        .querySelectorAll("[data-delete-hook]")
        .forEach((el) => {
          el.onclick = () =>
            confirmFirst(el, "Confirm delete") ||
            guarded(el, async (reload) => {
              await request("webhooks.delete", { id: el.dataset.deleteHook });
              reload("security");
            });
        });
      const revealed = cache.revealed;
      if (revealed) {
        cache.revealed = null;
        v(revealed.field + "-output-field").hidden = false;
        v(revealed.field + "-output").value = revealed.value;
        v(revealed.field + "-output").select();
        status(revealed.message);
      }
    },
    async audit() {
      const filters = cache.auditFilters || {};
      // The form keeps plain dates in local time, like the times shown in
      // the table; "From" starts its day and "To" ends at its last moment.
      const local = (value, time) =>
        value ? new Date(`${value}T${time}`).toISOString() : undefined;
      const query = {
        ...filters,
        from: local(filters.from, "00:00:00"),
        to: local(filters.to, "23:59:59.999"),
      };
      const result = await load("org.audit", { ...query, limit: 200 });
      cache.auditEntries = result.entries;
      panel().innerHTML = `<form class="admin-filters" id="audit-filters"><label class="field">${t("From", "dates")}<input type="date" id="au-from" value="${escape(filters.from || "")}"></label><label class="field">${t("To", "dates")}<input type="date" id="au-to" value="${escape(filters.to || "")}"></label>${select(
        "au-category",
        "Category",
        filters.category || "",
        [
          ["", "All", false, "category"],
          ["admin", "Administration"],
          ["security", "Security"],
          ["access", "Board access", false, "category"],
          ["sharing", "Sharing"],
          ["content", "Board content"],
          ["api", "API and SCIM"],
        ],
      )}${text("au-action", "Action starts with", filters.action || "", 'placeholder="board.role"')}<button class="primary">${t("Apply")}</button><button type="button" class="secondary" id="au-csv">${icon("download")}${t("Export CSV")}</button><button type="button" class="secondary" id="au-json">${icon("download")}${t("Export JSON")}</button></form>${auditTable(result.entries)}${result.cursor ? `<button class="secondary" id="au-more">${t("Load older events")}</button>` : ""}`;
      const f = panel().querySelector("#audit-filters");
      f.onsubmit = (e) => {
        e.preventDefault();
        cache.auditFilters = {
          from: f.querySelector("#au-from").value || undefined,
          to: f.querySelector("#au-to").value || undefined,
          category: f.querySelector("#au-category").value || undefined,
          action: f.querySelector("#au-action").value || undefined,
        };
        show("audit");
      };
      const columns = [
        "time",
        "category",
        "action",
        ["actor", (e) => e.actor?.username],
        ["actorId", (e) => e.actor?.uuid],
        ["targetType", (e) => e.target?.type],
        ["target", (e) => e.target?.name || e.target?.id],
        "board",
        "ip",
        ["details", (e) => JSON.stringify(e.details || {})],
      ];
      // The export includes every matching event, read a page at a time,
      // not only the pages loaded in the table.
      const allEntries = async () => {
        const all = [...cache.auditEntries];
        for (let cursor = result.cursor; cursor;) {
          const page = await load("org.audit", {
            ...query,
            cursor,
            limit: 500,
          });
          all.push(...page.entries);
          // A page that brings nothing new ends the export.
          cursor =
            page.entries.length && page.cursor !== cursor ? page.cursor : null;
        }
        return all;
      };
      f.querySelector("#au-csv").onclick = (e) =>
        guarded(e.currentTarget, async () =>
          download(
            toCSV(await allEntries(), columns),
            "audit-log.csv",
            "text/csv",
          ),
        );
      f.querySelector("#au-json").onclick = (e) =>
        guarded(e.currentTarget, async () =>
          download(
            JSON.stringify(await allEntries(), null, 2),
            "audit-log.json",
            "application/json",
          ),
        );
      panel()
        .querySelector("#au-more")
        ?.addEventListener("click", (e) =>
          guarded(e.currentTarget, async () => {
            const more = await load("org.audit", {
              ...query,
              cursor: result.cursor,
              limit: 200,
            });
            cache.auditEntries.push(...more.entries);
            result.cursor = more.cursor;
            panel()
              .querySelector(".admin-table tbody")
              .insertAdjacentHTML("beforeend", auditRows(more.entries));
            // Removing the focused button would drop the keyboard to the
            // page; it goes back to the panel instead.
            if (!more.cursor) e.target.remove();
            restoreFocus();
            refresh();
          }),
        );
    },
  };
  const CATEGORY_LABELS = {
    admin: "Administration",
    security: "Security",
    access: "Board access",
    sharing: "Sharing",
    content: "Board content",
    api: "API and SCIM",
  };
  const auditRows = (entries) =>
    entries
      .map(
        (e) =>
          `<tr><td>${dateTime(e.at)}</td><td>${escape(t(CATEGORY_LABELS[e.category] || e.category || "", "category"))}</td><td><code>${escape(e.action)}</code></td><td>${user(e.actor?.username || "")}</td><td>${user(e.target?.name || e.target?.id || "")}</td><td><code data-user-content>${auditDetails(e)}</code></td></tr>`,
      )
      .join("");
  const auditTable = (entries, label = "Audit log") =>
    `<div id="audit-table" class="table-scroll" role="region" aria-label="${t(label)}" tabindex="0"><table class="admin-table"><thead><tr><th scope="col">${t("Time")}</th><th scope="col">${t("Category")}</th><th scope="col">${t("Action")}</th><th scope="col">${t("Who")}</th><th scope="col">${t("Target")}</th><th scope="col">${t("Details")}</th></tr></thead><tbody>${auditRows(entries) || `<tr><td colspan="6">${t("No events in this range.")}</td></tr>`}</tbody></table></div>`;
  return {
    open(tab = "overview") {
      if (!org.isAdmin)
        return toast(
          "Only organization administrators can open these settings.",
        );
      cache = {};
      dialog = modal(
        "Organization settings",
        `<div class="admin-console"><div role="tablist" aria-label="${t("Organization settings")}" class="admin-tabs">${TABS.map(([key, label, ic]) => `<button role="tab" id="admin-tab-${key}" data-tab="${key}" aria-controls="admin-panel" aria-selected="false" tabindex="-1">${icon(ic)}<span>${label}</span></button>`).join("")}</div><div id="admin-panel" role="tabpanel" tabindex="0" class="admin-panel"></div><p id="admin-status" class="sr-only" role="status" aria-live="polite"></p></div>`,
        (d) => {
          d.classList.add("admin-dialog");
          panelFocus = null;
          d.addEventListener("focusin", (e) => {
            panelFocus = panel().contains(e.target) ? e.target.id : null;
          });
          d.addEventListener("keydown", (event) => {
            const scrolling = event.target;
            if (scrolling.id !== "audit-table") return;
            if (
              event.defaultPrevented ||
              event.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              !["ArrowLeft", "ArrowRight"].includes(event.key)
            )
              return;
            const maximum = scrolling.scrollWidth - scrolling.clientWidth;
            if (maximum <= 0) return;
            event.preventDefault();
            scrolling.scrollLeft = Math.max(
              0,
              Math.min(
                maximum,
                scrolling.scrollLeft + (event.key === "ArrowRight" ? 48 : -48),
              ),
            );
          });
          d.addEventListener("keydown", (e) => {
            const bar = e.target.closest?.(".chart-bar");
            if (!bar) return;
            const bars = [...bar.parentNode.querySelectorAll(".chart-bar")];
            const n = bars.indexOf(bar);
            const next = {
              ArrowRight: bars[n + 1],
              ArrowLeft: bars[n - 1],
              Home: bars[0],
              End: bars.at(-1),
            }[e.key];
            if (!next) return;
            e.preventDefault();
            bar.setAttribute("tabindex", "-1");
            next.setAttribute("tabindex", "0");
            next.focus();
          });
          const tabs = [...d.querySelectorAll('[role="tab"]')];
          tabs.forEach((el, n) => {
            el.onclick = () => show(el.dataset.tab);
            el.onkeydown = (e) => {
              const next =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? tabs[(n + 1) % tabs.length]
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? tabs[(n - 1 + tabs.length) % tabs.length]
                    : e.key === "Home"
                      ? tabs[0]
                      : e.key === "End"
                        ? tabs.at(-1)
                        : null;
              if (!next) return;
              e.preventDefault();
              next.focus();
              show(next.dataset.tab);
            };
          });
        },
      );
      show(tab);
      return dialog;
    },
  };
}
