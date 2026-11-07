/**
 * Publishing service: renders job pages into a public directory in the
 * user's Puter cloud and serves it on a per-account subdomain via
 * puter.hosting. One site per account; one page per published job, plus
 * an index of open roles at the root.
 */
import {
  buildJobPageHtml,
  buildRobotsTxt,
  buildSiteIndexHtml,
  buildSitemapXml,
  subdomainBase,
} from '../core/jobpage.js';
import { isMissingPathError } from '../core/backend.js';
import { buildInterviewFeed, feedFingerprint, isFeedFile, newFeedFile } from '../core/feed.js';

const SITE_DIR = 'hiring-public';

/** The site's own address, or '' before the account has reserved one. */
export function siteUrl(settings) {
  const subdomain = settings.publishSite?.subdomain;
  return subdomain ? `https://${subdomain}.puter.site` : '';
}

/** The live public URL for a published job, or null. */
export function jobPageUrl(settings, job) {
  const base = siteUrl(settings);
  return base && job.published ? `${base}/${job.id}.html` : null;
}

function publishedJobs(store) {
  return store.state.jobs.filter((j) => j.published && j.status === 'open');
}

/**
 * The index plus the two files that make the site findable. Written
 * together because they say the same thing — which roles are live — and
 * every path that changes that (publish, unpublish, edit, reconcile)
 * already comes through here. The sitemap and robots need absolute URLs,
 * so they wait for the subdomain the first publish reserves.
 */
async function writeIndex(store) {
  const settings = store.state.settings;
  const base = siteUrl(settings);
  const jobs = publishedJobs(store);
  const html = buildSiteIndexHtml(jobs, { companyName: settings.companyName, siteUrl: base });
  await puter.fs.write(`${SITE_DIR}/index.html`, html, { createMissingParents: true });
  if (!base) return;
  await Promise.all([
    puter.fs.write(`${SITE_DIR}/sitemap.xml`, buildSitemapXml(jobs, { siteUrl: base }), { createMissingParents: true }),
    puter.fs.write(`${SITE_DIR}/robots.txt`, buildRobotsTxt({ siteUrl: base }), { createMissingParents: true }),
  ]);
}

async function writeJobPage(store, job) {
  const html = buildJobPageHtml(job, {
    companyName: store.state.settings.companyName,
    applyEmail: store.state.settings.applyEmail,
    siteUrl: siteUrl(store.state.settings),
  });
  await puter.fs.write(`${SITE_DIR}/${job.id}.html`, html, { createMissingParents: true });
}

/** Reserve the account's public site on first publish. */
async function ensureSite(store) {
  const existing = store.state.settings.publishSite;
  if (existing?.subdomain) return existing;
  await writeIndex(store);
  const base = subdomainBase(store.state.settings.companyName);
  // Only the reservation itself retries: a collision wants a new suffix,
  // but a failed settings write after a successful reservation must not —
  // the retry would reserve a second live subdomain on the same directory
  // while the first kept serving, and the eventual error would blame the
  // address instead of the save.
  let subdomain = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3 && !subdomain; attempt++) {
    const candidate = `${base}-jobs-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await puter.hosting.create(candidate, SITE_DIR);
      subdomain = candidate;
    } catch (err) {
      lastError = err; // Almost always a name collision; retry with a new suffix.
    }
  }
  if (!subdomain) {
    throw new Error(lastError?.message ?? 'Could not reserve a public site address. Try again.');
  }
  const site = { subdomain };
  try {
    await store.updateSettings({ publishSite: site });
  } catch (err) {
    // Reserved but unrecorded: the app wouldn't know it owns this
    // subdomain and the next publish would reserve another. Give it
    // back (best-effort), then report the real failure.
    await puter.hosting.delete(subdomain).catch(() => {});
    throw err;
  }
  return site;
}

/** Publish an open job; returns its public URL. */
export async function publishJob(ctx, jobId, applyEmail) {
  const { store } = ctx;
  const job = store.state.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found.');
  if (job.status !== 'open') throw new Error('Only open jobs can be published.');
  const email = String(applyEmail ?? store.state.settings.applyEmail ?? '').trim();
  if (!email || !email.includes('@')) throw new Error('Add the email address that should receive applications.');
  // One address serves the whole site, and the publish dialog is where it
  // is usually typed — so changing it there changes where applications for
  // every published role land. Each page bakes it into its own apply form,
  // so the ones already up have to be rewritten: otherwise an earlier
  // posting keeps sending applicants to an address the user has just
  // replaced, and nothing on screen says so.
  const addressChanged = email !== store.state.settings.applyEmail;
  if (addressChanged) await store.updateSettings({ applyEmail: email });

  const site = await ensureSite(store);
  await writeJobPage(store, job);
  await store.updateJob(job.id, { published: true });
  if (addressChanged) {
    for (const other of publishedJobs(store)) {
      if (other.id !== job.id) await writeJobPage(store, other);
    }
  }
  await writeIndex(store);
  return `https://${site.subdomain}.puter.site/${job.id}.html`;
}

