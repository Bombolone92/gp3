/**
 * Settings → Calendar: download the deadlines, or publish a feed a calendar
 * app can subscribe to.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { downloadBlob } from '../lib/util.js';
import { formatDate, dateToISO } from '../lib/dates.js';
import {
  bookCalendar, calendarFilename, feedSupported, publishFeed, regenerateFeed, revokeFeed,
} from '../lib/calendar.js';

/** Download every deadline in the book as one .ics file. */
export function downloadBookCalendar() {
  const { text, count } = bookCalendar();
  if (!count) {
    toast('No dated deadlines to export yet', { icon: 'info' });
    return;
  }
  downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), calendarFilename('contract-deadlines'));
  toast(`${count} deadline${count === 1 ? '' : 's'} exported`, { icon: 'calendar' });
}

/**
 * The feed block. Rebuilds itself from settings, so publishing or revoking
 * updates in place.
 */
export function calendarFeedSection() {
  const wrap = el('div');

  function render() {
    clear(wrap);
    const feed = store.settings.feed;

    if (!feedSupported()) {
      wrap.append(el('p.quiet-note', {},
        'A subscription link needs Puter hosting, which this environment does not offer. The download above always works.'));
      return;
    }

    if (!feed) {
      const create = el('button.btn.btn-ghost', {
        html: icon('link', 15, 2),
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Create a subscription link?',
            message: 'The link is unguessable, but anyone who has it can read your contract titles, dates and values without signing in. You can revoke it at any time.',
            confirmLabel: 'Create the link',
            danger: false,
          });
          if (!ok) return;
          create.disabled = true;
          try {
            await publishFeed();
            toast('Subscription link ready', { icon: 'link' });
          } catch (err) {
            console.error(err);
            create.disabled = false;
            toast('Could not publish the feed. Check your connection', { icon: 'wifiOff' });
          }
        },
      }, ' Create a subscription link');
      append(wrap, [
        el('p.about-text', { style: { marginBottom: '12px' } },
          'A subscription keeps up on its own: your calendar re-reads it, so deadlines stay right as contracts change. It is served from your own Puter storage.'),
        create,
      ]);
      return;
    }

    const urlInput = el('input.input', {
      value: feed.url, readOnly: true, spellcheck: false,
      'aria-label': 'Calendar subscription URL',
      onclick: (e) => e.target.select(),
    });

    append(wrap, [
      el('p.about-text', { style: { marginBottom: '10px' } },
        'Paste this into Google Calendar (Other calendars → From URL), Apple Calendar (File → New Calendar Subscription) or Outlook (Add calendar → Subscribe from web).'),
      el('div.feed-row', {}, urlInput,
        el('button.btn.btn-ghost.btn-compact', {
          html: icon('link', 14, 2),
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(feed.url);
              toast('Link copied');
            } catch {
              urlInput.select();
              toast('Press Ctrl+C to copy the selected link', { icon: 'info' });
            }
          },
        }, ' Copy')),
      el('p.field-hint', {},
        `Created ${formatDate(dateToISO(new Date(feed.createdAt)))}. Anyone with this link can read these deadlines.`),
      el('div.row.wrap', { style: { marginTop: '12px' } },
        el('button.btn.btn-ghost.btn-compact', {
          html: icon('undo', 14, 2),
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Make a new link?',
              message: 'The current link stops working immediately. Anyone still subscribed to it will need the new one.',
              confirmLabel: 'Replace the link',
            });
            if (!ok) return;
            try {
              await regenerateFeed();
              toast('New link ready', { icon: 'link' });
            } catch (err) {
              console.error(err);
              toast('Could not replace the link. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, ' Replace link'),
        el('button.btn.btn-ghost.btn-compact.btn-danger-ghost', {
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Turn the feed off?',
              message: 'The link stops working and the published file is deleted. Your contracts are untouched.',
              confirmLabel: 'Turn it off',
            });
            if (!ok) return;
            try {
              await revokeFeed();
              toast('Subscription turned off', { icon: 'trash' });
            } catch (err) {
              console.error(err);
              toast('Could not turn it off. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, 'Turn off')
      ),
    ]);
  }

  render();
  store.addEventListener('change', render);
  wrap.destroy = () => store.removeEventListener('change', render);
  return wrap;
}
