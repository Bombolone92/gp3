/**
 * Onboarding plans: the checklist a new hire starts with, and its progress.
 *
 * The nine tasks below are the shipped default. An account can write its own
 * named templates — different plans for an engineer and a salesperson, an
 * extra compliance step, whatever the company actually does — and attach
 * them to jobs or departments, so signing an offer stamps the right list.
 * A task may carry a day offset relative to the hire's start date, which is
 * what lets onboarding work come due instead of only sitting unticked.
 */

import { uid, isSafeId } from '../lib/id.js';
import { addDays, daysBetween, todayISO } from '../lib/dates.js';

export const DEFAULT_ONBOARDING_TASKS = [
  { title: 'Signed offer letter on file', category: 'Paperwork' },
  { title: 'Employment contract and tax forms', category: 'Paperwork' },
  { title: 'Background and reference checks', category: 'Paperwork' },
  { title: 'Create accounts: email, chat, and tools', category: 'IT & access', offsetDays: -3 },
  { title: 'Order laptop and equipment', category: 'IT & access', offsetDays: -7 },
  { title: 'Add to payroll and benefits', category: 'People ops' },
  { title: 'Schedule first-day orientation', category: 'People ops', offsetDays: -2 },
  { title: 'Assign an onboarding buddy', category: 'Team', offsetDays: -1 },
  { title: 'Share the 30/60/90-day plan', category: 'Team', offsetDays: 7 },
];

export const DEFAULT_TEMPLATE = {
  id: 'default',
  name: 'Standard onboarding',
  tasks: DEFAULT_ONBOARDING_TASKS,
  jobIds: [],
  departments: [],
};

export const MAX_TEMPLATES = 10;
export const MAX_TEMPLATE_NAME = 60;
export const MAX_TEMPLATE_TASKS = 40;

const trim = (value, max) => String(value ?? '').trim().slice(0, max);

/** Clean a stored template list; an empty result means "use the default". */
export function normalizeOnboardingTemplates(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const id = String(entry?.id ?? '');
    const name = trim(entry?.name, MAX_TEMPLATE_NAME);
    if (!isSafeId(id) || !name || seen.has(id)) continue;
    const tasks = [];
    for (const task of Array.isArray(entry.tasks) ? entry.tasks : []) {
      const title = trim(task?.title, 140);
      if (!title) continue;
      const offset = Number(task?.offsetDays);
      tasks.push({
        title,
        category: trim(task?.category, 40) || 'Other',
        // A whole number of days either side of the start date; anything
        // else is "no date", not a task nobody can act on.
        ...(Number.isInteger(offset) && Math.abs(offset) <= 365 ? { offsetDays: offset } : {}),
      });
      if (tasks.length >= MAX_TEMPLATE_TASKS) break;
    }
    if (tasks.length === 0) continue;
    seen.add(id);
    out.push({
      id,
      name,
      tasks,
      jobIds: [...new Set((Array.isArray(entry.jobIds) ? entry.jobIds : []).map(String).filter(isSafeId))],
      departments: [...new Set((Array.isArray(entry.departments) ? entry.departments : []).map((d) => trim(d, 60)).filter(Boolean))],
    });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

/** The templates an account has, or the shipped default when it has none. */
export function onboardingTemplates(settings) {
  const stored = normalizeOnboardingTemplates(settings?.onboardingTemplates);
  return stored.length > 0 ? stored : [DEFAULT_TEMPLATE];
}

/**
 * The template a hire on this job should start from: one that names the
 * job, else one that names its department, else a general one (attached to
 * nothing), else the first.
 */
export function templateForJob(settings, job = null) {
  const templates = onboardingTemplates(settings);
  const department = String(job?.department ?? '').trim().toLowerCase();
  return (
    templates.find((t) => job?.id && t.jobIds.includes(job.id)) ??
    (department ? templates.find((t) => t.departments.some((d) => d.toLowerCase() === department)) : undefined) ??
    templates.find((t) => t.jobIds.length === 0 && t.departments.length === 0) ??
    templates[0]
  );
}

/**
 * A fresh plan from a template (the default when none is given). `makeId`
 * is injectable for tests.
 */
export function buildOnboardingPlan(template = null, makeId = () => uid('task')) {
  const tasks = Array.isArray(template?.tasks) && template.tasks.length > 0 ? template.tasks : DEFAULT_ONBOARDING_TASKS;
  return tasks.map((t) => ({
    id: makeId(),
    title: t.title,
    category: t.category ?? 'Other',
    ...(Number.isInteger(t.offsetDays) ? { offsetDays: t.offsetDays } : {}),
    done: false,
  }));
}

/** When a task is due, given the hire's start date, or null. */
export function taskDueDate(task, startDate) {
  if (!Number.isInteger(task?.offsetDays)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate ?? ''))) return null;
  return addDays(startDate, task.offsetDays);
}

