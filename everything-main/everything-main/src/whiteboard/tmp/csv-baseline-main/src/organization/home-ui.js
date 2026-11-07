import { escape } from "../model.js";
import { busy } from "../accessibility/busy.js";
import { authoredTextHTML } from "../accessibility/object-content.js";
import { addTranslations, labelled, plural, t, language } from "../i18n.js";
import {
  boardFilters,
  organizationLink,
  readOrganizationLink,
} from "./client.js";

// The unread count shows as a number and is read out with its meaning.
const unreadBadge = (count) =>
  count
    ? `<span aria-hidden="true">${count}</span><span class="sr-only">${escape(plural(count, "{count} unread", "{count} unread"))}</span>`
    : "";
const when = (at) =>
  at
    ? new Date(at).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
const fill = (text, values) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, () => value),
    t(text),
  );
// Notifications carry their parts, so each person reads them in their own
// language. Older ones keep the English text they were saved with.
const assignmentSuffix = (n) =>
  `${n.due ? ` (${fill("due {date}", { date: when(Date.parse(`${n.due}T12:00:00`)) })})` : ""}${n.more > 0 ? ` ${fill(n.more === 1 ? "and 1 more" : "and {count} more", { count: n.more })}` : ""}`;
function notificationText(n) {
  const who = n.anonymous ? t("A participant") : n.actor?.username;
  if (n.type === "assignment" && typeof n.title === "string" && who)
    return labelled(
      who,
      `${n.titleGenerated === true || (n.titleGenerated === undefined && n.title === "Untitled task") ? t("Untitled task") : n.title}${assignmentSuffix(n)}`,
    );
  if (
    (n.type === "mention" || n.type === "reply") &&
    who &&
    typeof n.excerpt === "string"
  )
    return labelled(who, n.excerpt);
  if (n.type === "alert" && n.label) {
    const target = n.target
      ? language === "fr"
        ? ` « ${n.target} »`
        : ` “${n.target}”`
      : "";
    return labelled(t(n.label), `${n.who || t("Someone")}${target}`);
  }
  return n.text || "";
}
function notificationHTML(n) {
  const who = n.anonymous ? t("A participant") : n.actor?.username;
  if (
    n.type === "assignment" &&
    who &&
    typeof n.title === "string" &&
    (n.titleGenerated !== undefined || n.titleLang || n.titleRuns?.length)
  )
    return (
      escape(labelled(who, "")) +
      (n.titleGenerated === true
        ? escape(t("Untitled task"))
        : authoredTextHTML({
            text: n.title,
            lang: n.titleLang,
            textRuns: n.titleRuns,
          })) +
      escape(assignmentSuffix(n))
    );
  if (
    (n.type === "mention" || n.type === "reply") &&
    who &&
    typeof n.excerpt === "string" &&
    (n.excerptLang || n.excerptRuns?.length)
  )
    return (
      escape(labelled(who, "")) +
      authoredTextHTML({
        text: n.excerpt,
        lang: n.excerptLang,
        textRuns: n.excerptRuns,
      })
    );
  return escape(notificationText(n));
}
// How many of the latest notifications the dialog lists and the badge counts.
const NOTIFICATIONS_SHOWN = 100;
const ROLE_LABEL = {
  owner: "Owner",
  facilitator: "Facilitator",
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

// The organization's side of the board library: its boards with advanced
// filters and content search, notifications, joining, and email
// verification for domain capture.
export function createOrganizationHome({
  org,
  modal,
  toast,
  icon,
  refresh = () => {},
  openShared,
  admin,
  library,
  rerender = () => {},
  // Signs in first, from the click, so the Puter popup is not blocked.
  connect = async () => {},
}) {
  // Archived boards stay hidden until someone asks for them.
  let filters = { scope: "mine", sort: "updated", archived: false },
    unread = 0,
    spaces = [],
    teams = [],
    listsFor = null,
    listsAt = 0;
  // Another organization brings its own spaces, teams, and filters.
  let current = org.server;
  org.onChange?.(() => {
    if (org.server === current) return;
    current = org.server;
    unread = 0;
    filters = { scope: "mine", sort: "updated", archived: false };
    spaces = [];
    teams = [];
    listsFor = null;
  });
  async function loadNotifications() {
    if (!org.info) return;
    try {
      // The same notifications the dialog lists, so the count matches it.
      const { unread: count } = await org.request("notifications.list", {
        limit: NOTIFICATIONS_SHOWN,
      });
      // Numbers from the organization's server are shown as numbers only.
      unread = Math.max(0, Number(count) || 0);
      const badge = document.querySelector("#org-unread");
      if (badge) {
        badge.innerHTML = unreadBadge(unread);
        badge.hidden = !unread;
      }
    } catch {
      /* Notifications are optional; the library still works. */
    }
  }
  const api = {
    // Sidebar markup: the organization's views, or ways to get started.
    sidebar() {
      const info = org.info;
      if (!info)
        return `<div class="workspace-label org-start">ORGANIZATION</div><nav class="org-start" aria-label="Organization"><button class="nav-item" data-org-action="join">${icon("building-2")}Join an organization</button><button class="nav-item" data-org-action="setup">${icon("plus")}Set up an organization</button></nav>`;
      return `<div class="workspace-label" data-user-content>${escape((info.name || t("Organization")).toUpperCase())}</div><nav aria-label="Organization"><button class="nav-item" data-filter="organization">${icon("building-2")}Organization boards</button><button class="nav-item" data-org-action="notifications">${icon("bell")}Notifications <span id="org-unread" class="nav-badge" ${unread ? "" : "hidden"}>${unreadBadge(unread)}</span></button>${library && org.isMember ? `<button class="nav-item" data-org-action="library">${icon("library")}Organization library</button>` : ""}${!info.user?.emailVerified ? `<button class="nav-item" data-org-action="verify">${icon("mail-check")}Verify your email</button>` : ""}${org.isAdmin ? `<button class="nav-item" data-org-action="admin">${icon("settings")}Organization settings</button>` : ""}</nav>`;
    },
    bind(root = document) {
      root.querySelectorAll("[data-org-action]").forEach((el) => {
        el.onclick = () => {
          const action = el.dataset.orgAction;
          if (action === "join") api.joinDialog();
          if (action === "setup") api.setupDialog();
          if (action === "notifications") api.notifications();
          if (action === "verify") api.verifyDialog();
          if (action === "admin") admin?.open();
          if (action === "library") library?.();
        };
      });
      loadNotifications();
    },
    async renderBoards(grid) {
      if (!org.info) {
        grid.innerHTML = `<div class="empty-state">${icon("building-2")}<h3>${t("Join your organization")}</h3><p>${t("Open the organization link from your administrator, or verify your work email.")}</p></div>`;
        return;
      }
      // Spaces and teams are member data; guests go without. The lists are
      // reused for a minute, so filtering does not ask for them each time,
      // and a failed load is tried again.
      const member = org.isMember;
      if (
        member &&
        (listsFor !== org.server || Date.now() - listsAt > 60_000)
      ) {
        const server = org.server;
        const [spaceList, teamList] = await Promise.all([
          org
            .request("spaces.list")
            .then((r) => r.spaces)
            .catch(() => null),
          org
            .request("teams.list")
            .then((r) => r.teams)
            .catch(() => null),
        ]);
        if (server === org.server) {
          spaces = spaceList || spaces;
          teams = teamList || teams;
          if (spaceList && teamList) {
            listsFor = server;
            listsAt = Date.now();
          }
        }
      }
      grid.classList.add("org-board-grid");
      const option = (value, label, selected, named = false) =>
        `<option value="${value}" ${selected ? "selected" : ""}${named ? " data-user-content" : ""}>${label}</option>`;
      // Filters beyond the search stay folded away until someone uses them.
      const refined = [
        filters.space,
        filters.team,
        filters.activity,
        filters.type,
        filters.updatedAfter,
        filters.archived,
      ].filter(Boolean).length;
      grid.innerHTML = `<form class="org-filters" id="org-filters" role="search" aria-label="${t("Search organization boards")}"><div class="org-filter-main"><label class="field org-query">${t("Search names and content")}<span class="org-search-box">${icon("search")}<input id="of-query" type="search" value="${escape(filters.query || "")}"></span></label><label class="field org-scope">${t("Show")}<select id="of-scope">${option("mine", t("Boards shared with me"), filters.scope === "mine")}${option("organization", t("All organization boards I can open"), filters.scope === "organization")}</select></label><button class="primary">${icon("search")}${t("Search")}</button></div><details class="org-more" ${refined ? "open" : ""}><summary>${icon("sliders-horizontal")}${t("More filters")}${refined ? `<span class="badge">${refined}</span>` : ""}</summary><div class="org-filter-grid">${member ? `<label class="field">${t("Space")}<select id="of-space"><option value="">${t("Any", "space")}</option>${spaces.map((s) => option(escape(s.id), escape(s.name), filters.space === s.id, true)).join("")}</select></label><label class="field">${t("Team")}<select id="of-team"><option value="">${t("Any")}</option>${teams.map((tm) => option(escape(tm.id), escape(tm.name), filters.team === tm.id, true)).join("")}</select></label>` : ""}<label class="field">${t("Activity")}<select id="of-activity"><option value="">${t("Any")}</option>${option("active", t("Active in 30 days"), filters.activity === "active")}${option("stale", t("No activity in 90 days"), filters.activity === "stale")}</select></label><label class="field">${t("Contains")}<select id="of-type"><option value="">${t("Anything")}</option>${[
        ["note", "Sticky notes"],
        ["table", "Tables"],
        ["image", "Images"],
        ["file", "Files"],
        ["frame", "Frames"],
      ]
        .map(([v, l]) => option(v, t(l), filters.type === v))
        .join(
          "",
        )}</select></label><label class="field">${t("Updated after")}<input type="date" id="of-after" value="${escape(filters.updatedAfter || "")}"></label><label class="field">${t("Archived", "boards")}<select id="of-archived"><option value="">${t("Hide")}</option>${option("only", t("Only archived"), filters.archived === true)}</select></label></div>${refined ? `<button type="button" class="text-btn org-clear" id="of-clear">${icon("x")}${t("Clear filters")}</button>` : ""}</details></form><div class="org-results-bar"><p id="org-count" class="org-count" role="status"></p>${member ? `<button type="button" class="secondary" id="of-space-new">${icon("folder-plus")}${t("New space")}</button>` : ""}</div><div id="org-results" class="board-grid"><p class="org-status">${t("Loading…")}</p></div>`;
      const form = grid.querySelector("#org-filters");
      // Rendering replaces the filters, so the keyboard goes back to the
      // same control once it exists again, unless focus has moved on.
      const refocus = (selector) => {
        const restore = () => {
          if (document.activeElement === document.body)
            grid.querySelector(selector)?.focus();
        };
        const done = api.renderBoards(grid);
        restore();
        return done.then(restore);
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const from = document.activeElement;
        filters = {
          scope: form.querySelector("#of-scope").value,
          query: form.querySelector("#of-query").value || undefined,
          content: !!form.querySelector("#of-query").value,
          space: form.querySelector("#of-space")?.value || undefined,
          team: form.querySelector("#of-team")?.value || undefined,
          activity: form.querySelector("#of-activity").value || undefined,
          type: form.querySelector("#of-type").value || undefined,
          updatedAfter: form.querySelector("#of-after").value || undefined,
          archived:
            form.querySelector("#of-archived").value === "only" ? true : false,
          sort: "updated",
        };
        refocus(
          from?.id && form.contains(from)
            ? `#${from.id}`
            : "#org-filters .org-filter-main .primary",
        );
      };
      const clear = form.querySelector("#of-clear");
      if (clear)
        clear.onclick = () => {
          filters = {
            scope: filters.scope,
            query: filters.query,
            content: filters.content,
            sort: "updated",
            archived: false,
          };
          refocus(".org-more summary");
        };
      const newSpace = grid.querySelector("#of-space-new");
      if (newSpace)
        newSpace.onclick = () =>
          modal(
            "New space",
            `<form><label class="field">${t("Space name")}<input id="space-name" required maxlength="80"></label><div class="dialog-footer"><button class="primary">${t("Create space")}</button></div></form>`,
            (d) => {
              d.querySelector("form").onsubmit = async (e) => {
                e.preventDefault();
                // One space per press: a double click must not create two.
                const button = d.querySelector(".primary");
                if (button.disabled) return;
                const done = busy(button);
                try {
                  const { space } = await org.request("spaces.create", {
                    name: d.querySelector("#space-name").value,
                  });
                  spaces = [...spaces, space];
                  d.close();
                  refocus("#of-space-new");
                } catch (error) {
                  toast(error.message);
                } finally {
                  done();
                }
              };
            },
          );
      const results = grid.querySelector("#org-results");
      try {
        const { boards, total = boards.length } = await org.request(
          "org.boards",
          boardFilters(filters),
        );
        // A newer search, or leaving this view, replaced these results.
        if (!results.isConnected) return;
        const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
        const count = grid.querySelector("#org-count");
        // The count is the live region, so each search announces how many
        // boards matched rather than reading out every card.
        count.textContent =
          total > boards.length
            ? `${fill("Showing {shown} of {total} boards.", { shown: boards.length, total })} ${t("Refine the filters to find others.")}`
            : boards.length
              ? `${boards.length} ${t(boards.length === 1 ? "board" : "boards")}`
              : t("No boards found");
        count.classList.toggle("sr-only", !boards.length);
        results.innerHTML = boards.length
          ? boards
              .map((b, n) => {
                const role = t(
                  ROLE_LABEL[b.role] ||
                    (b.visibility === "organization"
                      ? "Open to the organization"
                      : ""),
                );
                // The name is the title alone; the owner, activity, role,
                // and archived state are read as the description.
                return `<article class="board-card org-card"><button class="board-open" data-org-open="${escape(b.room)}" aria-label="${escape(t("Open", "action") + " " + b.title)}" aria-describedby="org-card-${n}-meta org-card-${n}-role"><div class="board-preview org-preview"><span class="org-preview-icon">${icon(b.visibility === "organization" ? "building-2" : b.visibility === "link" ? "link" : "users")}</span><span>${Number(b.objectCount) || 0} ${t("objects")}</span></div><div class="board-info"><h3 data-user-content title="${escape(b.title)}">${escape(b.title)}</h3><p class="org-meta" id="org-card-${n}-meta"><span data-user-content>${escape(b.ownerName || "")}</span> · ${when(b.lastActivity || b.created)}${b.space ? ` · <span data-user-content>${escape(spaceName.get(b.space) || "")}</span>` : ""}</p><p class="card-role" id="org-card-${n}-role">${role ? `<span class="badge">${role}</span>` : ""}${b.archived ? `<span class="badge badge-archived">${icon("archive")}${t("Archived")}</span>` : ""}</p></div></button></article>`;
              })
              .join("")
          : `<div class="empty-state">${icon("search")}<h3>${t("No boards found")}</h3><p>${t("Try other filters, or search all organization boards.")}</p></div>`;
        results.querySelectorAll("[data-org-open]").forEach((el) => {
          el.onclick = () =>
            openShared(org.server, el.dataset.orgOpen).catch((error) =>
              toast(error.message),
            );
        });
      } catch (error) {
        if (!results.isConnected) return;
        results.innerHTML = `<p class="org-status" role="alert">${escape(error.message)}</p>`;
      }
      refresh();
    },
    async notifications() {
      modal(
        "Notifications",
        `<div class="notification-tools"><label class="check-field"><input type="checkbox" id="notify-email" ${org.info?.user?.prefs?.emailNotifications === false ? "" : "checked"} ${org.info?.user?.emailVerified ? "" : "disabled"}><span>${t("Email me about mentions, replies, and tasks assigned to me")}${org.info?.user?.emailVerified ? "" : `<small>${t("Verify your email to receive notifications by email.")}</small>`}</span></label><button class="secondary" id="notify-read">${t("Mark all as read")}</button></div><p id="notification-count" class="sr-only" role="status"></p><ul id="notification-list" class="notification-list"><li>${t("Loading…")}</li></ul>`,
        async (d) => {
          const list = d.querySelector("#notification-list");
          const load = async () => {
            const { items } = await org.request("notifications.list", {
              limit: NOTIFICATIONS_SHOWN,
            });
            list.innerHTML =
              items
                .map(
                  // Only a notification about a board opens something, so only it is a
                  // button; the others are read as text, not as unavailable controls.
                  (n) => {
                    const tag = n.board ? "button" : "div";
                    return `<li class="${n.read ? "" : "unread"}"><${tag} class="notification" data-note="${escape(n.id)}">${n.read ? "" : `<span class="sr-only">${t("Unread")}</span>`}<span class="notification-kind">${t({ mention: "Mention", reply: "Reply", alert: "Security alert", assignment: "Assignment" }[n.type] || "Update", "notification")}</span><span data-user-content>${notificationHTML(n)}</span><time datetime="${new Date(n.at).toISOString()}">${escape(new Date(n.at).toLocaleString(language === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" }))}</time></${tag}></li>`;
                  },
                )
                .join("") || `<li>${t("You're all caught up.")}</li>`;
            // The count is the live region, so loading the list or marking
            // it read announces how many there are, not every one.
            d.querySelector("#notification-count").textContent = items.length
              ? `${items.length} ${t(items.length === 1 ? "notification" : "notifications")}`
              : t("You're all caught up.");
            list.querySelectorAll("button[data-note]").forEach((el) => {
              el.onclick = async () => {
                const note = items.find((n) => n.id === el.dataset.note);
                await org
                  .request("notifications.read", { ids: [note.id] })
                  .catch(() => {});
                loadNotifications();
                d.close();
                // An assignment goes to its task, a comment to its thread.
                if (note.board)
                  openShared(org.server, note.board, {
                    thread: note.thread,
                    objectId: note.thread ? undefined : note.item,
                  }).catch((error) => toast(error.message));
              };
            });
            refresh();
          };
          const markRead = d.querySelector("#notify-read");
          markRead.onclick = async () => {
            const done = busy(markRead);
            try {
              await org.request("notifications.read", { all: true });
              await load();
              loadNotifications();
            } catch (error) {
              toast(error.message || "Could not update notifications.");
            } finally {
              done();
            }
          };
          d.querySelector("#notify-email").onchange = async (e) => {
            const box = e.target;
            try {
              await org.request("prefs.set", {
                emailNotifications: box.checked,
              });
            } catch (error) {
              // The box keeps showing what is saved.
              box.checked = !box.checked;
              toast(error.message);
              return;
            }
            await org.refresh().catch((error) => toast(error.message));
          };
          try {
            await load();
          } catch (error) {
            list.innerHTML = `<li role="alert">${escape(error.message)}</li>`;
          }
        },
      );
    },
    joinDialog(link = "") {
      const parsed = link ? readOrganizationLink(link) : null;
      modal(
        "Join an organization",
        `<form id="org-join"><label class="field">${t("Organization link")}<input id="org-link" type="url" required value="${escape(link)}" placeholder="https://…#org=…"></label><p class="dialog-copy">${t("Sign in with Puter. If your organization uses domain capture, you can join by verifying your work email instead of an invitation.")}</p><p id="org-join-status" role="status"></p><div class="dialog-footer"><button type="button" class="secondary" id="org-join-setup">${t("Set up an organization")}</button><button class="primary">${t("Join organization")}</button></div></form>`,
        (d) => {
          d.querySelector("#org-join-setup").onclick = () => {
            d.close();
            api.setupDialog();
          };
          d.querySelector("#org-join").onsubmit = async (e) => {
            e.preventDefault();
            const button = d.querySelector(".primary"),
              out = d.querySelector("#org-join-status");
            const done = busy(button);
            try {
              await connect();
              const target = readOrganizationLink(
                d.querySelector("#org-link").value,
              );
              if (!target)
                throw Error(
                  t("Paste the organization link your administrator sent you."),
                );
              // Links can come from anyone, so the organization's name and
              // address are shown, with any organization it replaces,
              // before switching.
              if (button.dataset.confirm !== target.server) {
                const { server, info } = await org.preview(target.server);
                const host = new URL(server).host;
                const replaces =
                  org.server && org.server !== server
                    ? ` ${fill("This replaces {name} as your organization.", { name: org.info?.name || new URL(org.server).host })}`
                    : "";
                out.textContent = `${fill("Join {name} at {host}?", { name: info?.name || t("this organization"), host })}${replaces}`;
                button.dataset.confirm = target.server;
                button.textContent = t("Confirm and join");
                return;
              }
              const previous = { server: org.server, info: org.info };
              await org.use(target.server);
              if (org.isMember && !target.token) {
                d.close();
                toast("You're in the organization.");
                rerender();
                return;
              }
              try {
                await org.join(target.token);
                d.close();
                toast("Welcome to the organization.");
                rerender();
              } catch (error) {
                // A refused invitation keeps the organization in use before;
                // without one, the new organization may admit a verified
                // email, so it stays in use for that.
                if (error.status !== 403 || target.token) {
                  if (previous.server !== org.server)
                    await org.restore(previous);
                  throw error;
                }
                d.close();
                api.verifyDialog(error.message);
              }
            } catch (error) {
              out.textContent = t(error.message);
            } finally {
              done();
            }
          };
          // A different link needs its own confirmation.
          d.querySelector("#org-link").addEventListener("input", () => {
            const button = d.querySelector("#org-join .primary");
            delete button.dataset.confirm;
            button.textContent = t("Join organization");
            d.querySelector("#org-join-status").textContent = "";
          });
          if (parsed?.token || parsed)
            d.querySelector("#org-join .primary").focus();
        },
      );
    },
    verifyDialog(reason = "") {
      modal(
        "Verify your email",
        `<form id="verify-start">${reason ? `<p class="dialog-copy">${escape(t(reason))}</p>` : ""}<label class="field">${t("Work email")}<input id="verify-email" type="email" required autocomplete="email" value="${escape(org.info?.user?.email || "")}"></label><div class="dialog-footer"><button class="primary">${t("Send code")}</button></div></form><form id="verify-code" hidden><label class="field">${t("Six-digit code")}<input id="verify-value" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label><div class="dialog-footer"><button class="primary">${t("Verify")}</button></div></form><p id="verify-status" role="status"></p>`,
        (d) => {
          const out = d.querySelector("#verify-status");
          d.querySelector("#verify-start").onsubmit = async (e) => {
            e.preventDefault();
            const done = busy(e.submitter);
            try {
              await org.request("email.start", {
                email: d.querySelector("#verify-email").value,
              });
              d.querySelector("#verify-code").hidden = false;
              d.querySelector("#verify-value").focus();
              out.textContent = t("We sent a code. It expires in 15 minutes.");
            } catch (error) {
              out.textContent = t(error.message);
            } finally {
              done();
            }
          };
          let confirming = false;
          d.querySelector("#verify-code").onsubmit = async (e) => {
            e.preventDefault();
            // A code is used once; a double submit must not send it twice.
            if (confirming) return;
            confirming = true;
            const done = busy(e.currentTarget.querySelector("button"));
            try {
              const result = await org.request("email.confirm", {
                code: d.querySelector("#verify-value").value,
              });
              await org.refresh();
              d.close();
              toast(
                result.info?.role && result.info.role !== "guest"
                  ? "Email verified. You're in the organization."
                  : "Email verified.",
              );
              rerender();
            } catch (error) {
              out.textContent = t(error.message);
            } finally {
              confirming = false;
              done();
            }
          };
        },
      );
    },
    setupDialog() {
      modal(
        "Set up an organization",
        `<form id="org-setup"><p class="dialog-copy">${t("Your Puter account becomes the organization's account owner. Organization boards, audit logs, and settings are stored in this account.")}</p><label class="field">${t("Organization name")}<input id="setup-name" required maxlength="120"></label><label class="field">${t("Email domains (optional)")}<input id="setup-domains"></label><p id="setup-status" role="status"></p><div class="dialog-footer"><button class="primary">${t("Create organization")}</button></div></form>`,
        (d) => {
          d.querySelector("#org-setup").onsubmit = async (e) => {
            e.preventDefault();
            const out = d.querySelector("#setup-status"),
              button = d.querySelector(".primary");
            const done = busy(button);
            try {
              await connect();
              await org.setup(
                d.querySelector("#setup-name").value,
                d
                  .querySelector("#setup-domains")
                  .value.split(/[\s,;]+/)
                  .filter(Boolean),
                (message) => (out.textContent = t(message)),
              );
              d.close();
              modal(
                "Organization ready",
                `<p class="dialog-copy">${t("Share this link so people can join. You can create invitations and turn on domain capture in Organization settings.")}</p><label class="field">${t("Organization link")}<input readonly value="${escape(organizationLink(org.server))}"></label>`,
              );
              rerender();
            } catch (error) {
              out.textContent = t(error.message);
            } finally {
              done();
            }
          };
        },
      );
    },
    refreshBadge: loadNotifications,
  };
  return api;
}

addTranslations({
  "due {date}": "échéance le {date}",
  Unread: "Non lue",
  "one|{count} unread": "{count} non lue",
  "{count} unread": "{count} non lues",
  "and 1 more": "et 1 autre",
  "and {count} more": "et {count} autres",
  Someone: "Quelqu’un",
  "A participant": "Un participant",
  "A board was opened to anyone with the link":
    "Un tableau a été ouvert à toute personne ayant le lien",
  "A guest joined a board": "Un invité s’est joint à un tableau",
  "Board permissions changed": "Les autorisations d’un tableau ont changé",
  "An organization role changed": "Un rôle dans l’organisation a changé",
  "An API key was created": "Une clé d’API a été créée",
  "Organization policy changed": "La politique de l’organisation a changé",
  ORGANIZATION: "ORGANISATION",
  "Join an organization": "Se joindre à une organisation",
  "Set up an organization": "Créer une organisation",
  "Organization boards": "Tableaux de l’organisation",
  Notifications: "Notifications",
  "Organization library": "Bibliothèque de l’organisation",
  "Showing {shown} of {total} boards.":
    "{shown} tableaux affichés sur {total}.",
  "Refine the filters to find others.":
    "Précisez les filtres pour trouver les autres.",
  "Could not update notifications.":
    "Impossible de mettre à jour les notifications.",
  "Verify your email": "Vérifier votre courriel",
  "Join your organization": "Joignez-vous à votre organisation",
  "Open the organization link from your administrator, or verify your work email.":
    "Ouvrez le lien de l’organisation fourni par votre administrateur, ou vérifiez votre courriel professionnel.",
  "Search organization boards":
    "Rechercher dans les tableaux de l’organisation",
  Show: "Afficher",
  "Boards shared with me": "Tableaux partagés avec moi",
  "All organization boards I can open":
    "Tous les tableaux de l’organisation que je peux ouvrir",
  "Search names and content": "Rechercher dans les noms et le contenu",
  Hide: "Masquer",
  "Only archived": "Archivés seulement",
  "More filters": "Plus de filtres",
  "Clear filters": "Effacer les filtres",
  board: "tableau",
  boards: "tableaux",
  notification: "notification",
  notifications: "notifications",
  "Boards your organization shares with you.":
    "Les tableaux que votre organisation partage avec vous.",
  "New space": "Nouvel espace",
  "Space name": "Nom de l’espace",
  "Create space": "Créer l’espace",
  objects: "objets",
  Facilitator: "Animateur",
  "Can edit": "Peut modifier",
  "Can comment": "Peut commenter",
  "Can view": "Peut consulter",
  "Open to the organization": "Ouvert à l’organisation",
  "No boards found": "Aucun tableau trouvé",
  "Try other filters, or search all organization boards.":
    "Essayez d’autres filtres ou cherchez dans tous les tableaux de l’organisation.",
  "Email me about mentions, replies, and tasks assigned to me":
    "M’envoyer un courriel pour les mentions, les réponses et les tâches qui me sont assignées",
  "Verify your email to receive notifications by email.":
    "Vérifiez votre courriel pour recevoir les notifications par courriel.",
  "Mark all as read": "Tout marquer comme lu",
  Mention: "Mention",
  "Security alert": "Alerte de sécurité",
  Assignment: "Affectation",
  Update: "Mise à jour",
  "You're all caught up.": "Vous êtes à jour.",
  "Organization link": "Lien de l’organisation",
  "Sign in with Puter. If your organization uses domain capture, you can join by verifying your work email instead of an invitation.":
    "Connectez-vous avec Puter. Si votre organisation utilise la capture de domaine, vous pouvez vous joindre en vérifiant votre courriel professionnel plutôt qu’avec une invitation.",
  "Join organization": "Se joindre à l’organisation",
  "Join {name} at {host}?": "Se joindre à {name} à l’adresse {host}?",
  "This replaces {name} as your organization.":
    "Cette organisation remplacera {name}.",
  "this organization": "cette organisation",
  "Confirm and join": "Confirmer et se joindre",
  "Paste the organization link your administrator sent you.":
    "Collez le lien de l’organisation que votre administrateur vous a envoyé.",
  "You're in the organization.": "Vous faites partie de l’organisation.",
  "Welcome to the organization.": "Bienvenue dans l’organisation.",
  "Work email": "Courriel professionnel",
  "Send code": "Envoyer le code",
  "Six-digit code": "Code à six chiffres",
  Verify: "Vérifier",
  "We sent a code. It expires in 15 minutes.":
    "Nous avons envoyé un code. Il expire dans 15 minutes.",
  "Email verified. You're in the organization.":
    "Courriel vérifié. Vous faites partie de l’organisation.",
  "Email verified.": "Courriel vérifié.",
  "Your Puter account becomes the organization's account owner. Organization boards, audit logs, and settings are stored in this account.":
    "Votre compte Puter devient le compte titulaire de l’organisation. Les tableaux, les journaux d’audit et les paramètres de l’organisation sont stockés dans ce compte.",
  "Email domains (optional)": "Domaines de courriel (facultatif)",
  "Create organization": "Créer l’organisation",
  "Organization ready": "Organisation prête",
  "Share this link so people can join. You can create invitations and turn on domain capture in Organization settings.":
    "Partagez ce lien pour que les gens puissent se joindre. Vous pouvez créer des invitations et activer la capture de domaine dans les paramètres de l’organisation.",
  "Preparing collaboration…": "Préparation de la collaboration…",
  "Starting collaboration…": "Démarrage de la collaboration…",
});
