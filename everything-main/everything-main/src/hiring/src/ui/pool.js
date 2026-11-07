/** Talent pool dialogs: join / edit tags, and re-engage on a job. */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { field, jobSelect, tagChip, tagInput } from './components.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { candidateTags, parseTags } from '../core/tags.js';
import { plural } from '../lib/format.js';

/**
 * Add an archived candidate to the talent pool, or let a member go.
 * Labels are the candidate's own tags now — editable on the profile in any
 * stage — so this dialog is about one thing: are they worth keeping?
 */
export function openPoolDialog(ctx, candidate) {
  const { store } = ctx;
  const isMember = Boolean(candidate.pool);
  const currentTags = candidateTags(candidate);
  /* The shared tag box, like the profile's and the bulk bar's. Hand-rolled
     here, this was the one tag field in the app with no typeahead over the
     vocabulary already in use — in the very dialog whose purpose is
     labelling someone so they can be found again years later, which is
     exactly where a near-duplicate ("bad timing" beside "Bad timing on
     comp") costs the most. It also had no length cap, so a long label was
     trimmed to thirty characters on save without a word. */
  const { input: tags, datalist: tagList } = tagInput(store.state.candidates, {
    label: null,
    placeholder: 'e.g. strong, bad timing, senior',
  });
  tags.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());

  const save = el('button', { class: 'btn btn-primary' }, icon('bookmark', 15), isMember ? 'Add these tags' : 'Add to pool');
  save.addEventListener('click', async () => {
    const cleaned = parseTags(tags.value);
    save.disabled = true;
    try {
      await store.addToPool(candidate.id, cleaned);
      modal.close();
      toast(
        isMember
          ? cleaned.length > 0
            ? `${plural(cleaned.length, 'tag')} added`
            : 'Nothing changed'
          : `${candidate.name} added to the talent pool`
      );
    } catch (err) {
      save.disabled = false;
      toast(err.message, 'error');
    }
  });

  const remove = isMember
    ? el(
        'button',
        {
          class: 'btn',
          // Same guard as Save above: disabled across the await so a
          // double-click cannot fire twice, and a failed write says so
          // instead of leaving the dialog sitting there silently.
          onClick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await store.removeFromPool(candidate.id);
              modal.close();
              toast(`${candidate.name} removed from the talent pool`);
            } catch (err) {
              button.disabled = false;
              toast(err.message, 'error');
            }
          },
        },
        'Remove from pool'
      )
    : null;

  const modal = openModal({
    title: isMember ? 'Talent pool' : `Add ${candidate.name} to the talent pool`,
    content: [
      el(
        'p',
        { class: 'confirm-message' },
        'Pool members keep their full profile and history, and resurface here when a similar role opens.'
      ),
      currentTags.length > 0
        ? el('div', { class: 'field' }, el('label', {}, 'Their tags'), el('div', { class: 'tag-row' }, currentTags.map((t) => tagChip(t))))
        : null,
      field('Add tags (comma-separated)', tags, 'pool-tags'),
      tagList,
      el('p', { class: 'muted small' }, 'Tags belong to the candidate, not to the pool: they stay searchable and filterable if this person comes back into play.'),
    ],
    footer: [remove, el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
}

/** Start a fresh candidacy on a chosen job for an archived candidate. */
export function openConsiderDialog(ctx, candidate) {
  const { store } = ctx;
  const jobs = store.state.jobs.filter((j) => j.status !== 'closed');
  if (jobs.length === 0) {
    toast('No open jobs to consider them for. Create or reopen one first.', 'error');
    return;
  }
  const job = jobSelect(jobs, jobs[0]?.id);

  const start = el('button', { class: 'btn btn-primary' }, icon('user-plus', 15), 'Start candidacy');
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      await store.reengageCandidate(candidate.id, job.value);
      modal.close();
      ctx.navigate(`candidates/${candidate.id}`);
      toast(`${candidate.name} is back in play, in Applied`);
    } catch (err) {
      start.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: `Consider ${candidate.name} for…`,
    content: [
      el(
        'p',
        { class: 'confirm-message' },
        'They return to the board in Applied with their whole history: past interviews, feedback, and notes stay on the profile.'
      ),
      field('Job', job, 'consider-job'),
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), start],
  });
}
