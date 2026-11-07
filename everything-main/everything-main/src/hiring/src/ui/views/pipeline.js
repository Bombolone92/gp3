/** Pipeline board: candidates by stage, drag-and-drop between columns. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { avatar, badge, buttonKeydown, emptyState, jobSelect, segmented, stageBadge, tagChip } from '../components.js';
import { toast } from '../toast.js';
import { openCandidateEditor } from '../editors/candidate.js';
import { openPasteApplication } from '../importer.js';
import { openConsiderDialog, openPoolDialog } from '../pool.js';
import { openFollowupDialog } from '../followups.js';
import { openBulkArchive, openBulkTag } from '../bulk.js';
import { openCompareDialog } from './compare.js';
import { openRetentionReview } from '../retention.js';
import { retentionDue } from '../../core/retention.js';
import { daysInStage, isActive, stageLabel, stagesFrom } from '../../core/pipeline.js';
import { summarizeScorecards } from '../../core/scorecards.js';
import { screeningMismatches } from '../../core/screening.js';
import { lastContactedAt } from '../../core/emails.js';
import { followupDue } from '../../core/followups.js';
import { candidateTags, hasTag, tagCounts } from '../../core/tags.js';
import { plural } from '../../lib/format.js';
import { daysSince, relativeDays } from '../../lib/dates.js';

export function renderPipeline(ctx) {
  const { store, ui } = ctx;
  const { jobs, candidates, scorecards } = store.state;
  // A filter pointing at a deleted job would empty the whole board while
  // the select displays "All jobs" (no option matches, so the browser
  // shows the first one). Fall back to every job for real.
  const jobFilter = jobs.some((j) => j.id === ui.pipelineJob) ? ui.pipelineJob : '';
  const query = (ui.pipelineQuery ?? '').toLowerCase();
  const tab = ui.pipelineTab ?? 'active';
  // The tag vocabulary in use across every candidate, so the filter still
  // lists a tag that only archived or pool members carry.
  const tags = tagCounts(candidates);
  // A filter on a tag nobody carries any more would empty the board while
  // the select showed the first option; fall back to every tag.
  const tagFilter = tags.some((t) => t.tag === ui.pipelineTag) ? ui.pipelineTag : '';

  const matches = (c) =>
    (!jobFilter || c.jobId === jobFilter) &&
    (!tagFilter || hasTag(c, tagFilter)) &&
    (!query ||
      c.name.toLowerCase().includes(query) ||
      c.email.toLowerCase().includes(query) ||
      candidateTags(c).some((t) => t.toLowerCase().includes(query)));

  /* Selection mode: what you see is what you act on — the selection is
     pruned to the candidates currently visible on the board. */
  const selectMode = tab === 'active' && Boolean(ui.pipelineSelectMode);
  ui.pipelineSelected ??= new Set();
  const visibleIds = new Set(candidates.filter((c) => isActive(c) && matches(c)).map((c) => c.id));
  for (const id of [...ui.pipelineSelected]) {
    if (!visibleIds.has(id)) ui.pipelineSelected.delete(id);
  }
  if (!selectMode) ui.pipelineSelected.clear();

  const toggleSelect = (candidate, shiftKey, columnIds) => {
    const selected = ui.pipelineSelected;
    const last = ui.pipelineLastToggled;
    if (shiftKey && last && last !== candidate.id && columnIds.includes(last) && columnIds.includes(candidate.id)) {
      // Shift extends within the column, matching what the click sets
      // the target card to.
      const a = columnIds.indexOf(last);
      const b = columnIds.indexOf(candidate.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      const select = !selected.has(candidate.id);
      for (const id of columnIds.slice(from, to + 1)) {
        if (select) selected.add(id);
        else selected.delete(id);
      }
    } else if (selected.has(candidate.id)) {
      selected.delete(candidate.id);
    } else {
      selected.add(candidate.id);
    }
    ui.pipelineLastToggled = candidate.id;
    ctx.refresh();
  };

  const search = el('input', {
    class: 'input search-input',
    type: 'search',
    placeholder: 'Search candidates…',
    value: ui.pipelineQuery ?? '',
    'aria-label': 'Search candidates',
    dataset: { focusKey: 'pipeline-search' },
    onInput: (e) => {
      ui.pipelineQuery = e.target.value;
      ctx.refresh();
    },
  });

  // Only rendered once tags exist: an account that has never tagged anyone
  // does not need a seventh control in this header.
  const tagFilterSelect = tags.length
    ? el(
        'select',
        {
          class: 'select job-filter',
          'aria-label': 'Filter by tag',
          dataset: { focusKey: 'pipeline-tag-filter' },
          onChange: (e) => {
            ui.pipelineTag = e.target.value;
            ctx.refresh();
          },
        },
        el('option', { value: '' }, 'All tags'),
        tags.map(({ tag, count }) => el('option', { value: tag, selected: tag === tagFilter }, `${tag} · ${count}`))
      )
    : null;

  const jobsFilterSelect = jobSelect(jobs, jobFilter, { allLabel: 'All jobs' });
  jobsFilterSelect.classList.add('job-filter');
  jobsFilterSelect.setAttribute('aria-label', 'Filter by job');
  jobsFilterSelect.dataset.focusKey = 'pipeline-job-filter';
  jobsFilterSelect.addEventListener('change', (e) => {
    ui.pipelineJob = e.target.value;
    ctx.refresh();
  });

  // The columns below are filtered by the search box and job select; a
  // count that ignores both would disagree with the board it captions.
  const activeCount = candidates.filter(isActive).length;
  const subtitle =
    tab === 'active' && (jobFilter || query || tagFilter)
      ? `Showing ${visibleIds.size} of ${plural(activeCount, 'active candidate')}`
      : plural(activeCount, 'active candidate');

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Pipeline'),
      el('p', { class: 'subtitle' }, subtitle)
    ),
    el(
      'div',
      { class: 'view-actions' },
      search,
      jobsFilterSelect,
      tagFilterSelect,
      tab === 'active'
        ? el(
            'button',
            {
              class: `btn${selectMode ? ' btn-primary' : ''}`,
              'aria-pressed': String(selectMode),
              title: 'Select candidates for bulk actions',
              // Turning selection on or off re-renders the board, and this
              // very button with it; the key hands focus to its
              // replacement so the toggle can be pressed twice in a row.
              dataset: { focusKey: 'pipeline-select-mode' },
              onClick: () => {
                ui.pipelineSelectMode = !selectMode;
                ui.pipelineSelected.clear();
                ctx.refresh();
              },
            },
            icon('list-checks', 15),
            'Select'
          )
        : null,
      tab === 'active'
        ? el(
            'button',
            {
              class: 'btn',
              title: 'Side-by-side comparison of finalists',
              onClick: () => openCompareDialog(ctx, jobFilter || null),
            },
            icon('users', 15),
            'Compare'
          )
        : null,
      segmented(
        [
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
          { value: 'pool', label: 'Talent pool' },
        ],
        tab,
        (v) => {
          ui.pipelineTab = v;
          ctx.refresh();
        },
        'Candidate status'
      ),
      el(
        'button',
        { class: 'btn', title: 'Add a candidate from an application email', onClick: () => openPasteApplication(ctx) },
        icon('mail', 15),
        'Paste application'
      ),
      el(
        'button',
        { class: 'btn btn-primary', onClick: () => openCandidateEditor(ctx, null, { jobId: jobFilter || null }) },
        icon('user-plus', 15),
        'Add candidate'
      )
    )
  );

  if (jobs.length === 0) {
    return [
      header,
      emptyState({
        iconName: 'kanban',
        title: 'The board needs a job first',
        message: 'Create a job posting, then track its candidates from Applied to Hired here.',
        actions: [el('button', { class: 'btn btn-primary', onClick: () => ctx.navigate('jobs') }, 'Go to jobs')],
      }),
    ];
  }

  if (tab === 'archived') return [header, renderArchived(ctx, matches)];
  if (tab === 'pool') return [header, renderPool(ctx, matches)];

  /* A filter that matches nobody is not an empty pipeline. The board's
     answer to one was five columns each reading "No one here", which
     tells the user their account is empty rather than that a search is
     hiding everyone, and offers no way back out. The archive tab beside
     it and the Jobs list both draw a filtered-empty state and say so;
     do the same, and put the way out in it. */
  const activeTotal = candidates.filter(isActive).length;
  if (activeTotal > 0 && visibleIds.size === 0 && (query || jobFilter || tagFilter)) {
    const jobTitle = jobs.find((j) => j.id === jobFilter)?.title;
    return [
      header,
      emptyState({
        iconName: 'search',
        title: 'No candidates match',
        message: [
          query ? `None of the ${plural(activeTotal, 'active candidate')} match “${ui.pipelineQuery}”` : null,
          !query && jobTitle ? `No active candidate is on ${jobTitle}` : null,
          !query && !jobTitle && tagFilter ? `No active candidate is tagged “${tagFilter}”` : null,
          query && jobTitle ? `on ${jobTitle}` : null,
          query && tagFilter ? `tagged “${tagFilter}”` : null,
          !query && jobTitle && tagFilter ? `and tagged “${tagFilter}”` : null,
        ]
          .filter(Boolean)
          .join(', ')
          .concat('.'),
        actions: [
          el(
            'button',
            {
              class: 'btn btn-primary',
              onClick: () => {
                ui.pipelineQuery = '';
                ui.pipelineJob = '';
                ui.pipelineTag = '';
                ctx.refresh();
              },
            },
            icon('restore', 15),
            'Clear the filters'
          ),
        ],
      }),
    ];
  }

  // Index scorecards once; filtering them per card is quadratic in
  // candidates and shows up on every keystroke in the search box.
  const scorecardsByCandidate = new Map();
  for (const s of scorecards) {
    const list = scorecardsByCandidate.get(s.candidateId);
    if (list) list.push(s);
    else scorecardsByCandidate.set(s.candidateId, [s]);
  }
  // Same reason: a linear jobs.find per card is jobs × candidates.
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  // The scroll key lets render() hand the horizontal position back after
  // a re-render: without it, dropping a card into an off-screen column
  // snapped the board back to Applied on every single move.
  const board = el('div', { class: 'board', role: 'group', 'aria-label': 'Pipeline board', dataset: { scrollKey: 'pipeline-board' } });
  for (const stage of stagesFrom(store.state.settings)) {
    const cards = candidates
      .filter((c) => isActive(c) && c.stage === stage.key && matches(c))
      .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt));
    const columnIds = cards.map((c) => c.id);

    const column = el(
      'div',
      {
        class: 'board-col',
        // Name the column: as bare list items, a screen reader announced
        // each stage as an unnamed blob of cards — the stage being the
        // one thing the board exists to convey.
        role: 'group',
        'aria-label': `${stage.label}, ${plural(cards.length, 'candidate')}`,
        dataset: { stage: stage.key },
      },
      el(
        'div',
        { class: 'board-col-head' },
        icon(stage.icon, 14),
        el('span', { class: 'board-col-title' }, stage.label),
        el('span', { class: 'board-col-count tnum' }, String(cards.length))
      ),
      el(
        'div',
        { class: 'board-col-body' },
        cards.length === 0 ? el('div', { class: 'board-empty' }, 'No one here') : null,
        cards.map((c) =>
          boardCard(ctx, c, scorecardsByCandidate, jobsById, !jobFilter, {
            selectMode,
            selected: ui.pipelineSelected,
            columnIds,
            toggleSelect,
          })
        )
      )
    );

    // Drop target: highlight while dragging over, move on drop.
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      column.classList.add('is-over');
    });
    column.addEventListener('dragleave', (e) => {
      // dragleave also fires when crossing into a child card; only clear
      // the highlight when the pointer actually leaves the column.
      if (!column.contains(e.relatedTarget)) column.classList.remove('is-over');
    });
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('is-over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id || !store.state.candidates.some((c) => c.id === id)) return;
      try {
        await store.moveStage(id, stage.key);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    board.appendChild(column);
  }

  return [header, board, selectMode ? selectionBar(ctx) : null];
}

