/**
 * Turning the contract book into a calendar the user's own calendar app can
 * read: a downloadable .ics, and an optional subscribable feed hosted from
 * their own Puter storage.
 *
 * The feed is the better version of the same thing — a download is a snapshot,
 * a subscription keeps up — but it is also a URL that anyone holding it can
 * read, so it is opt-in, revocable, and says so plainly where it is created.
 */

import { store, isMissingFileError } from './store.js';
import { buildCalendar, bookEvents, contractEvents } from './ical.js';
import { todayISO } from './dates.js';
import { randomToken } from './util.js';

const FEED_DIR = 'contract-manager/calendar';
const FEED_FILE = 'deadlines.ics';
export const FEED_PATH = `${FEED_DIR}/${FEED_FILE}`;

/** Where the app is served from, so an event can link back to a contract. */
export function appBaseUrl() {
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname}`;
}

const contactNameFor = (contract) => {
  const contact = store.contactById(contract.contactId);
  if (!contact) return '';
  return contact.company ? `${contact.name}, ${contact.company}` : contact.name;
};

/** The whole book as one calendar. */
export function bookCalendar({ today = todayISO(), name = 'Contract deadlines' } = {}) {
  const events = bookEvents(store.contracts, {
    today,
    baseUrl: appBaseUrl(),
    contactName: contactNameFor,
  });
  return { text: buildCalendar(events, { name }), count: events.length };
}

/** One contract as its own small calendar. */
export function singleContractCalendar(contract, { today = todayISO() } = {}) {
  const events = contractEvents(contract, {
    today,
    baseUrl: appBaseUrl(),
    contactName: contactNameFor(contract),
  });
  return {
    text: buildCalendar(events, { name: `${contract.title} deadlines` }),
    count: events.length,
  };
}

/** A filename that says what it is and when it was taken. */
export function calendarFilename(title = null) {
  const slug = String(title || 'contract-deadlines')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deadlines';
  return `${slug}-${todayISO()}.ics`;
}

/* ------------------------------------------------------------------ */
/* Hosted feed                                                         */
/* ------------------------------------------------------------------ */

export function feedSupported() {
  return typeof puter !== 'undefined' && !!puter.hosting?.create;
}

async function writeFeedFile() {
  const { text, count } = bookCalendar();
  await puter.fs.write(FEED_PATH, text, { createMissingParents: true });
  return count;
}

/**
 * Publish the feed: write the file, then point a Puter subdomain at the folder
 * it lives in. Returns the URL to paste into a calendar app.
 */
export async function publishFeed() {
  if (!feedSupported()) throw new Error('Hosting is not available');
  // The subdomain is the only thing standing between this data and the open
  // web, so it is a real secret, not a readable id.
  const subdomain = `cm-${randomToken()}`;
  await writeFeedFile();
  const site = await puter.hosting.create(subdomain, FEED_DIR);
  const name = site?.subdomain || subdomain;
  const url = `https://${name}.puter.site/${FEED_FILE}`;
  await store.updateSettings({ feed: { subdomain: name, url, createdAt: Date.now() } });
  return url;
}

/** Rewrite the file so subscribers see the current deadlines. */
export async function refreshFeed() {
  if (!store.settings.feed) return 0;
  return writeFeedFile();
}

/**
 * A rejection that says the thing is already absent, rather than that the call
 * failed. Absence has to count as success or a revoke could strand itself: one
 * that removed the address and then failed to save the change would find the
 * address missing on every retry, and never be able to finish.
 */
function isAlreadyGone(err) {
  if (isMissingFileError(err)) return true;
  const text = `${err?.code ?? err?.error?.code ?? ''} ${err?.message ?? err?.error?.message ?? ''}`;
  return /no such|not exist|missing/i.test(text);
}

/**
 * Take the link out of circulation: the subdomain and the file both go.
 *
 * The address is what has to go. Deleting the file only makes the URL 404 while
 * the folder behind it is still published — publish a feed again, into the same
 * folder, and that address serves the new file. So a revoke is only real once
 * the subdomain is gone, and anything short of that throws instead of clearing
 * the setting: telling someone a live link is dead, and dropping the address
 * they would need to try again, is worse than saying it did not go through.
 *
 * An address that is already gone counts as gone, or a revoke that half
 * succeeded once could never be finished.
 */
export async function revokeFeed() {
  const feed = store.settings.feed;
  if (feed?.subdomain && !feedSupported()) throw new Error('Hosting is not available');
  const [, site] = await Promise.allSettled([
    puter.fs.delete(FEED_PATH),
    feed?.subdomain ? puter.hosting.delete(feed.subdomain) : Promise.resolve(),
  ]);
  const siteGone = site.status === 'fulfilled' || isAlreadyGone(site.reason);
  if (!siteGone) throw site.reason;
  // A file that refused to delete is left unreferenced in the user's own
  // storage, which is untidy but no longer reachable from the web.
  await store.updateSettings({ feed: null });
}

/** Revoke and publish again, so the old URL stops working. */
export async function regenerateFeed() {
  await revokeFeed();
  return publishFeed();
}

/**
 * Keep the published file in step with the data. Writes are debounced because
 * a single edit can emit several change events, and a calendar that is a few
 * seconds stale is fine while one that costs a write per keystroke is not.
 */
export function startFeedSync(delay = 4000) {
  let timer = null;
  const schedule = () => {
    if (!store.settings.feed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      refreshFeed().catch((err) => console.error('Calendar feed refresh failed', err));
    }, delay);
  };
  store.addEventListener('change', schedule);
  return () => {
    clearTimeout(timer);
    store.removeEventListener('change', schedule);
  };
}
