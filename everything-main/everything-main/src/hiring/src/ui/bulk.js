/**
 * Bulk archive dialog and the stepped rejection-email queue. mailto:
 * cannot batch, so after a bulk reject an optional queue walks through
 * prefilled drafts one keypress at a time.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, field, tagChip, tagInput } from './components.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { composeEmail } from './email.js';
import { plural } from '../lib/format.js';
import { optionSelect } from './editors/form.js';
import { MAX_TAGS, parseTags, tagCounts, tagKey } from '../core/tags.js';

/**
 * Archive `ids` with one shared reason. Offers the rejection-email queue
 * when any of them have an email address.
 */
export function openBulkArchive(ctx, ids, { reason = '', onDone } = {}) {
  const { store } = ctx;
  const candidates = ids
    .map((id) => store.state.candidates.find((c) => c.id === id))
    .filter((c) => c && c.status === 'active');
  if (candidates.length === 0) {
    toast('No active candidates selected.', 'error');
    return;
  }
  const emailable = candidates.filter((c) => c.email);

  const kind = optionSelect(
    [
      { value: 'rejected', label: 'Rejected (we passed)' },
      { value: 'withdrawn', label: 'Withdrawn (they pulled out)' },
    ],
    'rejected'
  );
  const reasonInput = el('input', { class: 'input', type: 'text', value: reason, placeholder: 'Optional, kept on each timeline' });
  const emailCheck = el('input', { type: 'checkbox', class: 'task-check', id: 'bulk-email' });
  const emailRow =
    emailable.length > 0
      ? el(
          'label',
          { class: 'task-label', for: 'bulk-email' },
          emailCheck,
          el('span', {}, `Walk through rejection email drafts afterwards (${plural(emailable.length, 'candidate')} with an email)`)
        )
      : null;
  // Rejection drafts only make sense when the company is doing the rejecting.
  kind.addEventListener('change', () => {
    if (emailRow) emailRow.style.display = kind.value === 'rejected' ? '' : 'none';
  });

  const archive = el('button', { class: 'btn btn-danger' }, icon('ban', 15), `Archive ${plural(candidates.length, 'candidate')}`);
  archive.addEventListener('click', async () => {
    archive.disabled = true;
    try {
      const affected = await store.rejectCandidates(
        candidates.map((c) => c.id),
        { reason: reasonInput.value, withdrawn: kind.value === 'withdrawn' }
      );
      modal.close();
      toast(`${plural(affected.length, 'candidate')} archived`);
      onDone?.(affected);
      if (kind.value === 'rejected' && emailCheck.checked) {
        startRejectQueue(ctx, affected.filter((c) => c.email));
      }
    } catch (err) {
      archive.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: `Archive ${plural(candidates.length, 'candidate')}?`,
    content: [
      el('p', { class: 'confirm-message' }, 'They move to the archive together. Nothing is deleted, and anyone can be restored later.'),
      field('Archive as', kind, 'bulk-kind'),
      field('Reason', reasonInput, 'bulk-reason'),
      emailRow,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), archive],
  });
}

/**
 * Stepped queue of rejection drafts: each step opens one prefilled
 * mailto draft, so the whole batch is a run of Enter presses.
 */
export function startRejectQueue(ctx, candidates) {
  const { store } = ctx;
  const queue = candidates.filter((c) => c.email);
  if (queue.length === 0) return;
  let index = 0;
  // Every draft this queue opens is logged on its candidate's timeline as
  // "draft opened". Collect them so the last step can promote the whole
  // batch to "sent" in one click, instead of leaving dozens of drafts on
  // record that nobody can tell apart from unsent ones.
  const opened = [];

  const body = el('div', { style: { display: 'contents' } });
  const modal = openModal({ title: 'Rejection emails', content: body });

  function renderDone() {
    const markAll = el('button', { class: 'btn btn-primary' }, icon('check', 15), `Mark ${plural(opened.length, 'email')} as sent`);
    markAll.addEventListener('click', async () => {
      markAll.disabled = true;
      try {
        const marked = await store.markEmailsSent(opened);
        modal.close();
        toast(`${plural(marked, 'email')} marked as sent`);
      } catch (err) {
        markAll.disabled = false;
        toast(err.message, 'error');
      }
    });
    body.replaceChildren(
      el(
        'p',
        { class: 'confirm-message' },
        `${plural(opened.length, 'draft')} opened. Each one is on its candidate's timeline as a draft — confirm them here once you have sent them, or leave them as drafts.`
      ),
      el(
        'div',
        { class: 'modal-footer no-pad' },
        el('button', { class: 'btn', onClick: () => modal.close() }, 'Leave as drafts'),
        el('span', { class: 'grow' }),
        markAll
      )
    );
    markAll.focus();
  }

  function renderStep() {
    if (index >= queue.length) {
      if (opened.length === 0) {
        modal.close();
        toast('No drafts opened');
        return;
      }
      renderDone();
      return;
    }
    const candidate = queue[index];
    const job = store.state.jobs.find((j) => j.id === candidate.jobId);
    const open = el('button', { class: 'btn btn-primary' }, icon('mail', 15), 'Open draft');
    open.addEventListener('click', async () => {
      // Disabled across the await (the clipboard fallback takes a moment):
      // a double-click would draft this candidate twice and advance the
      // queue by two, silently skipping the next person.
      open.disabled = true;
      const logged = await composeEmail(ctx, 'reject', candidate, { job: job?.title ?? 'the role' });
      if (logged) opened.push(logged);
      index += 1;
      renderStep();
    });
    const skip = el(
      'button',
      {
        class: 'btn',
        onClick: () => {
          index += 1;
          renderStep();
        },
      },
      'Skip'
    );
    body.replaceChildren(
      el('p', { class: 'confirm-message' }, `Draft ${index + 1} of ${queue.length}. Each one opens in your own mail app. Send it there, then come back for the next.`),
      el(
        'div',
        { class: 'item-row' },
        avatar(candidate.name),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, candidate.name),
          el('div', { class: 'item-sub' }, candidate.email)
        )
      ),
      el('div', { class: 'modal-footer no-pad' }, el('button', { class: 'btn', onClick: () => modal.close() }, 'Stop'), el('span', { class: 'grow' }), skip, open)
    );
    open.focus();
  }

  renderStep();
}