/** Floating bulk-action bar shown while selection mode is on. */
function selectionBar(ctx) {
  const { store, ui } = ctx;
  const settings = store.state.settings;
  const count = ui.pipelineSelected.size;

  // Every card toggle re-renders the board, and with it this bar. Remember
  // the chosen target stage in `ui`: a freshly built select falls back to
  // its first option, so picking "Offer" and then selecting one more
  // candidate silently reset the target to Applied — and Move sent the
  // whole selection there instead.
  const stages = stagesFrom(settings);
  const target = stages.some((s) => s.key === ui.bulkStage) ? ui.bulkStage : stages[0].key;
  const stageSelect = el(
    'select',
    { class: 'select', 'aria-label': 'Move selection to stage', dataset: { focusKey: 'bulk-stage' } },
    stages.map((s) => el('option', { value: s.key, selected: s.key === target }, s.label))
  );
  stageSelect.addEventListener('change', () => {
    ui.bulkStage = stageSelect.value;
  });

  const move = el(
    'button',
    {
      class: 'btn',
      disabled: count === 0,
      onClick: async () => {
        try {
          const moved = await store.moveCandidatesStage([...ui.pipelineSelected], stageSelect.value);
          ui.pipelineSelected.clear();
          toast(`${plural(moved, 'candidate')} moved to ${stageLabel(stageSelect.value, settings)}`);
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
    icon('arrow-right', 14),
    'Move'
  );

  const tag = el(
    'button',
    {
      class: 'btn',
      disabled: count === 0,
      onClick: () => openBulkTag(ctx, [...ui.pipelineSelected]),
    },
    icon('tag', 14),
    'Tag…'
  );

  const archive = el(
    'button',
    {
      class: 'btn',
      disabled: count === 0,
      onClick: () =>
        openBulkArchive(ctx, [...ui.pipelineSelected], {
          onDone: () => {
            ui.pipelineSelected.clear();
            ctx.refresh();
          },
        }),
    },
    icon('ban', 14),
    'Archive…'
  );

  return el(
    'div',
    { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Bulk actions' },
    el('span', { class: 'bulk-count tnum' }, count === 0 ? 'Select candidates' : `${count} selected`),
    stageSelect,
    move,
    tag,
    archive,
    el('span', { class: 'bulk-sep' }),
    el(
      'button',
      {
        class: 'btn btn-ghost',
        onClick: () => {
          ui.pipelineSelectMode = false;
          ui.pipelineSelected.clear();
          ctx.refresh();
        },
      },
      'Done'
    )
  );
}

function boardCard(ctx, candidate, scorecardsByCandidate, jobsById, showJob, selection = {}) {
  const { selectMode = false, selected, columnIds = [], toggleSelect } = selection;
  const job = jobsById.get(candidate.jobId);
  const summary = summarizeScorecards(scorecardsByCandidate.get(candidate.id) ?? []);
  const days = daysInStage(candidate);
  const openFollowups = (candidate.followups ?? []).filter((f) => !f.done);
  // On the same clock the overview and the reminders use: comparing dates
  // alone called tonight's 23:00 call due at breakfast, so the card
  // raised its alert over work nothing else agreed was waiting yet.
  const dueFollowupCount = openFollowups.filter((f) => followupDue(f)).length;
  // A screening answer that misses one of the job's must-haves. A quiet
  // flag: it says "read this application", not "this one is out".
  const mismatches = screeningMismatches(candidate, job);
  // How long since we wrote to them. No chip at all means never — which
  // is the thing worth noticing on a board full of people.
  const contacted = lastContactedAt(candidate);
  const cardTags = candidateTags(candidate);
  const isSelected = selectMode && selected.has(candidate.id);

  const activate = selectMode
    ? (e) => toggleSelect(candidate, Boolean(e?.shiftKey), columnIds)
    : () => ctx.navigate(`candidates/${candidate.id}`);

  const card = el(
    'div',
    {
      class: `board-card${selectMode ? ' is-selectable' : ''}${isSelected ? ' is-selected' : ''}`,
      draggable: !selectMode,
      role: selectMode ? 'checkbox' : 'button',
      'aria-checked': selectMode ? String(isSelected) : null,
      tabindex: 0,
      // The stage is in the card's own label too: element-jumping
      // navigation skips the column group's announcement.
      'aria-label': selectMode
        ? `Select ${candidate.name}`
        : `${candidate.name}, ${plural(days, 'day')} in ${stageLabel(candidate.stage, ctx.store.state.settings)}. Open profile`,
      // In selection mode this card is a checkbox, and ticking one
      // re-renders the whole board — so every Space dropped focus on
      // <body>, and picking a second candidate by keyboard meant tabbing
      // back through the sidebar, the header, and every earlier column.
      // The key hands focus to this card's replacement, the way the
      // profile's stage controls and the board's search box already do.
      dataset: { focusKey: `board-card-${candidate.id}` },
      onClick: activate,
      onKeydown: buttonKeydown(activate),
    },
    el(
      'div',
      { class: 'board-card-top' },
      selectMode
        ? el('span', { class: 'board-card-check', 'aria-hidden': 'true' }, icon('check', 12))
        : avatar(candidate.name, 'avatar-sm'),
      el('span', { class: 'board-card-name' }, candidate.name),
      el('span', { class: 'grow' }),
      selectMode
        ? null
        : el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm board-card-action',
              'aria-label': `Add a follow-up for ${candidate.name}`,
              title: 'Add follow-up',
              onClick: (e) => {
                e.stopPropagation();
                openFollowupDialog(ctx, candidate);
              },
              // The card's own Enter/space handler would swallow the button
              // press and navigate instead; keep activation on the button.
              onKeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              },
            },
            icon('calendar-plus', 13)
          )
    ),
    showJob && job ? el('div', { class: 'board-card-job' }, job.title) : null,
    // Up to three, then a count: the card is a glance, not a record.
    cardTags.length > 0
      ? el(
          'div',
          { class: 'board-card-tags' },
          cardTags.slice(0, 3).map((tag) => tagChip(tag)),
          cardTags.length > 3 ? el('span', { class: 'tag-chip' }, `+${cardTags.length - 3}`) : null
        )
      : null,
    el(
      'div',
      { class: 'board-card-meta' },
      el('span', { class: 'board-card-days' }, icon('clock', 12), `${days}d`),
      openFollowups.length > 0
        ? el(
            'span',
            {
              class: `board-card-days${dueFollowupCount > 0 ? ' followup-alert' : ''}`,
              title: dueFollowupCount > 0 ? plural(dueFollowupCount, 'follow-up') + ' due' : plural(openFollowups.length, 'open follow-up'),
            },
            icon('calendar-check', 12),
            String(openFollowups.length)
          )
        : null,
      mismatches.length > 0
        ? el(
            'span',
            {
              class: 'board-card-days is-flagged',
              role: 'img',
              'aria-label': `${plural(mismatches.length, 'must-have')} not met: ${mismatches.map((q) => q.label).join(', ')}`,
              title: `Must-have not met: ${mismatches.map((q) => q.label).join(', ')}`,
            },
            icon('circle-alert', 12),
            mismatches.length > 1 ? String(mismatches.length) : null
          )
        : null,
      contacted
        ? el(
            'span',
            { class: 'board-card-days', title: `Last contacted ${relativeDays(contacted)}` },
            icon('mail', 12),
            `${daysSince(contacted)}d`
          )
        : null,
      (candidate.attachments?.length ?? 0) > 0
        ? el(
            'span',
            { class: 'board-card-days', title: plural(candidate.attachments.length, 'attachment') },
            icon('paperclip', 12),
            String(candidate.attachments.length)
          )
        : null,
      summary.count > 0
        ? el(
            'span',
            { class: `board-card-lean lean-${summary.leaning}` },
            icon(summary.leaning === 'hire' ? 'circle-check' : summary.leaning === 'no_hire' ? 'circle-alert' : 'info', 12),
            plural(summary.count, 'review')
          )
        : null
    )
  );

  card.addEventListener('dragstart', (e) => {
    // text/plain is the one type every browser's drag store supports.
    e.dataTransfer.setData('text/plain', candidate.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
  return card;
}

function renderArchived(ctx, matches) {
  const { store } = ctx;
  const all = store.state.candidates.filter((c) => !isActive(c));
  const archived = all
    .filter(matches)
    .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt));

  const due = retentionDue(store.state);
  const retentionBanner =
    due.length > 0
      ? el(
          'div',
          { class: 'card retention-banner' },
          icon('hourglass', 16),
          el(
            'span',
            { class: 'grow' },
            `${plural(due.length, 'candidate')} passed your ${store.state.settings.retentionMonths}-month retention window.`
          ),
          el('button', { class: 'btn btn-sm', onClick: () => openRetentionReview(ctx) }, 'Review…')
        )
      : null;

  if (archived.length === 0) {
    // An empty archive and a filter that matches none of it are different
    // stories — and the retention reminder concerns the whole archive, so
    // a narrow search must not hide it.
    return [
      retentionBanner,
      all.length === 0
        ? emptyState({
            iconName: 'inbox',
            title: 'Nothing archived',
            message: 'Rejected and withdrawn candidates end up here, and can be restored any time.',
          })
        : emptyState({
            iconName: 'inbox',
            title: 'No archived candidates match',
            message: 'Adjust the search or the job filter to see the rest of the archive.',
          }),
    ];
  }

  const list = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'row-list' },
      archived.map((c) => {
        const job = store.state.jobs.find((j) => j.id === c.jobId);
        return el(
          'div',
          {
            class: 'item-row is-clickable',
            role: 'link',
            tabindex: 0,
            onClick: () => ctx.navigate(`candidates/${c.id}`),
            // Keydown bubbles up from the nested Restore button too; only
            // navigate when Enter was pressed on the row itself.
            onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && ctx.navigate(`candidates/${c.id}`),
          },
          avatar(c.name),
          el(
            'div',
            { class: 'item-main' },
            el('div', { class: 'item-title' }, c.name),
            el('div', { class: 'item-sub' }, `${job?.title ?? 'Unknown job'} · ${relativeDays(c.stageChangedAt)}`)
          ),
          el('div', { class: 'tag-row archive-tags' }, candidateTags(c).slice(0, 4).map((t) => tagChip(t))),
          c.pool ? badge('Pool', 'accent') : null,
          badge(c.status === 'rejected' ? 'Rejected' : 'Withdrawn', c.status === 'rejected' ? 'danger' : ''),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm',
              'aria-label': c.pool ? 'Edit talent pool entry' : 'Add to talent pool',
              title: c.pool ? 'Edit talent pool entry' : 'Add to talent pool',
              onClick: (e) => {
                e.stopPropagation();
                openPoolDialog(ctx, c);
              },
            },
            icon('bookmark', 14)
          ),
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                await store.restoreCandidate(c.id);
                toast(`${c.name} restored to ${stageLabel(c.stage, store.state.settings)}`);
              },
            },
            icon('restore', 14),
            'Restore'
          )
        );
      })
    )
  );
  return [retentionBanner, list];
}

