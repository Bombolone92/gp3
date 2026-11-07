/** Jobs: the list of postings and each job's page with its own pipeline. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { avatar, badge, copyText, emptyState, field, segmented, stageBadge, stageDots } from '../components.js';
import { confirmDialog, openModal } from '../modal.js';
import { toast } from '../toast.js';
import { openJobEditor } from '../editors/job.js';
import { jobPageUrl, previewJobPage, publishJob, syncPublishedJob, unpublishJob } from '../publish.js';
import { openCandidateEditor } from '../editors/candidate.js';
import { openBulkArchive } from '../bulk.js';
import { openCompareDialog } from './compare.js';
import { activeCandidates, daysInStage, funnelCounts, isActive } from '../../core/pipeline.js';
import { formatSalaryRange, plural } from '../../lib/format.js';
import { formatDate, relativeDays, todayISO } from '../../lib/dates.js';

const JOB_BADGES = {
  open: ['Open', 'success'],
  draft: ['Draft', ''],
  closed: ['Closed', 'danger'],
};

function jobStatusBadge(status) {
  const [label, variant] = JOB_BADGES[status] ?? [status, ''];
  return badge(label, variant);
}

export function renderJobs(ctx, param) {
  if (param) return renderJobDetail(ctx, param);
  return renderJobList(ctx);
}

function renderJobList(ctx) {
  const { store, ui } = ctx;
  const { jobs, candidates } = store.state;
  const filter = ui.jobFilter ?? 'all';
  const shown = jobs
    .filter((j) => filter === 'all' || j.status === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Jobs'),
      el('p', { class: 'subtitle' }, plural(jobs.filter((j) => j.status === 'open').length, 'open role'))
    ),
    el(
      'div',
      { class: 'view-actions' },
      segmented(
        [
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'draft', label: 'Drafts' },
          { value: 'closed', label: 'Closed' },
        ],
        filter,
        (v) => {
          ui.jobFilter = v;
          ctx.refresh();
        },
        'Job status'
      ),
      el('button', { class: 'btn btn-primary', onClick: () => openJobEditor(ctx) }, icon('plus', 15), 'New job')
    )
  );

  if (shown.length === 0) {
    // Filtered-out is not first-run: with jobs on other segments, the
    // from-scratch pitch (and a CTA that creates an open job under a
    // Closed filter) reads as the wrong screen.
    return [
      header,
      jobs.length === 0
        ? emptyState({
            iconName: 'briefcase',
            title: 'No jobs yet',
            message: 'A job posting is the starting point: candidates, interviews, and offers all hang off it.',
            actions: [el('button', { class: 'btn btn-primary', onClick: () => openJobEditor(ctx) }, icon('plus', 15), 'Create a job')],
          })
        : emptyState({
            iconName: 'briefcase',
            title: `No ${filter} jobs`,
            message: 'No job is in this state right now. Switch the filter to see the rest.',
          }),
    ];
  }

  // Group once: a per-card filter plus funnelCounts scan is jobs ×
  // candidates on a list that re-renders with every store change (the
  // pipeline board indexes scorecards for the same reason).
  const candidatesByJob = new Map();
  for (const c of candidates) {
    const list = candidatesByJob.get(c.jobId);
    if (list) list.push(c);
    else candidatesByJob.set(c.jobId, [c]);
  }

  const cards = shown.map((job) => {
    const jobCandidates = candidatesByJob.get(job.id) ?? [];
    const activeCount = jobCandidates.filter(isActive).length;
    const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.currency);
    const meta = [job.department, job.location, job.workMode, job.type].filter(Boolean).join(' · ');
    return el(
      'div',
      {
        class: 'card job-card is-clickable',
        role: 'link',
        tabindex: 0,
        onClick: () => ctx.navigate(`jobs/${job.id}`),
        onKeydown: (e) => e.key === 'Enter' && ctx.navigate(`jobs/${job.id}`),
      },
      el(
        'div',
        { class: 'job-card-top' },
        el('h3', { class: 'job-card-title' }, job.title),
        jobStatusBadge(job.status)
      ),
      meta ? el('p', { class: 'job-card-meta' }, meta) : null,
      salary ? el('p', { class: 'job-card-salary tnum' }, salary) : null,
      el(
        'div',
        { class: 'job-card-foot' },
        el('span', { class: 'job-card-count' }, icon('users', 14), plural(activeCount, 'active candidate')),
        stageDots(funnelCounts(jobCandidates, null, store.state.settings), store.state.settings)
      )
    );
  });

  return [header, el('div', { class: 'job-grid' }, cards)];
}

/**
 * Description text -> paragraphs and lists. Consecutive "- " (or "* ")
 * lines become a real list even when the same block opens with a heading
 * line, so "What you will do:\n- Ship\n- Review" keeps its bullets.
 */
