/** Onboarding: every hire with their checklist and progress. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { addFromInput, avatar, emptyState, iconButton, progressBar } from '../components.js';
import { groupTasks, hireStartDate, onboardingProgress, taskDueDate } from '../../core/onboard.js';
import { isHired } from '../../core/pipeline.js';
import { formatDate, todayISO } from '../../lib/dates.js';
import { plural } from '../../lib/format.js';

export function renderOnboarding(ctx) {
  const { store, ui } = ctx;
  const { candidates, onboarding, offers, jobs } = store.state;

  // Same gate as the profile's onboarding card: a hire moved back out of
  // Hired (an offer that fell through) or archived while on Hired (a
  // renege) is not a "new hire", and showing their checklist only here
  // would contradict the profile. The plan itself is kept, so restoring
  // or returning to Hired resumes the progress.
  const candidatesById = new Map(candidates.map((c) => [c.id, c]));
  const hires = Object.keys(onboarding)
    .map((id) => candidatesById.get(id))
    .filter((c) => c && isHired(c))
    .sort((a, b) => (onboarding[b.id].startedAt ?? '').localeCompare(onboarding[a.id].startedAt ?? ''));

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Onboarding'),
      el('p', { class: 'subtitle' }, plural(hires.length, 'new hire'))
    )
  );

  if (hires.length === 0) {
    return [
      header,
      emptyState({
        iconName: 'rocket',
        title: 'No hires yet',
        message: 'When an offer is signed, the new hire lands here with a ready-made onboarding checklist.',
        actions: [el('button', { class: 'btn btn-primary', onClick: () => ctx.navigate('pipeline') }, 'Go to pipeline')],
      }),
    ];
  }

  if (ui.onboardingOpen === undefined) ui.onboardingOpen = hires.length === 1 ? hires[0].id : null;

  return [
    header,
    el(
      'div',
      { class: 'onboard-list' },
      hires.map((candidate) => {
        const plan = onboarding[candidate.id];
        const job = jobs.find((j) => j.id === candidate.jobId);
        const { done, total, pct } = onboardingProgress(plan.tasks);
        const expanded = ui.onboardingOpen === candidate.id;
        // Dates come from the signed offer's start date, the one place the
        // app records when this person actually begins — and from the
        // latest signature when there is more than one, which is the rule
        // the due-task scan behind "Needs attention" follows too.
        const startDate = hireStartDate(offers, candidate.id);
        const today = todayISO();

        const addInput = el('input', {
          class: 'input',
          type: 'text',
          placeholder: 'Add a task…',
          'aria-label': `New task for ${candidate.name}`,
          dataset: { focusKey: `onboard-task-add-${candidate.id}` },
        });
        const addTask = () => addFromInput(addInput, (title) => store.addOnboardingTask(candidate.id, title));
        addInput.addEventListener('keydown', (e) => e.key === 'Enter' && addTask());

        return el(
          'div',
          { class: 'card onboard-card' },
          el(
            'button',
            {
              class: 'onboard-head',
              'aria-expanded': String(expanded),
              // Expanding re-renders the view and replaces this header, so
              // the keyboard was dropped on <body> every time a checklist
              // was opened or closed. The key hands focus to the
              // replacement, the way the board and the profile do.
              dataset: { focusKey: `onboard-head-${candidate.id}` },
              onClick: () => {
                ui.onboardingOpen = expanded ? null : candidate.id;
                ctx.refresh();
              },
            },
            avatar(candidate.name),
            el(
              'div',
              { class: 'item-main' },
              el('div', { class: 'item-title' }, candidate.name),
              el(
                'div',
                { class: 'item-sub' },
                [job?.title, startDate ? `starts ${formatDate(startDate)}` : null, plan.templateName || null]
                  .filter(Boolean)
                  .join(' · ')
              )
            ),
            el('div', { class: 'onboard-progress' }, progressBar(pct, `${candidate.name} onboarding progress`), el('span', { class: 'muted small tnum' }, `${done}/${total}`)),
            icon(expanded ? 'chevron-down' : 'chevron-right', 16)
          ),
          expanded
            ? el(
                'div',
                { class: 'onboard-body' },
                startDateNote(plan.tasks, startDate),
                el(
                  'div',
                  { class: 'task-groups' },
                  groupTasks(plan.tasks).map(([category, tasks]) =>
                    el(
                      'div',
                      { class: 'task-group' },
                      el('h3', { class: 'task-group-title' }, category),
                      tasks.map((task) =>
                        el(
                          'div',
                          { class: 'task-row' },
                          el(
                            'label',
                            { class: `task-label${task.done ? ' is-done' : ''}` },
                            el('input', {
                              type: 'checkbox',
                              class: 'task-check',
                              checked: task.done,
                              // Keep focus on this box across the re-render,
                              // like the candidate profile's checklist.
                              dataset: { focusKey: `task-check-${task.id}` },
                              onChange: () => store.toggleOnboardingTask(candidate.id, task.id),
                            }),
                            el('span', {}, task.title)
                          ),
                          taskDue(task, startDate, today),
                          iconButton({
                            name: 'x',
                            label: `Remove task: ${task.title}`,
                            size: 13,
                            onClick: () => store.removeOnboardingTask(candidate.id, task.id),
                          })
                        )
                      )
                    )
                  )
                ),
                el('div', { class: 'task-add' }, addInput, el('button', { class: 'btn btn-sm', onClick: addTask }, icon('plus', 14), 'Add')),
                el(
                  'button',
                  { class: 'btn btn-ghost btn-sm onboard-profile-link', onClick: () => ctx.navigate(`candidates/${candidate.id}`) },
                  'View profile',
                  icon('arrow-right', 13)
                )
              )
            : null
        );
      })
    ),
  ];
}

/**
 * Why a plan's dated tasks are showing no dates. The start date comes
 * from the hire's signed offer, and a hire recorded without one — moved
 * to Hired by hand, or brought over from somewhere else — has none, so
 * every offset in their checklist is inert. That was silent: the tasks
 * simply looked undated, and nothing they were meant to trigger ever
 * happened.
 *
 * Exported for the profile's copy of the checklist, like taskDue.
 */
export function startDateNote(tasks, startDate) {
  if (startDate) return null;
  const dated = (tasks ?? []).filter((t) => Number.isInteger(t?.offsetDays)).length;
  if (dated === 0) return null;
  return el(
    'p',
    { class: 'muted small onboard-note' },
    `${plural(dated, 'task')} here ${dated === 1 ? 'is' : 'are'} dated against the start date, which comes from a signed offer. Until this hire has one, they have no due date.`
  );
}

/**
 * When a dated task is due, in the same shape follow-ups use: overdue in
 * red, today called out, everything else a quiet date. A task with no
 * offset — or a hire with no recorded start date — shows nothing.
 *
 * Exported because the candidate profile renders the same checklist: a
 * task that has come due has to read the same way in both places.
 */
export function taskDue(task, startDate, today = todayISO()) {
  const dueDate = taskDueDate(task, startDate);
  if (!dueDate || task.done) return null;
  const overdue = dueDate < today;
  const dueToday = dueDate === today;
  return el(
    'span',
    { class: `followup-due tnum${overdue ? ' is-overdue' : dueToday ? ' is-today' : ''}` },
    icon(overdue ? 'circle-alert' : 'calendar-check', 12),
    overdue ? `was due ${formatDate(dueDate)}` : dueToday ? 'today' : formatDate(dueDate)
  );
}
