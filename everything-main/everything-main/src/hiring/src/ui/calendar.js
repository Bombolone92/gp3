/**
 * Sharing the interview calendar: a link a calendar app can subscribe to,
 * so interviews reach the day's real schedule without a file per event.
 *
 * The honest version of this feature is public-but-unlisted — Puter offers
 * no way to authenticate a calendar client — so the dialog says so, keeps
 * the payload minimal, and makes revocation a single button.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { copyText, field } from './components.js';
import { confirmDialog, ignoreChanges, openModal } from './modal.js';
import { toast } from './toast.js';
import {
  calendarFeedUrl,
  calendarFeedWebcalUrl,
  setCalendarFeedNames,
  shareCalendarFeed,
  stopCalendarFeed,
} from './publish.js';
import { feedInterviews, FEED_PAST_DAYS } from '../core/feed.js';
import { plural } from '../lib/format.js';
import { formatTimestamp } from '../lib/dates.js';

export function openCalendarShare(ctx) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });
  const modal = openModal({ title: 'Subscribe in your calendar', wide: true, content: body });

  const privacyNote = () =>
    el(
      'p',
      { class: 'muted small' },
      'The link is public but unlisted: anyone who has it can read the calendar, because a calendar app cannot sign in to your Puter account. It carries only the date, time, format, and — unless you turn on full names below — each candidate’s first name and role. No notes, no panel, no meeting links. Stop sharing at any time; the link stops working immediately, and sharing again creates a different one.'
    );

  function renderOff() {
    const fullNames = el('input', { type: 'checkbox', class: 'task-check', id: 'feed-names' });
    const create = el('button', { class: 'btn btn-primary' }, icon('calendar', 15), 'Create the link');
    create.addEventListener('click', async () => {
      create.disabled = true;
      try {
        await shareCalendarFeed(ctx, { fullNames: fullNames.checked });
        renderOn();
        toast('Calendar link created');
      } catch (err) {
        create.disabled = false;
        toast(err.message ?? 'Couldn’t create the link.', 'error');
      }
    });

    const count = feedInterviews(store.state).length;
    body.replaceChildren(
      el(
        'p',
        { class: 'confirm-message' },
        `Your interviews, kept up to date in whatever calendar app you already use — ${plural(count, 'interview')} right now, counting the last ${FEED_PAST_DAYS} days. The per-interview download stays where it is if you would rather host nothing.`
      ),
      el(
        'label',
        { class: 'task-label', for: 'feed-names' },
        fullNames,
        el('span', {}, 'Use candidates’ full names in event titles')
      ),
      privacyNote(),
      el('div', { class: 'modal-footer no-pad' }, el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), create)
    );
  }

  function renderOn() {
    const settings = store.state.settings;
    const url = calendarFeedUrl(settings);
    const webcal = calendarFeedWebcalUrl(settings);
    if (!url) {
      renderOff();
      return;
    }

    const link = el('input', { class: 'input', type: 'text', value: url, readonly: true, 'aria-label': 'Calendar subscription link' });
    link.addEventListener('focus', () => link.select());

    const fullNames = el('input', {
      type: 'checkbox',
      class: 'task-check',
      id: 'feed-names',
      checked: Boolean(settings.calendarFeed?.fullNames),
    });
    // This switch writes the feed and the setting the moment it is
    // flipped, so the dialog has nothing left to discard. Left in the
    // dirty tracker, closing the dialog afterwards asked "Discard
    // changes? What you entered here hasn't been saved" — about a change
    // whose own toast had just said it had taken effect.
    ignoreChanges(fullNames);
    fullNames.addEventListener('change', async () => {
      fullNames.disabled = true;
      try {
        await setCalendarFeedNames(ctx, fullNames.checked);
        toast(fullNames.checked ? 'Events now use full names' : 'Events now use first names only');
      } catch (err) {
        fullNames.checked = !fullNames.checked;
        toast(err.message ?? 'Couldn’t update the calendar.', 'error');
      } finally {
        fullNames.disabled = false;
      }
    });

    const stop = el('button', { class: 'btn btn-danger' }, icon('ban', 15), 'Stop sharing');
    stop.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Stop sharing the calendar?',
        message: 'The file is deleted, so the link stops working for everyone who has it — including your own calendar app, which will show the events until you remove the subscription. Sharing again creates a different link.',
        confirmLabel: 'Stop sharing',
        danger: true,
      });
      if (!ok) return;
      stop.disabled = true;
      try {
        await stopCalendarFeed(ctx);
        renderOff();
        toast('Calendar link revoked');
      } catch (err) {
        stop.disabled = false;
        toast(err.message ?? 'Couldn’t remove the calendar.', 'error');
      }
    });

    body.replaceChildren(
      el(
        'p',
        { class: 'confirm-message' },
        'Add this link in your calendar app — Apple Calendar: File ▸ New Calendar Subscription; Google Calendar: Other calendars ▸ From URL; Outlook: Add calendar ▸ Subscribe from web. It refreshes on your calendar’s own schedule, usually a few times a day.'
      ),
      field('Subscription link', link, 'feed-url'),
      el(
        'div',
        { class: 'input-row' },
        el('button', { class: 'btn btn-sm', onClick: () => copyText(url, 'Subscription link copied') }, icon('copy', 14), 'Copy link'),
        // webcal:// hands the URL straight to the calendar app instead of
        // downloading a one-off file, which is the whole difference
        // between subscribing and importing.
        el('a', { class: 'btn btn-sm', href: webcal }, icon('calendar-plus', 14), 'Open in calendar app'),
        el('span', { class: 'muted small' }, `Shared ${formatTimestamp(settings.calendarFeed?.createdAt) || 'recently'}`)
      ),
      el(
        'label',
        { class: 'task-label', for: 'feed-names' },
        fullNames,
        el('span', {}, 'Use candidates’ full names in event titles')
      ),
      privacyNote(),
      el('div', { class: 'modal-footer no-pad' }, stop, el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Done'))
    );
  }

  if (calendarFeedUrl(store.state.settings)) renderOn();
  else renderOff();
}