/** Take a job's page down; tolerant of a page that never made it up. */
export async function unpublishJob(ctx, jobId) {
  const { store } = ctx;
  const job = store.state.jobs.find((j) => j.id === jobId);
  if (!job) return;
  try {
    await puter.fs.delete(`${SITE_DIR}/${job.id}.html`);
  } catch (err) {
    if (!isMissingPathError(err)) throw err;
  }
  if (job.published) await store.updateJob(job.id, { published: false });
  if (store.state.settings.publishSite?.subdomain) await writeIndex(store);
}

/**
 * Keep the public page truthful after an edit: republish while the job is
 * open, take it down when it no longer is. No-op for unpublished jobs.
 */
export async function syncPublishedJob(ctx, jobId) {
  const { store } = ctx;
  const job = store.state.jobs.find((j) => j.id === jobId);
  if (!job?.published) return;
  if (job.status !== 'open') {
    await unpublishJob(ctx, jobId);
    return;
  }
  await writeJobPage(store, job);
  await writeIndex(store);
}

/**
 * Bring the hosted site back in line with the current jobs — used after
 * a backup restore, which can drop or close jobs while their public
 * pages stay up with no record left pointing at them.
 */
export async function reconcilePublishedPages(ctx) {
  const { store } = ctx;
  // Only an open job can have a page, so a published flag on any other
  // one is a claim the site cannot honour: the job read "Closed ·
  // Published" with a Public page card offering "Live" and a link to a
  // 404, and the only way to clear it was Unpublish — an action that
  // reads like taking a live page down. A restore is how records arrive
  // in that state (closing a job here always takes its page with it), so
  // this is where the claim is dropped.
  for (const job of store.state.jobs) {
    if (job.published && job.status !== 'open') await store.updateJob(job.id, { published: false });
  }
  if (!store.state.settings.publishSite?.subdomain) return;
  const wanted = new Set(publishedJobs(store).map((j) => `${j.id}.html`));
  let entries;
  try {
    entries = await puter.fs.readdir(SITE_DIR);
  } catch (err) {
    if (isMissingPathError(err)) return; // nothing hosted yet
    throw err;
  }
  await Promise.all(
    (entries ?? [])
      .filter((e) => e.name?.endsWith('.html') && e.name !== 'index.html' && !wanted.has(e.name))
      .map((e) => puter.fs.delete(`${SITE_DIR}/${e.name}`).catch(() => {}))
  );
  // Re-render the pages that should exist (the restored records may
  // carry different content) and the index of open roles.
  for (const job of publishedJobs(store)) await writeJobPage(store, job);
  await writeIndex(store);
  // The shared calendar is part of the same hosted site, and a restore can
  // replace every interview in it.
  await writeCalendarFeed(ctx);
}

/**
 * Open a local preview of the page in a new tab (works before
 * publishing). Returns false when the browser refused the tab — the app
 * runs embedded in Puter, and a blocked popup makes the button look
 * broken unless the caller says what happened.
 */
export function previewJobPage(store, job) {
  const html = buildJobPageHtml(job, {
    companyName: store.state.settings.companyName,
    applyEmail: store.state.settings.applyEmail || 'applications@example.com',
    // The real address when the account has one, so the preview shows the
    // canonical link and card the published page will carry.
    siteUrl: siteUrl(store.state.settings),
  });
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const opened = window.open(url, '_blank', 'noopener');
  // Nothing is going to read the blob, so let go of it now rather than
  // holding the page in memory for the usual grace period.
  setTimeout(() => URL.revokeObjectURL(url), opened ? 30_000 : 0);
  return Boolean(opened);
}