/**
 * Tag a whole selection at once — the same selection that already moves
 * and archives. Adding and removing in one pass, because "everyone I just
 * screened is +screened, -to-screen" is the actual shape of the job.
 */
export function openBulkTag(ctx, ids) {
  const { store } = ctx;
  const candidates = ids.map((id) => store.state.candidates.find((c) => c.id === id)).filter(Boolean);
  if (candidates.length === 0) {
    toast('Nothing selected.', 'error');
    return;
  }

  const draft = [];
  // No aria-label: the field carries a visible "Add these tags" label
  // below, and an aria-label would override it — the screen said one
  // thing and a screen reader said another.
  const { input, datalist } = tagInput(store.state.candidates, { label: null, placeholder: 'Add a tag…' });
  const chips = el('div', { class: 'tag-row' });
  const renderChips = () => {
    chips.replaceChildren(
      ...(draft.length === 0
        ? [el('span', { class: 'muted small' }, 'Nothing to add yet.')]
        : draft.map((tag) =>
            tagChip(tag, () => {
              draft.splice(draft.indexOf(tag), 1);
              renderChips();
            })
          ))
    );
  };
  renderChips();
  const addTyped = () => {
    for (const tag of parseTags(input.value)) {
      if (!draft.some((t) => tagKey(t) === tagKey(tag))) draft.push(tag);
    }
    input.value = '';
    renderChips();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addTyped();
  });

  /* Removal is offered as a list of what the selection actually carries —
     typing a tag to remove is guesswork, and picking from the truth is
     both faster and honest about what will change. */
  const present = tagCounts(candidates);
  const removeChecks = present.map(({ tag, count }) => {
    const box = el('input', { type: 'checkbox', class: 'task-check', id: `untag-${tagKey(tag)}` });
    return {
      tag,
      box,
      node: el('label', { class: 'task-label day-check', for: `untag-${tagKey(tag)}` }, box, el('span', {}, `${tag} · ${count}`)),
    };
  });

  const apply = el('button', { class: 'btn btn-primary' }, icon('tag', 15), 'Apply tags');
  apply.addEventListener('click', async () => {
    addTyped();
    const remove = removeChecks.filter((r) => r.box.checked).map((r) => r.tag);
    if (draft.length === 0 && remove.length === 0) {
      toast('Add a tag, or pick one to remove.', 'error');
      return;
    }
    apply.disabled = true;
    try {
      const { changed, atCapacity } = await store.tagCandidates(
        candidates.map((c) => c.id),
        { add: draft, remove }
      );
      modal.close();
      // A candidate already carrying the maximum silently kept their old
      // list; say so rather than counting them among the retagged.
      const full = atCapacity > 0 ? `${plural(atCapacity, 'candidate')} already at the ${MAX_TAGS}-tag limit` : '';
      if (changed === 0) {
        toast(full ? `Nothing changed — ${full}.` : 'Nothing to change — they already read that way', full ? 'error' : 'success');
      } else {
        toast(`${plural(changed, 'candidate')} retagged${full ? `, ${full}` : ''}`);
      }
    } catch (err) {
      apply.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: `Tag ${plural(candidates.length, 'candidate')}`,
    content: [
      el('div', { class: 'field' }, el('label', { for: 'bulk-tag-add' }, 'Add these tags'), el('div', { class: 'input-row' }, input, datalist, el('button', { class: 'btn', onClick: addTyped }, 'Add')), chips),
      removeChecks.length > 0
        ? el(
            'div',
            { class: 'field' },
            el('label', {}, 'Remove tags they carry'),
            el('div', { class: 'day-checks' }, removeChecks.map((r) => r.node))
          )
        : null,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), apply],
  });
  input.id = 'bulk-tag-add';
}