function renderDescription(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  if (!lines.some(Boolean)) return el('p', { class: 'muted' }, 'No description yet.');

  const out = [];
  let paragraph = [];
  let bullets = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(el('p', { class: 'job-desc-p' }, paragraph.join(' ')));
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length) out.push(el('ul', { class: 'job-desc-list' }, bullets.map((b) => el('li', {}, b))));
    bullets = [];
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushBullets();
    } else if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      bullets.push(line.replace(/^[-*]\s+/, ''));
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return out;
}

function renderJobDetail(ctx, jobId) {
  const { store } = ctx;
  const job = store.state.jobs.find((j) => j.id === jobId);
  if (!job) {
    return emptyState({
      iconName: 'briefcase',
      title: 'Job not found',
      message: 'It may have been deleted.',
      actions: [el('button', { class: 'btn', onClick: () => ctx.navigate('jobs') }, 'Back to jobs')],
    });
  }

  const jobCandidates = store.state.candidates
    .filter((c) => c.jobId === job.id)
    .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt));
  const active = jobCandidates.filter(isActive);
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.currency);

  const back = el(
    'button',
    { class: 'btn btn-ghost back-link', onClick: () => ctx.navigate('jobs') },
    icon('arrow-left', 15),
    'Jobs'
  );

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, job.title), jobStatusBadge(job.status), job.published ? badge('Published', 'accent') : null),
      el(
        'p',
        { class: 'subtitle' },
        [job.department, job.location, job.workMode, job.type].filter(Boolean).join(' · ') || 'No details yet'
      )
    ),
    el(
      'div',
      { class: 'view-actions' },
      el(
        'button',
        {
          class: 'btn',
          // Not "Copy link": the Public page card below carries a button
          // by that name for the live posting, and both are on screen at
          // once on a published job. This one is the private in-app
          // route — only someone signed in to this account can open it.
          title: 'Copy a link that opens this job inside the app',
          onClick: () => {
            const url = new URL(location.href);
            url.hash = `#/jobs/${job.id}`;
            copyText(url.href, 'Link to this job in the app copied');
          },
        },
        icon('link', 15),
        'Copy app link'
      ),
      el('button', { class: 'btn', onClick: () => openJobEditor(ctx, job) }, icon('pencil', 15), 'Edit'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: () => openCandidateEditor(ctx, null, { jobId: job.id }),
        },
        icon('user-plus', 15),
        'Add candidate'
      )
    )
  );

  const closed = Boolean(job.closesOn) && job.closesOn < todayISO();
  const about = el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Job page'),
    salary
      ? el('p', { class: 'job-detail-salary' }, icon('file-text', 15), el('span', { class: 'tnum' }, `${salary} per year`))
      : null,
    // The deadline the public page states and the posting's validThrough
    // carries; past it, aggregators stop serving the role and the public
    // page stops taking applications. Said in the present tense either
    // way, a date three weeks gone read as one still to come — the one
    // reading that matters here, since it means the posting is no longer
    // collecting anything.
    job.closesOn
      ? el(
          'p',
          { class: 'job-detail-salary' },
          icon(closed ? 'circle-alert' : 'hourglass', 15),
          el(
            'span',
            {},
            closed
              ? `Applications closed ${formatDate(job.closesOn)}${job.published ? ' — the public page says so and no longer takes any' : ''}`
              : `Applications close ${formatDate(job.closesOn)}`
          )
        )
      : null,
    el('div', { class: 'job-desc' }, renderDescription(job.description))
  );

  const pipelineCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-title-row' },
      el('h2', { class: 'card-title' }, 'Candidates'),
      el('span', { class: 'muted small' }, `${active.length} active of ${jobCandidates.length}`),
      active.length >= 2
        ? el('button', { class: 'btn btn-sm', onClick: () => openCompareDialog(ctx, job.id) }, icon('users', 14), 'Compare')
        : null
    ),
    jobCandidates.length === 0
      ? emptyState({
          iconName: 'users',
          title: 'No candidates yet',
          message: 'Add the first applicant to start this job’s pipeline.',
          actions: [
            el(
              'button',
              { class: 'btn btn-primary', onClick: () => openCandidateEditor(ctx, null, { jobId: job.id }) },
              icon('user-plus', 15),
              'Add candidate'
            ),
          ],
        })
      : el(
          'div',
          { class: 'row-list' },
          jobCandidates.map((c) =>
            el(
              'div',
              {
                class: 'item-row is-clickable',
                role: 'link',
                tabindex: 0,
                onClick: () => ctx.navigate(`candidates/${c.id}`),
                onKeydown: (e) => e.key === 'Enter' && ctx.navigate(`candidates/${c.id}`),
              },
              avatar(c.name),
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, c.name),
                el('div', { class: 'item-sub' }, isActive(c) ? `${plural(daysInStage(c), 'day')} in stage` : `Added ${relativeDays(c.createdAt)}`)
              ),
              isActive(c) ? stageBadge(c.stage, store.state.settings) : badge(c.status === 'rejected' ? 'Rejected' : 'Withdrawn', c.status === 'rejected' ? 'danger' : '')
            )
          )
        )
  );

  const publicUrl = jobPageUrl(store.state.settings, job);
  const publishCard = el(
    'div',
    { class: 'card card-pad job-admin' },
    el('h2', { class: 'card-title' }, 'Public page'),
    publicUrl
      ? el(
          'div',
          { class: 'publish-state' },
          el('span', { class: 'publish-live' }, icon('globe', 14), 'Live'),
          el('a', { class: 'publish-url', href: publicUrl, target: '_blank', rel: 'noreferrer' }, publicUrl)
        )
      : el(
          'p',
          { class: 'muted small publish-note' },
          job.status === 'open'
            ? 'Publish this posting as a public page on your own Puter site, with an apply-by-email button.'
            : 'Only open jobs can be published. Open the job first.'
        ),
    el(
      'div',
      { class: 'job-admin-actions' },
      el(
        'button',
        {
          class: 'btn',
          onClick: () => {
            if (!previewJobPage(store, job)) {
              toast('The browser blocked the preview tab. Allow pop-ups for this page, then try again.', 'error');
            }
          },
        },
        icon('eye', 15),
        'Preview'
      ),
      publicUrl
        ? [
            el(
              'button',
              { class: 'btn', title: 'Copy the public address anyone can open', onClick: () => copyText(publicUrl, 'Public link copied') },
              icon('link', 15),
              'Copy public link'
            ),
            el(
              'button',
              {
                class: 'btn',
                onClick: async () => {
                  try {
                    await unpublishJob(ctx, job.id);
                    toast('Job page taken down');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('ban', 15),
              'Unpublish'
            ),
          ]
        : job.status === 'open'
          ? el('button', { class: 'btn btn-primary', onClick: () => openPublishDialog(ctx, job) }, icon('globe', 15), 'Publish page')
          : null
    )
  );

  const statusActions = el(
    'div',
    { class: 'card card-pad job-admin' },
    el('h2', { class: 'card-title' }, 'Manage'),
    el(
      'div',
      { class: 'job-admin-actions' },
      job.status !== 'open'
        ? el(
            'button',
            {
              class: 'btn',
              // Every other mutation in this view reports its failure;
              // without a catch a failed save left the badge on "Closed"
              // and the click looking like it did nothing.
              onClick: async () => {
                try {
                  await store.updateJob(job.id, { status: 'open' });
                  toast('Job reopened');
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            icon('check', 15),
            'Open for candidates'
          )
        : el('button', { class: 'btn', onClick: () => closeJob(ctx, job) }, icon('ban', 15), 'Close job'),
      el(
        'button',
        {
          class: 'btn btn-danger',
          onClick: async () => {
            // Talent-pool members on this job go with it. Everywhere else
            // they are the protected class — the retention purge always
            // keeps them, and the pool tab exists to bring them back —
            // so a count that hides them inside "its 12 candidates" is
            // the one thing this dialog has to say out loud.
            const pooled = jobCandidates.filter((c) => c.pool).length;
            // And their uploaded files, which are not in the app's storage
            // at all: they sit in the user's own Puter drive, and the
            // directory goes with the candidate.
            const files = jobCandidates.reduce((n, c) => n + (c.attachments?.length ?? 0), 0);
            const ok = await confirmDialog({
              title: 'Delete this job?',
              message: [
                `“${job.title}” and its ${plural(jobCandidates.length, 'candidate')} will be permanently removed, including their interviews, scorecards, offers, and onboarding checklists.`,
                pooled > 0 ? `${plural(pooled, 'talent-pool member')} ${pooled === 1 ? 'is' : 'are'} among them.` : null,
                files > 0 ? `${plural(files, 'uploaded file')} ${files === 1 ? 'is' : 'are'} deleted from your Puter drive too.` : null,
              ]
                .filter(Boolean)
                .join(' '),
              confirmLabel: 'Delete job',
              danger: true,
            });
            if (!ok) return;
            if (job.published) await unpublishJob(ctx, job.id).catch(() => {});
            await store.deleteJob(job.id);
            ctx.navigate('jobs');
            toast('Job deleted');
          },
        },
        icon('trash', 15),
        'Delete job'
      )
    )
  );

  return [back, header, el('div', { class: 'detail-grid' }, el('div', { class: 'detail-col' }, about, publishCard, statusActions), pipelineCard)];
}

/**
 * Close a job — and when candidates are still active on it, offer to
 * disposition them in the same step so the board never strands people
 * on a closed role. Hired candidates are left alone.
 */
async function closeJob(ctx, job) {
  const { store } = ctx;
  const finish = async () => {
    await store.updateJob(job.id, { status: 'closed' });
    await syncPublishedJob(ctx, job.id);
    toast('Job closed');
  };
  const active = store.state.candidates.filter((c) => c.jobId === job.id && isActive(c) && c.stage !== 'hired');
  if (active.length === 0) {
    try {
      await finish();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  const run = async (thenArchive) => {
    try {
      await finish();
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    modal.close();
    if (thenArchive) openBulkArchive(ctx, active.map((c) => c.id), { reason: `Role closed (${job.title})` });
  };

  const modal = openModal({
    title: `Close “${job.title}”?`,
    content: el(
      'p',
      { class: 'confirm-message' },
      `${plural(active.length, 'candidate')} ${active.length === 1 ? 'is' : 'are'} still active on this job. Closing takes the public page down; the candidates stay on the board unless you archive them too.`
    ),
    footer: [
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => run(false) }, 'Close job only'),
      el('button', { class: 'btn btn-primary', onClick: () => run(true) }, `Close & archive ${active.length}…`),
    ],
  });
}

/** Ask where applications should land, then publish. */
function openPublishDialog(ctx, job) {
  const { store } = ctx;
  const email = el('input', {
    class: 'input',
    type: 'email',
    value: store.state.settings.applyEmail ?? '',
    placeholder: 'applications@yourcompany.com',
  });
  email.addEventListener('keydown', (e) => e.key === 'Enter' && publish.click());

  const publish = el('button', { class: 'btn btn-primary' }, icon('globe', 15), 'Publish');
  publish.addEventListener('click', async () => {
    publish.disabled = true;
    try {
      const url = await publishJob(ctx, job.id, email.value);
      modal.close();
      // Going live is the outcome; copying the link is a convenience. A
      // clipboard the browser refuses (an iframe without permission, a
      // non-secure context) toasts its own error, and without this the
      // only word about a page that just went public would be that error.
      if (!(await copyText(url, 'Job page is live. Link copied.'))) {
        // Names the button as it now reads. There are two copy buttons on
        // a published job and the other one, "Copy app link", hands back
        // the private in-app route instead of the public address.
        toast('Job page is live. Use “Copy public link” below for the address.');
      }
    } catch (err) {
      publish.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: `Publish “${job.title}”`,
    content: [
      el(
        'p',
        { class: 'confirm-message' },
        'The posting becomes a public page on your own Puter site, with an apply-by-email button. Republishing happens automatically when you edit the job; closing it takes the page down.'
      ),
      field('Applications go to', email, 'pub-email'),
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), publish],
  });
}
