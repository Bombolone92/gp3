/** Create / edit a candidate. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { field, jobSelect } from '../components.js';
import { openModal } from '../modal.js';
import { toast } from '../toast.js';
import { isActive, stagesFrom } from '../../core/pipeline.js';
import { CANDIDATE_SOURCES } from '../../core/store.js';
import { errorRegion, optionSelect, runSave, linkValue, timeZoneSelect } from './form.js';

export function openCandidateEditor(ctx, candidate = null, { jobId = null } = {}) {
  const isNew = !candidate;
  const { jobs } = ctx.store.state;
  const errors = errorRegion();

  // New candidates go on jobs that are still hiring; edits keep the current
  // job selectable even if it has closed since, and an explicitly requested
  // job (adding from that job's own page) stays selectable too — otherwise
  // the select silently falls back to a different job.
  const selectable = jobs.filter((j) => j.status !== 'closed' || j.id === candidate?.jobId || j.id === jobId);
  if (selectable.length === 0) {
    // Having jobs and having a job to hire onto are different problems:
    // "create a job first" reads like a bug to someone looking at four
    // of them, and hides the one-click fix.
    toast(
      jobs.length === 0
        ? 'Create a job first, then add candidates to it.'
        : 'Every job is closed. Reopen one, or create a new job, to add candidates to it.',
      'error'
    );
    return;
  }

  const name = el('input', { class: 'input', type: 'text', value: candidate?.name ?? '', placeholder: 'Full name' });
  const email = el('input', { class: 'input', type: 'email', value: candidate?.email ?? '', placeholder: 'name@example.com' });
  const phone = el('input', { class: 'input', type: 'tel', value: candidate?.phone ?? '', placeholder: '+1 555 000 0000' });
  const job = jobSelect(selectable, candidate?.jobId ?? jobId ?? selectable[0]?.id);

  /* Duplicate check: the same email usually means the same person. Offer
     to open (or re-engage) them instead of quietly creating a twin. */
  const dupNotice = el('div', { class: 'dup-notice' });
  function checkDuplicate() {
    dupNotice.replaceChildren();
    const typed = email.value.trim().toLowerCase();
    if (!typed) return;
    const existing = ctx.store.state.candidates.find(
      (c) => c.id !== candidate?.id && c.email.trim().toLowerCase() === typed
    );
    if (!existing) return;
    const existingJob = ctx.store.state.jobs.find((j) => j.id === existing.jobId);
    const archived = !isActive(existing);
    dupNotice.appendChild(
      el(
        'div',
        { class: 'form-error' },
        icon('circle-alert', 15),
        el(
          'span',
          { class: 'grow' },
          `${existing.name} already has this email${existingJob ? ` (${existingJob.title}${archived ? ', archived' : ''})` : ''}.`
        ),
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: () => {
              modal.close();
              ctx.navigate(`candidates/${existing.id}`);
            },
          },
          'Open profile'
        ),
        archived
          ? el(
              'button',
              {
                class: 'btn btn-sm',
                title: 'Start a fresh candidacy on the selected job, keeping their history',
                // Disabled before the await like every other one-shot
                // action: a double click would re-enter after the status
                // already flipped and throw "already in play" over the
                // first click's success toast.
                onClick: async (e) => {
                  const button = e.currentTarget;
                  button.disabled = true;
                  try {
                    await ctx.store.reengageCandidate(existing.id, job.value);
                    modal.close();
                    ctx.navigate(`candidates/${existing.id}`);
                    toast(`${existing.name} re-engaged instead of duplicated`);
                  } catch (err) {
                    button.disabled = false;
                    toast(err.message, 'error');
                  }
                },
              },
              'Re-engage'
            )
          : null
      )
    );
  }
  email.addEventListener('input', checkDuplicate);
  const stage = optionSelect(
    stagesFrom(ctx.store.state.settings).map((s) => ({ value: s.key, label: s.label })),
    candidate?.stage ?? 'applied'
  );
  // A source imported from CSV (or restored from a backup) can be any
  // text; keep the current value selectable like the Job select does, or
  // the select falls back to "Unknown" and Save silently erases it.
  const sourceOptions = ['', ...CANDIDATE_SOURCES];
  if (candidate?.source && !sourceOptions.includes(candidate.source)) sourceOptions.push(candidate.source);
  const source = optionSelect(sourceOptions.map((s) => ({ value: s, label: s || 'Unknown' })), candidate?.source ?? '');
  const link = el('input', { class: 'input', type: 'url', value: candidate?.link ?? '', placeholder: 'Portfolio, LinkedIn, or resume URL' });
  // Optional: with it, every slot can be shown on their clock too.
  const timeZone = timeZoneSelect(candidate?.timeZone ?? '', { emptyLabel: 'Not known' });
  const notes = el('textarea', { class: 'textarea', rows: 3, placeholder: 'Anything worth remembering about this candidate.' });
  notes.value = candidate?.notes ?? '';

  const save = el('button', { class: 'btn btn-primary' }, isNew ? 'Add candidate' : 'Save changes');
  save.addEventListener('click', async () => {
    const ok = await runSave(save, errors, async () => {
      if (isNew) {
        const created = await ctx.store.addCandidate({
          name: name.value,
          email: email.value,
          phone: phone.value,
          jobId: job.value,
          stage: stage.value,
          source: source.value,
          link: linkValue(link, 'The link'),
          notes: notes.value,
          timeZone: timeZone.value,
        });
        ctx.navigate(`candidates/${created.id}`);
      } else {
        await ctx.store.updateCandidate(candidate.id, {
          name: name.value,
          email: email.value,
          phone: phone.value,
          jobId: job.value,
          source: source.value,
          link: linkValue(link, 'The link'),
          notes: notes.value,
          timeZone: timeZone.value,
        });
      }
    });
    if (ok) {
      modal.close();
      toast(isNew ? 'Candidate added' : 'Candidate updated');
    }
  });

  const modal = openModal({
    title: isNew ? 'New candidate' : 'Edit candidate',
    content: el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'span-2' }, field('Name', name, 'cnd-name')),
      field('Email', email, 'cnd-email'),
      field('Phone', phone, 'cnd-phone'),
      el('div', { class: 'span-2' }, dupNotice),
      el('div', { class: 'span-2' }, field('Job', job, 'cnd-job')),
      isNew ? field('Starting stage', stage, 'cnd-stage') : null,
      field('Source', source, 'cnd-source'),
      el('div', { class: 'span-2' }, field('Link', link, 'cnd-link')),
      el('div', { class: 'span-2' }, field('Their time zone', timeZone, 'cnd-zone')),
      el('div', { class: 'span-2' }, field('Notes', notes, 'cnd-notes')),
      el('div', { class: 'span-2' }, errors.node)
    ),
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
}
