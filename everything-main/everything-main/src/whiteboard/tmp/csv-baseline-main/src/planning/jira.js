import { escape } from "../model.js";
import { textOf } from "../export-layout.js";
import { hasTask } from "./task.js";

// Jira issues are created and read by the organization worker, which holds
// the site, project, and API token. The browser never sees the credentials.
export function jiraStatus(org, session) {
  if (!session)
    return {
      available: false,
      message:
        "Jira sync is available on organization boards. Share this board on your organization's server to use it.",
    };
  if (!org?.server || !org.info?.configured || !org.info?.role)
    return {
      available: false,
      message: "Join an organization to send tasks to Jira.",
    };
  if (org.info.role === "guest")
    return {
      available: false,
      message: "Jira sync is available to organization members.",
    };
  if (org.server !== session.server)
    return {
      available: false,
      message:
        "This board is not on your organization's server, so it cannot use the organization's Jira connection.",
    };
  if (!org.allows("jira"))
    return {
      available: false,
      message:
        "Jira is not set up for your organization. Ask an administrator to enable it in organization settings.",
    };
  return {
    available: true,
    message: "Tasks are created in your organization's Jira project.",
  };
}

// Board data can be written by any participant, so a Jira link is shown
// only for an issue page on a Jira Cloud site; anything else shows the key
// alone.
export function jiraLink(jira) {
  const key = escape(jira.key);
  try {
    const url = new URL(jira.url);
    if (
      url.protocol === "https:" &&
      /^[a-z0-9-]+\.atlassian\.net$/.test(url.hostname) &&
      !url.port &&
      url.pathname === `/browse/${jira.key}` &&
      !url.search &&
      !url.hash
    )
      return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${key}</a>`;
  } catch {}
  return `<span data-user-content>${key}</span>`;
}

export function jiraIssues(items) {
  return items
    .filter((i) => hasTask(i) && !i.task.jira)
    .slice(0, 50)
    .map((i) => {
      const text = (textOf(i) || "").trim();
      return {
        item: i.id,
        summary: text.split("\n")[0].slice(0, 250) || "Whiteboard task",
        description: text.slice(0, 20000),
        due: i.task.due || undefined,
        type: "Task",
      };
    });
}

// Applies created issues to the board: { linked, failed, error, unlinked }.
// A task deleted, or linked by someone else, while Jira created its issue
// keeps the board as it is; the issue's key is in `unlinked`.
export function applyCreated(items, created = []) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let linked = 0,
    failed = 0,
    error = "";
  const unlinked = [];
  for (const result of created) {
    const i = byId.get(result.item);
    if (result.key && /^https:\/\//.test(result.url || "")) {
      if (!hasTask(i) || i.task.jira) {
        unlinked.push(result.key);
        continue;
      }
      i.task = {
        ...i.task,
        jira: { key: result.key, url: result.url.slice(0, 2000) },
      };
      linked++;
    } else {
      failed++;
      error ||= result.error || "";
    }
  }
  return { linked, failed, error, unlinked };
}

export function applyStatuses(items, issues = []) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  let changed = 0;
  for (const i of items) {
    if (!hasTask(i) || !i.task.jira) continue;
    const issue = byKey.get(i.task.jira.key);
    if (!issue) continue;
    const status = String(issue.status || "").slice(0, 100);
    if (i.task.jira.status === status) continue;
    i.task = { ...i.task, jira: { ...i.task.jira, status } };
    changed++;
  }
  return changed;
}