/** Talent pool: past candidates worth re-engaging, across every job. */
function renderPool(ctx, matches) {
  const { store } = ctx;
  const all = store.state.candidates.filter((c) => c.pool);
  const members = all
    .filter(matches)
    .sort((a, b) => (b.pool.addedAt ?? '').localeCompare(a.pool.addedAt ?? ''));

  if (members.length === 0) {
    return all.length === 0
      ? emptyState({
          iconName: 'bookmark',
          title: 'The talent pool is empty',
          message: 'Archive a strong candidate, then add them to the pool from their profile or the archive. They resurface here when a similar role opens.',
        })
      : emptyState({
          iconName: 'bookmark',
          title: 'No pool members match',
          message: 'Adjust the search or the job filter to see the whole pool.',
        });
  }

  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'row-list' },
      members.map((c) => {
        const job = store.state.jobs.find((j) => j.id === c.jobId);
        const active = isActive(c);
        return el(
          'div',
          {
            class: 'item-row is-clickable',
            role: 'link',
            tabindex: 0,
            onClick: () => ctx.navigate(`candidates/${c.id}`),
            onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && ctx.navigate(`candidates/${c.id}`),
          },
          avatar(c.name),
          el(
            'div',
            { class: 'item-main' },
            el(
              'div',
              { class: 'item-title pool-title' },
              c.name,
              candidateTags(c).map((t) => tagChip(t))
            ),
            el('div', { class: 'item-sub' }, `${job?.title ?? 'Unknown job'} · joined the pool ${relativeDays(c.pool.addedAt)}`)
          ),
          active
            ? stageBadge(c.stage, store.state.settings)
            : badge(c.status === 'rejected' ? 'Rejected' : 'Withdrawn', c.status === 'rejected' ? 'danger' : ''),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm',
              'aria-label': 'Edit talent pool entry',
              title: 'Edit talent pool entry',
              onClick: (e) => {
                e.stopPropagation();
                openPoolDialog(ctx, c);
              },
            },
            icon('pencil', 14)
          ),
          active
            ? null
            : el(
                'button',
                {
                  class: 'btn btn-sm',
                  onClick: (e) => {
                    e.stopPropagation();
                    openConsiderDialog(ctx, c);
                  },
                },
                icon('user-plus', 14),
                'Consider for job…'
              )
        );
      })
    )
  );
}