/* ---- The subscribable interview calendar -------------------------------- */

/** The feed's https:// address, or null when nothing is being shared. */
export function calendarFeedUrl(settings) {
  const file = settings.calendarFeed?.file;
  const base = siteUrl(settings);
  return base && isFeedFile(file) ? `${base}/${file}` : null;
}

/**
 * The same address as webcal://, which calendar apps register as a
 * subscription rather than a download.
 */
export function calendarFeedWebcalUrl(settings) {
  const url = calendarFeedUrl(settings);
  return url ? url.replace(/^https:/, 'webcal:') : null;
}

/** Write the feed file for the current data. Caller guarantees it is shared. */
async function writeFeedFile(store, feed) {
  await puter.fs.write(`${SITE_DIR}/${feed.file}`, buildInterviewFeed(store.state, { fullNames: Boolean(feed.fullNames) }), {
    createMissingParents: true,
  });
}

/**
 * Start sharing (or re-share after stopping): reserves the public site if
 * this account has none yet, mints an unguessable file name, and writes
 * the feed. Returns the subscription URL.
 */
export async function shareCalendarFeed(ctx, { fullNames = false } = {}) {
  const { store } = ctx;
  await ensureSite(store);
  const feed = { file: newFeedFile(), fullNames: Boolean(fullNames), createdAt: new Date().toISOString() };
  // File first: a recorded feed with no file behind it would hand out a
  // link that 404s, while an unrecorded file is merely unreachable.
  await writeFeedFile(store, feed);
  await store.updateSettings({ calendarFeed: feed });
  return calendarFeedUrl(store.state.settings);
}

/** Keep the shared feed truthful. No-op when nothing is shared. */
export async function writeCalendarFeed(ctx) {
  const { store } = ctx;
  const feed = store.state.settings.calendarFeed;
  if (!isFeedFile(feed?.file) || !store.state.settings.publishSite?.subdomain) return false;
  await writeFeedFile(store, feed);
  return true;
}

/** Change what the events are titled with, and rewrite the feed. */
export async function setCalendarFeedNames(ctx, fullNames) {
  const { store } = ctx;
  const feed = store.state.settings.calendarFeed;
  if (!isFeedFile(feed?.file)) return;
  const next = { ...feed, fullNames: Boolean(fullNames) };
  await writeFeedFile(store, next);
  await store.updateSettings({ calendarFeed: next });
}

/**
 * Stop sharing: the file is deleted, so a leaked link stops resolving, and
 * the name is forgotten — sharing again mints a different one, which is
 * what makes revocation real.
 */
export async function stopCalendarFeed(ctx) {
  const { store } = ctx;
  const feed = store.state.settings.calendarFeed;
  if (isFeedFile(feed?.file)) {
    try {
      await puter.fs.delete(`${SITE_DIR}/${feed.file}`);
    } catch (err) {
      // Already gone is the outcome we wanted.
      if (!isMissingPathError(err)) throw err;
    }
  }
  await store.updateSettings({ calendarFeed: null });
}

/**
 * Keep a shared feed in step with the data for as long as the app is open.
 * Subscribed to the store rather than wired into each action: an interview
 * changes from the editor, the profile, the schedule, a slot confirmation,
 * a candidate being archived, a job being renamed — a feed that only some
 * of those paths updated would be worse than none.
 *
 * Failures are logged, never toasted: nothing the user did just failed.
 */
export function startFeedSync(ctx, { delay = 1200 } = {}) {
  const { store } = ctx;
  let last = feedFingerprint(store.state, store.state.settings.calendarFeed);
  let timer = null;
  const stop = store.subscribe(() => {
    const next = feedFingerprint(store.state, store.state.settings.calendarFeed);
    if (next === last) return;
    last = next;
    if (!next) return; // Sharing was turned off; the file is already gone.
    clearTimeout(timer);
    timer = setTimeout(() => {
      writeCalendarFeed(ctx).catch((err) => console.error('Calendar feed sync failed', err));
    }, delay);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
