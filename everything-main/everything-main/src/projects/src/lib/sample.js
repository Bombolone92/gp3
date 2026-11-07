/**
 * Sample project for the onboarding "explore" path. Dates are computed
 * relative to today so the board, timeline, and milestones always look
 * alive — some tasks overdue, some due soon, milestones ahead.
 */

import { uid } from './util.js';
import { todayISO, addDays } from './dates.js';
import { ORDER_GAP } from './board.js';

const HOUR = 3600000;

export function sampleProjectDoc(ownerName = 'Me', today = todayISO()) {
  const d = (n) => addDays(today, n);

  const members = [
    { id: uid(), name: ownerName, color: '#8833eb' },
    { id: uid(), name: 'Maya Chen', color: '#0d9488' },
    { id: uid(), name: 'Leo Park', color: '#d97706' },
    { id: uid(), name: 'Sofia Reyes', color: '#dc4b6a' },
  ];
  const [me, maya, leo, sofia] = members;

  const labels = [
    { id: uid(), name: 'Design', color: '#7c53c9' },
    { id: uid(), name: 'Engineering', color: '#2382c4' },
    { id: uid(), name: 'Content', color: '#5f7d2f' },
    { id: uid(), name: 'Bug', color: '#dc4b6a' },
  ];
  const [design, eng, content, bug] = labels;

  const columns = [
    { id: uid(), name: 'Backlog', done: false },
    { id: uid(), name: 'To do', done: false },
    { id: uid(), name: 'In progress', done: false },
    { id: uid(), name: 'Done', done: true },
  ];
  const [backlog, todo, doing, done] = columns;

  const milestones = [
    {
      id: uid(), name: 'Design freeze', date: d(9), done: false,
      description: 'All screens signed off; no new UI work after this point.',
    },
    {
      id: uid(), name: 'Private beta', date: d(23), done: false,
      description: 'Invite the first 50 customers and start collecting feedback.',
    },
    {
      id: uid(), name: 'Public launch', date: d(44), done: false,
      description: 'Marketing site live, app in both stores, launch post published.',
    },
  ];
  const [freeze, beta, launch] = milestones;

  const now = Date.now();
  let slot = 0;
  const task = (patch) => ({
    id: uid(),
    title: '',
    description: '',
    columnId: backlog.id,
    order: (++slot) * ORDER_GAP,
    assigneeIds: [],
    labelIds: [],
    priority: null,
    startDate: null,
    dueDate: null,
    milestoneId: null,
    checklist: [],
    comments: [],
    attachments: [],
    createdAt: now - slot * 5 * HOUR,
    updatedAt: now - slot * 2 * HOUR,
    ...patch,
  });

  const checks = (...pairs) => pairs.map(([text, done = false]) => ({ id: uid(), text, done }));

  const tasks = [
    // Done
    task({
      title: 'Audit the current onboarding funnel',
      description: 'Where do people drop off between signup and their first project? Pull the numbers and write up the three biggest leaks.',
      columnId: done.id, assigneeIds: [maya.id], labelIds: [content.id],
      startDate: d(-12), dueDate: d(-8), milestoneId: freeze.id,
      comments: [
        { id: uid(), author: 'Maya Chen', text: 'Write-up is in the attached notes. Short version: step 3 loses 40% of signups.', createdAt: now - 70 * HOUR },
      ],
    }),
    task({
      title: 'Set up the staging environment',
      columnId: done.id, assigneeIds: [leo.id], labelIds: [eng.id],
      startDate: d(-10), dueDate: d(-6), milestoneId: beta.id,
      description: 'Mirror of production with seeded demo data. Deploys on every merge to main.',
    }),
    task({
      title: 'Interview five churned customers',
      columnId: done.id, assigneeIds: [sofia.id], labelIds: [content.id],
      startDate: d(-9), dueDate: d(-3), milestoneId: freeze.id,
    }),

    // In progress
    task({
      title: 'Redesign the project dashboard',
      description: 'New card layout with progress at a glance. Follow the spacing tokens from the design system, and keep the empty state friendly.',
      columnId: doing.id, assigneeIds: [maya.id, me.id], labelIds: [design.id],
      priority: 'high', startDate: d(-4), dueDate: d(3), milestoneId: freeze.id,
      checklist: checks(
        ['Card layout with progress at a glance', true],
        ['Empty state illustration', true],
        ['Two-line stat row for mobile'],
        ['Dark mode pass'],
      ),
      comments: [
        { id: uid(), author: 'Maya Chen', text: 'First pass is up. The stat row feels crowded on mobile, so I am trying a two-line variant.', createdAt: now - 20 * HOUR },
        { id: uid(), author: ownerName, text: 'Two-line version reads much better. Ship that one.', createdAt: now - 4 * HOUR },
      ],
    }),
    task({
      title: 'Fix drag and drop on touch devices',
      // Descriptions render a small Markdown subset, so the sample shows it.
      description: `Cards jump to the **wrong column** when the board is scrolled.

Steps to reproduce:

1. Open a board with 4+ columns on iOS Safari
2. Scroll the board sideways
3. Long-press a card and drop it two columns over

The drop lands one column off. Suspect \`autoScrollLoop\` not being folded into
the drop position.

> Only reproduces once the board is horizontally scrolled.`,
      columnId: doing.id, assigneeIds: [leo.id], labelIds: [eng.id, bug.id],
      priority: 'urgent', dueDate: d(-1), milestoneId: beta.id,
      comments: [
        { id: uid(), author: 'Leo Park', text: 'Found it: the auto-scroll offset was not applied to the drop position. Fix in review.', createdAt: now - 2 * HOUR },
      ],
    }),
    task({
      title: 'Write the beta invitation email',
      columnId: doing.id, assigneeIds: [sofia.id], labelIds: [content.id],
      priority: 'medium', startDate: d(-2), dueDate: d(2), milestoneId: beta.id,
      checklist: checks(
        ['Subject line options', true],
        ['Draft body'],
        ['Legal review'],
      ),
    }),

    // To do
    task({
      title: 'Empty states for boards and timeline',
      columnId: todo.id, assigneeIds: [maya.id], labelIds: [design.id],
      priority: 'medium', startDate: d(2), dueDate: d(7), milestoneId: freeze.id,
    }),
    task({
      title: 'Keyboard shortcuts for the board',
      description: 'N for new task, arrows to navigate cards, Enter to open. Document them in a help sheet.',
      columnId: todo.id, assigneeIds: [leo.id], labelIds: [eng.id],
      priority: 'low', startDate: d(5), dueDate: d(12), milestoneId: beta.id,
    }),
    task({
      title: 'Billing page copy review',
      columnId: todo.id, assigneeIds: [sofia.id, me.id], labelIds: [content.id],
      priority: 'high', dueDate: d(1),
    }),
    task({
      title: 'Weekly launch review',
      description: 'Fifteen minutes: what shipped, what slipped, what is next.',
      columnId: todo.id, assigneeIds: [me.id],
      dueDate: d(2),
      // Repeats when it reaches a done column — no scheduler involved.
      recurrence: { freq: 'weekly', interval: 1 },
    }),
    task({
      title: 'Load test with 2,000 tasks per board',
      columnId: todo.id, assigneeIds: [leo.id], labelIds: [eng.id],
      startDate: d(10), dueDate: d(16), milestoneId: beta.id,
    }),

    // Backlog
    task({
      title: 'Calendar feed for due dates',
      description: 'Publish a subscribable `.ics` feed so due dates show up in a calendar app.',
      labelIds: [eng.id], milestoneId: launch.id,
    }),
    task({
      title: 'Slack notifications on mentions',
      labelIds: [eng.id], milestoneId: launch.id, priority: 'low',
    }),
    task({
      title: 'Template gallery for new projects',
      labelIds: [design.id, content.id], milestoneId: launch.id,
      startDate: d(24), dueDate: d(40),
    }),
    task({
      title: 'Dark mode illustrations',
      labelIds: [design.id],
    }),
  ];

  return {
    v: 1,
    id: uid(),
    name: 'App launch',
    color: '#8833eb',
    // The brief is where a project says what it is for; the sample project
    // is the one place that is demonstrated rather than described.
    brief: 'Ship **version 1** of the mobile app to the App Store and Play Store.\n\n'
      + '- Done means: live in both stores, launch post published, support docs written\n'
      + '- Design lives in Figma, copy in the shared Drive folder\n'
      + '- Anything not needed for launch goes in Backlog, not in this quarter',
    members,
    labels,
    columns,
    tasks,
    milestones,
  };
}

/** Create the sample project through the store and flag it wipeable. */
export async function installSampleData(store) {
  const doc = sampleProjectDoc(store.user?.username || 'Me');
  await store.createProject({ name: doc.name, color: doc.color, sample: true, doc });
  await store.updateSettings({ sampleData: true, onboarded: true });

  // One small attachment so the feature is visible while exploring.
  try {
    const audited = doc.tasks.find((t) => t.title.startsWith('Audit'));
    const file = new File(
      ['# Onboarding audit notes\n\nStep 3 (workspace setup) loses 40% of signups.\nShortening it to a single screen is the highest-leverage fix.\n'],
      'audit-notes.md',
      { type: 'text/markdown' },
    );
    if (audited) await store.addAttachment(doc.id, audited.id, file);
  } catch { /* the sample stays useful without it */ }
  return doc;
}