/** "7 days before the start date" — how an offset reads to a human. */
export function offsetLabel(offsetDays) {
  if (!Number.isInteger(offsetDays)) return 'No date';
  if (offsetDays === 0) return 'On the start date';
  const days = Math.abs(offsetDays);
  return `${days} ${days === 1 ? 'day' : 'days'} ${offsetDays < 0 ? 'before' : 'after'} the start date`;
}

/** The same, short enough for a select in a row of three controls. */
export function offsetShort(offsetDays) {
  if (!Number.isInteger(offsetDays)) return 'No date';
  if (offsetDays === 0) return 'Start date';
  const days = Math.abs(offsetDays);
  return `${days}d ${offsetDays < 0 ? 'before' : 'after'}`;
}

/** When a signature was recorded, for ordering two of them. */
const signedAtOf = (offer) => String(offer?.signedAt ?? offer?.resolvedAt ?? offer?.createdAt ?? '');

/**
 * candidateId -> the start date their checklist is dated against: the one
 * on their most recently signed offer.
 *
 * A candidate can hold more than one signed offer — revised terms agreed
 * after the first was signed, or a re-hire after a re-engagement (which
 * withdraws open offers but leaves signed ones as the record they are).
 * Which one counted used to depend on who was asking: the checklists took
 * the first in storage order and this scan took the last, so a hire whose
 * offer had been redone read "starts January 15" with every task dated
 * against January while "Needs attention" nagged about the same tasks on
 * the September dates. The latest signature is the agreement in force.
 */
function signedStartDates(offers) {
  const latest = new Map();
  for (const offer of offers ?? []) {
    if (offer?.status !== 'signed' || !offer.startDate) continue;
    const current = latest.get(offer.candidateId);
    if (!current || signedAtOf(offer) >= signedAtOf(current)) latest.set(offer.candidateId, offer);
  }
  return new Map([...latest].map(([id, offer]) => [id, offer.startDate]));
}

/**
 * The start date one hire's checklist is dated against, or null when the
 * app has no signed offer to read it from. Shared by every surface that
 * shows a due date, so they cannot disagree.
 *
 * One pass and no allocation: the Onboarding view asks per hire on every
 * render, so building the whole map each time made that view five times
 * the work it had been.
 */
export function hireStartDate(offers, candidateId) {
  let latest = null;
  for (const offer of offers ?? []) {
    if (offer?.candidateId !== candidateId || offer.status !== 'signed' || !offer.startDate) continue;
    if (!latest || signedAtOf(offer) >= signedAtOf(latest)) latest = offer;
  }
  return latest?.startDate ?? null;
}

/**
 * Unfinished onboarding tasks that have come due, soonest first. The start
 * date comes from the hire's signed offer — the one place the app records
 * when they actually begin — so a plan without one simply has no due
 * dates, and nothing is invented.
 */
export function dueOnboardingTasks(state, { now = new Date(), withinDays = 3 } = {}) {
  const today = todayISO(now);
  const horizon = addDays(today, withinDays);
  const startDates = signedStartDates(state.offers);
  const out = [];
  for (const [candidateId, plan] of Object.entries(state.onboarding ?? {})) {
    const startDate = startDates.get(candidateId);
    if (!startDate) continue;
    for (const task of plan?.tasks ?? []) {
      if (!task || task.done) continue;
      const dueDate = taskDueDate(task, startDate);
      if (!dueDate || dueDate > horizon) continue;
      out.push({ candidateId, task, dueDate, overdue: dueDate < today, daysLeft: daysBetween(today, dueDate) });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** { done, total, pct } — pct is 0..100, rounded, and 0 for an empty plan. */
export function onboardingProgress(tasks) {
  const total = tasks?.length ?? 0;
  const done = (tasks ?? []).filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Tasks grouped by category, in the order the categories first appear —
 * which is the template's own order, since a plan is stamped from one and
 * hand-added tasks land at the end.
 */
export function groupTasks(tasks) {
  const groups = new Map();
  for (const task of tasks ?? []) {
    const key = task.category || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.entries()];
}
